// Exercise the packaged Firefox background with synthetic responses, never live feeds.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-paced-firefox-')),profile=path.join(temporary,'profile'),extension=path.join(temporary,'extension');
 fs.mkdirSync(profile);fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-paced.js');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-result.html'),'<!doctype html><title>Ledger pacing check</title>Isolated request test');
 fs.writeFileSync(path.join(extension,'test-paced.js'),`(async()=>{
  const verify=(value,message)=>{if(!value)throw Error(message);};
  try{
   const ids=['a','b','c'].map(c=>'UC'+c.repeat(22)),now=Date.now(),calls=[];let mode='success',active=0,peak=0;
   globalThis.fetch=async url=>{
    active++;peak=Math.max(peak,active);const u=new URL(url);calls.push({url,at:Date.now()});await new Promise(resolve=>setTimeout(resolve,20));active--;
    const channelId=u.searchParams.get('channel_id'),videoId=u.searchParams.get('v');let body,status=200;
    if(channelId){status=mode==='failure'?503:mode==='missing'?404:200;body='<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+channelId+'</yt:channelId><title>Fixture</title></feed>';}
    else if(u.pathname==='/playlist'){status=mode==='missing'?404:503;body='Unavailable';}
    else if(videoId)body='<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId,channelId:ids[0],lengthSeconds:'120',viewCount:'42'},microformat:{playerMicroformatRenderer:{isShortsEligible:false}}})+';</script>';
    else {body='<link rel="canonical" href="'+url+'"><meta property="og:title" content="Fixture channel">';if(mode==='refusal')status=403;}
    const response=new Response(body,{status});Object.defineProperty(response,'url',{value:url});return response;
   };
   await browser.storage.local.set({paused:true,'channelGroups:v1':{version:1,groups:[{id:'g',name:'Large group',channelIds:ids}],channels:Object.fromEntries(ids.map(id=>[id,{id,name:id,url:'https://www.youtube.com/channel/'+id}]))},'channelUploads:v1':{version:1,channels:Object.fromEntries(ids.map((id,i)=>[id,{fetchedAt:1,attemptedAt:1,viewsAttemptedAt:1,entries:[{videoId:String(i).repeat(11),channelId:id,title:'Cached video',publishedAt:now,views:{count:42,checkedAt:now}}]}]))}});
   const sender={tab:{id:999},url:'https://www.youtube.com/feed/subscriptions'};
   const start=performance.now(),cached=await GroupFeeds.handle({type:'groupFeed:get',groupId:'g'},sender);
   verify(cached.entries.length===3&&calls.length===0&&performance.now()-start<1000,'Cached feed must not wait for network');
   await Promise.all([GroupFeeds.handle({type:'groupFeed:refresh',groupId:'g'},sender),GroupFeeds.handle({type:'groupFeed:checkAll'},sender)]);
   verify(calls.length===3,'Overlapping sweeps must deduplicate');
   await Promise.all([GroupFeeds.handle({type:'groupFeed:details',groupId:'g',videoIds:['00000000000']},sender),ChannelGroups.handle({type:'channelGroups:resolve',input:'https://www.youtube.com/channel/'+ids[1]},sender)]);
   verify(calls.length===5,'Feed, detail and channel requests all use the scheduler');
   const expire=async()=>{const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key];for(const id of ids){cache.channels[id].attemptedAt=Date.now()-16*60000;cache.channels[id].retryAt=Date.now()-1;}await browser.storage.local.set({[key]:cache});};
   await expire();mode='missing';await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'g'},sender);
   const missing=await GroupFeeds.handle({type:'groupFeed:get',groupId:'g'},sender);
   verify(calls.length===11&&missing.pausedUntil>Date.now()&&missing.entries.length===3,'Three initial 404s must stop the run and retain cached videos');
   await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'g',force:true},sender);verify(calls.length===11,'Missing feeds must keep individual retry backoff');
   const paused=await GroupFeeds.handle({type:'groupFeed:get',groupId:'g'},sender);verify(paused.pausedUntil>Date.now()&&paused.entries.length===3,'Cooldown must preserve cached feed');
   await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'g',force:true},sender);verify(calls.length===11,'Manual refresh must respect cooldown');
   verify(paused.pauseScope==='automatic'&&paused.pauseReason==='feed-not-found'&&paused.pauseMessage.includes('Three channel upload checks returned HTTP 404'),'Feed pause must explain its scope');
   const channel=await ChannelGroups.handle({type:'channelGroups:resolve',input:'https://www.youtube.com/channel/UC'+'d'.repeat(22)},sender);
   const groups=await ChannelGroups.handle({type:'channelGroups:change',action:'membership',groupId:'g',channel,member:true},sender);
   verify(groups.groups[0].channelIds.includes(channel.id)&&calls.length===12,'Manual addition must resolve and save during a feed pause');
   verify((await YouTubeRequests.status()).pausedUntil===paused.pausedUntil,'Manual addition must not reset the automatic pause');
   mode='refusal';try{await ChannelGroups.handle({type:'channelGroups:resolve',input:'https://www.youtube.com/channel/UC'+'e'.repeat(22)},sender);throw Error('Expected a refusal');}catch(error){verify(error.youtubeStatus===403,'Server refusal must reach caller');}
   try{await ChannelGroups.handle({type:'channelGroups:resolve',input:'https://www.youtube.com/channel/UC'+'f'.repeat(22)},sender);throw Error('Expected a cooldown');}catch(error){verify(error.name==='YouTubeCooldownError'&&error.message.includes('HTTP 403'),'Cooldown must explain the server refusal');}
   verify(calls.length===13&&(await YouTubeRequests.status()).pauseScope==='all','Server refusal must stop subsequent manual requests');
   verify(peak===1&&calls.slice(1).every((call,i)=>call.at-calls[i].at>=1950),'Requests must not overlap or start too closely');
   const diagnostic=await YouTubeRequestLog.snapshot();
   verify(diagnostic.recent.length===calls.length,'Diagnostic count must match actual fetch calls');
   verify(diagnostic.recent.filter(e=>e.status===404).length===6&&diagnostic.recent.filter(e=>e.status===403).length===1,'Diagnostic HTTP failures must be exact');
   verify(Object.values(diagnostic.days).flatMap(Object.values).reduce((n,v)=>n+v.started,0)===calls.length,'Diagnostic totals must exclude cache and cooldown skips');
   await YouTubeRequestLog.handle({type:'requestLog:clear'},{url:browser.runtime.getURL('dashboard.html')});
   verify(calls.length===13&&(await YouTubeRequests.status()).pauseScope==='all','Clearing diagnostics must not clear cooldown or send requests');
   await browser.storage.local.set({'test:result':{ok:true,requests:calls.length,peak,cachedVideos:paused.entries.length}});
  }catch(error){await browser.storage.local.set({'test:result':{ok:false,error:String(error.message||error)+' '+String(error.stack||'')}});}
  await browser.tabs.create({url:browser.runtime.getURL('test-result.html')});
 })();`);
 if(process.argv.includes('--uploads-fallback')){
  const check=require('./uploads-page-browser-test.cjs'),fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'tests/fixtures/uploads-page-playlist.json')));
  fs.writeFileSync(path.join(extension,'test-paced.js'),`(async()=>{try{await (${check.toString()})(${JSON.stringify(fixture)});}catch(error){await browser.storage.local.set({'test:result':{ok:false,error:String(error.stack||error)}});}await browser.tabs.create({url:browser.runtime.getURL('test-result.html')});})();`);
 }
 if(process.argv.includes('--background-feeds')){
  const check=require('./background-feeds-browser-test.cjs');
  fs.writeFileSync(path.join(extension,'test-paced.js'),`(async()=>{try{await (${check.toString()})();}catch(error){await browser.storage.local.set({'test:result':{ok:false,error:String(error.stack||error)}});}await browser.tabs.create({url:browser.runtime.getURL('test-result.html')});})();`);
 }
 // Keep the synthetic background job alive with an extension-page port, as a
 // real content-script request does while it waits for the paced refresh.
 const testFile=path.join(extension,'test-paced.js'),body=fs.readFileSync(testFile,'utf8').replaceAll("await browser.tabs.create({url:browser.runtime.getURL('test-result.html')});",'');
 fs.writeFileSync(testFile,"browser.runtime.onConnect.addListener(port=>{if(port.name==='test-keepalive')port.onMessage.addListener(()=>{});});browser.tabs.create({url:browser.runtime.getURL('test-result.html')});\n"+body);
 new (require('node:vm').Script)(fs.readFileSync(testFile,'utf8'),{filename:'test-paced.js'});
 fs.writeFileSync(path.join(profile,'user.js'),'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.aboutwelcome.enabled", false);\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);');
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','-remote-allow-system-access','--profile',profile,'--remote-debugging-port=0'],{stdio:['ignore','pipe','pipe']});let socket,sequence=0,log='';const pending=new Map();
 try{
  const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Firefox startup timeout '+log)),20000);firefox.once('error',reject);for(const stream of [firefox.stdout,firefox.stderr])stream.on('data',chunk=>{log+=chunk;const match=log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]+'/session');}});});
  socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(!item){if(message.method==='log.entryAdded')log+='\n'+JSON.stringify(message.params);return;}pending.delete(message.id);clearTimeout(item.timer);message.type==='error'?item.reject(Error(message.error+': '+message.message)):item.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error(method+' timeout')),method==='script.evaluate'?130000:30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const session=await send('session.new',{capabilities:{}});await send('session.subscribe',{events:['log.entryAdded']});await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let page;for(let i=0;i<240&&!page;i++){page=(await send('browsingContext.getTree',{})).contexts.find(c=>c.url.endsWith('/test-result.html'));if(!page)await sleep(500);}
  assert.ok(page,'Background checks must finish: '+log.slice(-5000));
  const result=await send('script.evaluate',{expression:'(async()=>{const port=browser.runtime.connect({name:"test-keepalive"}),timer=setInterval(()=>port.postMessage("alive"),1000);try{for(let i=0;i<240;i++){const value=(await browser.storage.local.get("test:result"))["test:result"];if(value)return JSON.stringify(value);await new Promise(resolve=>setTimeout(resolve,500));}return JSON.stringify({ok:false,error:"Timed out: "+JSON.stringify(await browser.storage.local.get(["youtubeRequestLog:v1","youtubeRequests:v1"]))});}finally{clearInterval(timer);port.disconnect();}})()',target:{context:page.context},awaitPromise:true});
  assert.equal(result.type,'success',JSON.stringify(result));const report=JSON.parse(result.result.value);assert.equal(report.ok,true,report.error);
  if(process.argv.includes('--uploads-fallback')){
   await send('browsingContext.navigate',{context:page.context,url:new URL('dashboard.html#settings',page.url).href,wait:'complete'});
   const health=await send('script.evaluate',{target:{context:page.context},awaitPromise:true,expression:`(async()=>{
    const rate=()=>document.getElementById('request-log-rss-rate');for(let i=0;i<100&&rate()?.textContent!=='0%';i++)await new Promise(r=>setTimeout(r,100));
    const before=(await browser.runtime.sendMessage({type:'requestLog:get'})).recent.length;
    const result={rate:rate()?.textContent,pages:document.getElementById('request-log-page-count')?.textContent,last:document.getElementById('request-log-rss-last')?.textContent,attempt:document.getElementById('request-log-rss-attempt')?.textContent,before};
    document.getElementById('request-log-period').value='week';document.getElementById('request-log-period').dispatchEvent(new Event('change'));
    result.after=(await browser.runtime.sendMessage({type:'requestLog:get'})).recent.length;return JSON.stringify(result);
   })()`});
   assert.equal(health.type,'success',JSON.stringify(health));const ui=JSON.parse(health.result.value);
   assert.equal(ui.rate,'0%');assert.equal(ui.pages,'3');assert.match(ui.last,/None recorded/);assert.match(ui.attempt,/HTTP 404/);assert.equal(ui.before,4);assert.equal(ui.after,4);
  }
  console.log('PASS: Firefox '+session.capabilities.browserVersion+(process.argv.includes('--background-feeds')?' background continuation, pacing, warm-cache reuse and opt-out; ':process.argv.includes('--uploads-fallback')?' uploads-page fallback, cached refreshes, source reuse and 429 protection; ':' early failure detection, shared pacing, cached reads, manual additions and server cooldowns; ')+report.requests+' synthetic requests.');
 }finally{socket?.close();firefox.kill();await sleep(500);fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
