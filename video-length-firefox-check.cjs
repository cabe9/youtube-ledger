// Real Firefox duration badges on a public YouTube feed, in a disposable profile.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-length-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),"(async()=>{\n const A='UCvryaJCRHcTVjOC_DcuYxGg',V='26TR58pNuu0',B='UCX6OQ3DkcsbYNE6H8uQQuVA',S='5mU6SRS2Bxo',now=Date.now();\n let releaseDuration;const durationGate=new Promise(resolve=>releaseDuration=resolve);browser.storage.onChanged.addListener(changes=>{if(changes['duration-test-release']?.newValue)releaseDuration();});const original=globalThis.fetch.bind(globalThis);globalThis.fetch=async(...args)=>{if(String(args[0])==='https://www.youtube.com/watch?v='+V){const prior=await browser.storage.local.get('duration-test-requests');await browser.storage.local.set({'duration-test-requests':(prior['duration-test-requests']||0)+1});await durationGate;}return original(...args);};\n await browser.storage.local.set({paused:true,settings:Ledger.settings({theme:'retrowave'}),'videoProgress:v1':{version:1,videos:{}},'channelGroups:v1':{version:1,groups:[{id:'lengths',name:'Podcasts',channelIds:[A,B],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Learn Japanese with Tanaka san',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now},[B]:{id:B,name:'MrBeast',url:'https://www.youtube.com/channel/'+B,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,error:'',entries:[{videoId:V,channelId:A,channel:'Learn Japanese with Tanaka san',title:'Public video duration check',publishedAt:now-86400000},{videoId:'bbbbbbbbbbb',channelId:A,channel:'Example creator',title:'A longer episode',publishedAt:now-2*86400000,details:{status:'available',duration:3661,checkedAt:now,shorts:false}},{videoId:'ccccccccccc',channelId:A,channel:'Example creator',title:'Scheduled premiere',publishedAt:now-3*86400000,details:{status:'upcoming',checkedAt:now,shorts:false}}]},[B]:{fetchedAt:now,attemptedAt:now,error:'',entries:[{videoId:S,channelId:B,channel:'MrBeast',title:'Public YouTube Short',publishedAt:now-4*86400000}]}}}});\n await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?duration-test=1#settings')});\n})();");
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
  'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
  'browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false
 }).map(([key,value])=>`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','--profile',profile,'--remote-debugging-port=0'],{stdio:['ignore','pipe','pipe']});
 let socket,sequence=0,log='';const pending=new Map();
 try{
  const endpoint=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Firefox startup timed out: '+log)),20000);
   firefox.once('error',error=>{clearTimeout(timer);reject(error);});
   firefox.once('exit',code=>{clearTimeout(timer);reject(new Error('Firefox exited: '+code+' '+log));});
   for(const stream of [firefox.stdout,firefox.stderr])stream.on('data',chunk=>{
    log+=chunk.toString();const match=log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
    if(match){clearTimeout(timer);resolve(match[1]+'/session');}
   });
  });
  socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.type==='error'?item.reject(new Error(message.error+': '+message.message)):item.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const session=await send('session.new',{capabilities:{}});console.log('Firefox '+session.capabilities.browserVersion);
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let dashboard;for(let attempt=0;attempt<100&&!dashboard;attempt++){dashboard=(await send('browsingContext.getTree',{})).contexts.find(tab=>tab.url.includes('duration-test=1'));if(!dashboard)await sleep(100);}assert.ok(dashboard,'Seed dashboard opened');
  const {context}=await send('browsingContext.create',{type:'tab'});await send('browsingContext.activate',{context});
  await send('browsingContext.setViewport',{context,viewport:{width:1440,height:1000}});
  async function evaluate(expression){
   const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context},awaitPromise:true});
   if(result.type==='exception')throw new Error(result.exceptionDetails.text);
   return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
  }
  async function wait(expression){
   const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression);
  }
  const navigate=url=>send('browsingContext.navigate',{context,url,wait:'complete'});
  await navigate('https://www.youtube.com/feed/subscriptions#ledger-group=lengths');

  const root="document.querySelector('#ledger-group-feed')?.shadowRoot";
  await wait(`return ${root}?.querySelectorAll('article').length===4;`);
  // Let YouTube finish its own initial page replacement before testing a metadata-only update.
  await wait(`const image=${root}?.querySelector('.thumbnail img');if(window.lengthImage!==image){window.lengthImage=image;window.lengthStableSince=Date.now();}return image&&Date.now()-window.lengthStableSince>1500;`);
  await send('script.evaluate',{expression:"browser.storage.local.set({'duration-test-release':true})",target:{context:dashboard.context},awaitPromise:true});
  await wait(`return ${root}?.querySelector('article .video-duration')?.textContent==='6:19';`);
  await wait(`return ${root}?.querySelector('article[data-video-id=\"5mU6SRS2Bxo\"] .video-duration')?.textContent==='0:36';`);
  assert.deepEqual(await evaluate(`return [...${root}.querySelectorAll('.video-duration')].map(el=>el.textContent);`),['6:19','1:01:01','Upcoming','0:36']);
  assert.equal(await evaluate(`return window.lengthImage===${root}.querySelector('.thumbnail img');`),true,'Firefox keeps the same thumbnail node');
  async function storage(){const result=await send('script.evaluate',{expression:'browser.storage.local.get(null).then(JSON.stringify)',target:{context:dashboard.context},awaitPromise:true});if(result.type==='exception')throw Error(result.exceptionDetails.text);return JSON.parse(result.result.value);}
  let saved=await storage();assert.equal(saved['duration-test-requests'],1);assert.equal(saved['channelUploads:v1'].channels['UCvryaJCRHcTVjOC_DcuYxGg'].entries[0].details.duration,379);
  assert.equal(saved['channelUploads:v1'].channels['UCX6OQ3DkcsbYNE6H8uQQuVA'].entries[0].details.shorts,true,'Public Short is classified by YouTube');
  assert.equal(saved['channelUploads:v1'].channels['UCvryaJCRHcTVjOC_DcuYxGg'].entries[0].details.shorts,false);
  await evaluate(`${root}.querySelector('[data-focus="hide-shorts"]').click();`);
  await wait(`return ${root}?.querySelectorAll('article').length===3;`);
  assert.equal(await evaluate(`return window.lengthImage===${root}.querySelector('.thumbnail img');`),true,'Filtering keeps the normal video thumbnail');
  assert.deepEqual(saved['videoProgress:v1'],{version:1,videos:{}});assert.ok(!Object.keys(saved).some(key=>key.startsWith('day:')));
  const shot=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync('/tmp/ledger-video-length-firefox.png',Buffer.from(shot.data,'base64'));
  await send('browsingContext.reload',{context,wait:'complete'});await wait(`return ${root}?.querySelector('article .video-duration')?.textContent==='6:19';`);await sleep(400);saved=await storage();assert.equal(saved['duration-test-requests'],1,'Firefox reuses cached metadata after reload');assert.equal(saved['channelGroups:v1'].groups[0].hideShorts,true);assert.equal(await evaluate(`return ${root}.querySelector('[data-focus=\"hide-shorts\"]').checked&&${root}.querySelectorAll('article').length===3;`),true);
  console.log('PASS: Firefox public-page metadata resolves to 6:19; hour-long and Upcoming badges render, thumbnails persist, no watch state/history is created, Hide Shorts removes a real public Short, and reload retains the filter and cache.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
