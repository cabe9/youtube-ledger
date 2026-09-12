// New feed and queue controls in a disposable Firefox profile on live YouTube.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {animatedGif,largeAnimatedGif}=require('./icon-fixtures.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-discovery-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 manifest.content_scripts[0].js.push('test-queue-transition.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 // Trigger the background's actual automatic-step handler without waiting for
 // an entire video/ad in this test. Natural ended events are covered in Chrome.
 fs.writeFileSync(path.join(extension,'test-queue-transition.js'),`document.addEventListener('ledger-test-automatic-step',async()=>{const u=new URL(location.href),hash=new URLSearchParams(u.hash.slice(1)),result=await browser.runtime.sendMessage({type:'groupQueue:step',token:hash.get('ledger-queue'),step:hash.get('ledger-step'),videoId:u.searchParams.get('v'),index:1,automatic:true});location.assign(result.url);});`);
 fs.writeFileSync(path.join(extension,'test-seed.js'),"const A='UC'+'a'.repeat(22),now=Date.now();browser.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:now,updatedAt:now},{id:'music',name:'Music',channelIds:[A],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Test channel',url:'https://www.youtube.com/channel/'+A}}},'groupBrowsing:v1':{version:1,groups:{podcasts:{hidden:[],lastVisitedAt:now-86400000}}},'videoProgress:v1':{version:1,videos:{'26TR58pNuu0':{observed:true,segments:[[0,20]],duration:100,position:20,lastWatchedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,entries:[{videoId:'26TR58pNuu0',channelId:A,channel:'Test channel',title:'Recent episode',publishedAt:now-7200000},{videoId:'hNYoDSvIvuI',channelId:A,channel:'Test channel',title:'Earlier episode',publishedAt:now-172800000}]}}}});");
 if(process.env.LEDGER_TEST_GROUP_SORTING_ONLY==='1'){
  const seed=path.join(extension,'test-seed.js');let source=fs.readFileSync(seed,'utf8');
  source=source.replace('publishedAt:now-7200000}',"publishedAt:now-7200000,views:{count:100,checkedAt:now},details:{status:'available',duration:60,shorts:false,checkedAt:now}}")
   .replace('publishedAt:now-172800000}',"publishedAt:now-172800000,views:{count:200,checkedAt:now},details:{status:'available',duration:3600,shorts:false,checkedAt:now}}");
  fs.writeFileSync(seed,source);
 }
 if(process.env.LEDGER_TEST_SHORTS_PRIORITY_ONLY==='1'){
  const seed=path.join(extension,'test-seed.js');let source=fs.readFileSync(seed,'utf8');
  source=source.replace('publishedAt:now-7200000}',"publishedAt:now-7200000,views:{count:100,checkedAt:now},details:{status:'available',duration:150,checkedAt:now}}")
   .replace('publishedAt:now-172800000}',"publishedAt:now-172800000,views:{count:200,checkedAt:now},details:{status:'available',duration:20,checkedAt:now}}");
  const probe=`const originalTestFetch=globalThis.fetch.bind(globalThis),shortTestGates=new Map(),shortTestRequested=[],shortTestDone=[];
   const reportShortTest=()=>browser.storage.local.set({'test:shorts-probe':{requested:shortTestRequested,done:shortTestDone}});
   browser.storage.onChanged.addListener(changes=>{const id=changes['test:shorts-release']?.newValue;if(id)shortTestGates.get(id)?.();});
   globalThis.fetch=async(url,options)=>{const u=new URL(url),id=u.searchParams.get('v');if(u.pathname!='/watch'||!['26TR58pNuu0','hNYoDSvIvuI'].includes(id))return originalTestFetch(url,options);
    shortTestRequested.push(id);await reportShortTest();await new Promise(resolve=>shortTestGates.set(id,resolve));shortTestDone.push(id);await reportShortTest();
    return {ok:true,url:String(url),text:async()=>'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:id,channelId:A,lengthSeconds:'150',viewCount:'100'},microformat:{playerMicroformatRenderer:{isShortsEligible:id==='26TR58pNuu0'}}})+';</script>'};};`;
  fs.writeFileSync(seed,probe+source);
  fs.appendFileSync(path.join(extension,'test-queue-transition.js'),`document.addEventListener('ledger-test-probe-shorts',async()=>{document.documentElement.dataset.ledgerShortsProbe=JSON.stringify((await browser.storage.local.get('test:shorts-probe'))['test:shorts-probe']||{});});
   document.addEventListener('ledger-test-release-short-first',()=>browser.storage.local.set({'test:shorts-release':'26TR58pNuu0'}));document.addEventListener('ledger-test-release-short-second',()=>browser.storage.local.set({'test:shorts-release':'hNYoDSvIvuI'}));`);
 }
 if(process.env.LEDGER_TEST_REFRESH_ONLY==='1'){
  const seed=path.join(extension,'test-seed.js'),source=fs.readFileSync(seed,'utf8').replace('fetchedAt:now,attemptedAt:now,entries:','fetchedAt:now-3600000,attemptedAt:now-31000,viewsAttemptedAt:now,retryAt:now+60000,error:"YouTube’s upload feed is temporarily unavailable (HTTP 503).",entries:');
  fs.writeFileSync(seed,`const originalRefreshFetch=globalThis.fetch.bind(globalThis);let refreshRequests=0;
   globalThis.fetch=async(url,options)=>{if(!String(url).includes('/feeds/videos.xml'))return originalRefreshFetch(url,options);refreshRequests++;await browser.storage.local.set({'test:refresh-requests':refreshRequests});const id=new URL(url).searchParams.get('channel_id'),response=new Response('<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+id+'</yt:channelId><title>Test channel</title></feed>',{status:refreshRequests<3?503:200});Object.defineProperty(response,'url',{value:String(url)});return response;};\n`+source);
  fs.writeFileSync(path.join(extension,'test-minute-timers.js'),`const originalMinuteInterval=setInterval,minuteCallbacks=[];globalThis.setInterval=(fn,ms,...args)=>{if(ms===60000)minuteCallbacks.push(()=>fn(...args));return originalMinuteInterval(fn,ms,...args);};document.addEventListener('ledger-test-minute',()=>minuteCallbacks.forEach(fn=>fn()));
   document.addEventListener('ledger-test-fail-refresh',async()=>{const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key],channel=Object.values(cache.channels)[0];channel.error='This channel took too long to respond.';channel.retryAt=Date.now()-1;channel.attemptedAt=Date.now()-120000;await browser.storage.local.set({[key]:cache});});`);
  manifest.content_scripts[0].js.unshift('test-minute-timers.js');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 }
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
  'media.volume_scale':'0.0','media.autoplay.default':5,'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
  'browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false
 }).map(([key,value])=>`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','--profile',profile,'--remote-debugging-port=0'],{stdio:['ignore','pipe','pipe']});
 let diagnostic,socket,sequence=0,log='';const pending=new Map();
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
  const {context}=await send('browsingContext.create',{type:'tab'});
  let evaluationContext=context;
  await send('browsingContext.setViewport',{context,viewport:{width:1440,height:1000}});
  async function evaluate(expression){
   const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context:evaluationContext},awaitPromise:true});
   if(result.type==='exception')throw new Error(result.exceptionDetails.text);
   return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
  }
  async function wait(expression){
   const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression+' '+JSON.stringify(await evaluate("return {url:location.href,title:document.title,body:document.body?.innerText.slice(0,500),feed:document.querySelector('#ledger-group-feed')?.shadowRoot?.textContent.slice(-1200),sidebar:!!document.querySelector('#ledger-groups-sidebar')};")));
  }
  diagnostic=()=>evaluate(`return {url:location.href,documentId:window.ledgerDocId,trace:window.ledgerTrace,feed:document.querySelector('#ledger-group-feed')?.shadowRoot?.textContent.slice(-1200),body:document.body?.innerText.slice(0,500)};`);
  await send('script.addPreloadScript',{functionDeclaration:`()=>{window.ledgerDocId=crypto.randomUUID();window.ledgerTrace=[];for(const type of ['yt-navigate-start','yt-navigate-finish','hashchange','popstate'])window.addEventListener(type,()=>{ledgerTrace.push({type,url:location.href,at:performance.now()});});}`});
  const navigate=url=>send('browsingContext.navigate',{context,url,wait:'complete'});
  await navigate('https://www.youtube.com/');
  // Fresh signed-out profiles can trigger YouTube's full themeRefresh navigation.
  // Let that one-time setup finish before interacting, as on an established profile.
  await wait(`return document.readyState==='complete'&&performance.now()>3500&&!!document.querySelector('#ledger-groups-sidebar')?.shadowRoot.querySelector('a');`);
  await evaluate(`const link=document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelector('a');link.focus();link.click();`);
  const feed="document.querySelector('#ledger-group-feed')?.shadowRoot";
  await wait(`return ${feed}?.querySelectorAll('article').length===2;`);
  assert.equal(await evaluate(`return ${feed}.querySelectorAll('.new-upload:not([hidden])').length;`),1);
  await wait(`return [...${feed}.querySelectorAll('article img')].every(image=>image.complete&&image.naturalWidth>0);`);
  if(process.env.LEDGER_TEST_REFRESH_ONLY==='1'){
   await wait(`return !!${feed}.querySelector('[data-focus=retry-failed]');`);
   assert.equal(await evaluate(`return ${feed}.querySelectorAll('.members small').length;`),0);
   await evaluate(`${feed}.querySelector('[data-focus=group-options]').click();${feed}.querySelector('[role=menuitemcheckbox]').click();`);
   await wait(`return !!${feed}.querySelector('[data-focus=refresh-details]');`);
   await evaluate(`window.keptRefreshImage=${feed}.querySelector('article img');${feed}.querySelector('[data-focus=refresh-details]').click();`);
   assert.match(await evaluate(`return ${feed}.querySelector('.members small').textContent;`),/HTTP 503/);
   await evaluate(`${feed}.querySelector('[data-focus=retry-failed]').click();`);await wait(`return ${feed}.querySelector('.status').textContent==='';`);
   assert.equal(await evaluate('return keptRefreshImage.isConnected;'),true);
   await evaluate(`document.dispatchEvent(new Event('ledger-test-fail-refresh'));`);await wait(`return !!${feed}.querySelector('[data-focus=retry-failed]');`);
   await evaluate(`document.dispatchEvent(new Event('ledger-test-minute'));`);await wait(`return ${feed}.querySelector('.status').textContent==='';`);
   assert.equal(await evaluate(`return ${feed}.querySelectorAll('article').length;`),2);assert.equal(await evaluate('return keptRefreshImage.isConnected;'),true);
   console.log('PASS: Firefox explains refresh errors, retries transient failures, automatically recovers failed channels, and keeps cached thumbnails attached.');return;
  }
  if(process.env.LEDGER_TEST_SHORTS_PRIORITY_ONLY==='1'){
   const probe=expression=>wait(`document.dispatchEvent(new Event('ledger-test-probe-shorts'));const state=JSON.parse(document.documentElement.dataset.ledgerShortsProbe||'{}');return ${expression};`);
   await evaluate(`${feed}.querySelector('[data-focus=filters]').click();`);
   assert.equal(await evaluate(`return ${feed}.querySelector('[data-focus=uploadedFilter]').value;`),'week');
   await evaluate(`window.keptShortsImage=${feed}.querySelector('article[data-video-id="hNYoDSvIvuI"] img');const toggle=${feed}.querySelector('[data-focus=hide-shorts]');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true,composed:true}));`);
   await probe('state.requested?.length===2');await evaluate(`document.dispatchEvent(new Event('ledger-test-release-short-first'));`);await probe('state.done?.length===1');await sleep(400);
   assert.equal(await evaluate(`return ${feed}.querySelectorAll('article').length;`),2,'Firefox keeps the batch together while the next classification is pending');
   await evaluate(`document.dispatchEvent(new Event('ledger-test-release-short-second'));`);await wait(`return ${feed}.querySelectorAll('article').length===1;`);
   assert.equal(await evaluate('return keptShortsImage.isConnected;'),true);
   assert.equal(await evaluate(`return ${feed}.querySelector('article').dataset.videoId;`),'hNYoDSvIvuI');
   const savedURL=await evaluate('return location.href;');await navigate(savedURL);await wait(`return ${feed}?.querySelectorAll('article').length===1;`);
   await probe('state.requested?.length===2');console.log('PASS: Firefox seven-day default, grouped Shorts removal, stable normal-video thumbnail, and cached classification on reload.');return;
  }
  if(process.env.LEDGER_TEST_GROUP_SORTING_ONLY==='1'){
   const first=id=>wait(`return ${feed}?.querySelector('article')?.dataset.videoId==='${id}';`);
   const choose=metric=>evaluate(`const control=${feed}.querySelector('[data-focus=sort]');control.value='${metric}';control.dispatchEvent(new Event('change',{bubbles:true,composed:true}));`);
   const reverse=()=>evaluate(`${feed}.querySelector('[data-focus=sort-direction]').click();`);
   const V='26TR58pNuu0',W='hNYoDSvIvuI';await first(V);
   assert.equal(await evaluate(`return ${feed}.querySelector('article .video-stats').textContent;`),'100 views');
   await choose('views');await first(W);await reverse();await first(V);
   const savedURL=await evaluate('return location.href;');await navigate(savedURL);await first(V);
   assert.equal(await evaluate(`return ${feed}.querySelector('[data-focus=sort]').value;`),'views');
   assert.equal(await evaluate(`return ${feed}.querySelector('[data-focus=sort-direction]').dataset.direction;`),'ascending');
   await choose('length');await first(V);await reverse();await first(W);
   await choose('rate');await first(V);assert.match(await evaluate(`return ${feed}.querySelector('article .video-stats').textContent;`),/50 views\/hour/);
   await reverse();await first(W);
   await evaluate(`${feed}.querySelector('[data-focus=play]').click();`);
   await wait(`return !!document.querySelector('#ledger-group-queue')?.shadowRoot.querySelector('button.current');`);
   assert.equal(await evaluate('return new URL(location.href).searchParams.get("v");'),W);
   console.log('PASS: Firefox view counts in the normal feed, separate direction control, saved sorting, views/hour, video length and queue order.');return;
  }
  if(process.env.LEDGER_TEST_GROUP_HEADER_ONLY==='1'){
   const choose=(selector,value)=>evaluate(`const control=${feed}.querySelector(${JSON.stringify(selector)});control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true,composed:true}));`);
   const clickText=(selector,text)=>evaluate(`[...${feed}.querySelectorAll(${JSON.stringify(selector)})].find(button=>button.textContent===${JSON.stringify(text)}).click();`);
   await evaluate(`${feed}.querySelector('[data-focus=filters]').click();`);
   await choose('[data-focus=uploadedFilter]','day');await wait(`return ${feed}.querySelectorAll('article').length===1;`);
   const savedURL=await evaluate('return location.href;');await navigate(savedURL);await wait(`return ${feed}?.querySelectorAll('article').length===1;`);
   assert.equal(await evaluate(`return ${feed}.querySelector('[data-focus=uploadedFilter]').value;`),'day');
   await evaluate(`${feed}.querySelector('.video-options').click();`);await clickText('.video-menu button','Hide this channel');
   await wait(`return ${feed}.querySelectorAll('article').length===0&&!!${feed}.querySelector('.hidden-channel-chip');`);
   await evaluate(`[...document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelectorAll('a')].find(a=>a.textContent==='Music').click();`);await wait(`return location.hash.includes('music')&&${feed}.querySelectorAll('article').length===2;`);
   await navigate(savedURL);await wait(`return ${feed}?.querySelectorAll('article').length===0&&!!${feed}.querySelector('.hidden-channel-chip');`);
   assert.equal(await evaluate(`return ${feed}.querySelector('.hidden-channel-chip').textContent;`),'Hidden: Test channel');
   await evaluate(`${feed}.querySelector('.hidden-channel-chip').click();`);await wait(`return ${feed}.querySelectorAll('article').length===1&&!${feed}.querySelector('.hidden-channel-chip');`);
   assert.equal(await evaluate(`return ${feed}.querySelector('[data-focus=uploadedFilter]').value;`),'day');
   await evaluate(`${feed}.querySelector('[data-focus=clear-filters]').click();`);await wait(`return ${feed}.querySelectorAll('article').length===2;`);
   await evaluate(`${feed}.querySelector('[data-focus=group-options]').click();`);await wait(`return ${feed}.querySelector('.video-menu')?.textContent.includes('Share group');`);
   await evaluate(`${feed}.querySelector('.group-meta').click();`);
   await evaluate(`${feed}.querySelector('[data-focus=play-options]').click();`);await clickText('.video-menu button','Shuffle matching videos');
   await wait(`return location.hash.includes('ledger-queue=')&&!!document.querySelector('#ledger-group-queue')?.shadowRoot.querySelector('button.current');`);
   assert.equal(await evaluate(`return document.querySelector('#ledger-group-queue').shadowRoot.querySelectorAll('ol li').length;`),2);
   console.log('PASS: Firefox header filters and channel exclusion persist through reload, remain group-local, restore correctly, and launch a shuffled group queue.');return;
  }
  if(process.env.LEDGER_TEST_CHANNEL_OVERVIEW_ONLY==='1'){
   const members=`${feed}?.querySelector('.group-members')`;
   assert.equal(await evaluate(`return ${members}.open;`),false);
   await evaluate(`${members}.querySelector('summary').click();`);await wait(`return ${members}?.open;`);
   await evaluate(`window.savedMembers=${members};window.savedMemberLink=${members}.querySelector('a');const input=${feed}.querySelector('.search-group');input.value='Earlier';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));`);
   await wait(`return ${feed}.querySelectorAll('article').length===1;`);
   assert.equal(await evaluate(`return ${members}===savedMembers&&${members}.querySelector('a')===savedMemberLink;`),true,'Firefox keeps channel rows attached when the feed updates');
   await evaluate(`[...document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelectorAll('a')].find(a=>a.textContent==='Music').click();`);
   await wait(`return location.hash.includes('music')&&!!${members};`);assert.equal(await evaluate(`return ${members}.open;`),false);
   await evaluate(`[...document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelectorAll('a')].find(a=>a.textContent==='Podcasts').click();`);
   await wait(`return location.hash.includes('podcasts')&&${members}?.open;`);
   const savedURL=await evaluate('return location.href;');await navigate(savedURL);await wait(`return ${members}?.open;`);
   await evaluate(`${members}.querySelector('summary').click();`);await wait(`return ${members}&&!${members}.open;`);
   await evaluate(`[...document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelectorAll('a')].find(a=>a.textContent==='Music').click();`);await wait(`return location.hash.includes('music')&&!!${members};`);
   await navigate(savedURL);await wait(`return !!${members};`);assert.equal(await evaluate(`return ${members}.open;`),false);
   console.log('PASS: Firefox channel overview: per-group open/closed preferences survive native navigation and reload; channel rows stay attached during filtering.');return;
  }
  await evaluate(`const root=${feed},image=root.querySelector('article img'),grid=root.querySelector('.grid');window.thumbnailProbe={image,grid,detached:0,loads:0};
    image.addEventListener('load',()=>thumbnailProbe.loads++);
    new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===image||node.contains?.(image))thumbnailProbe.detached++;}).observe(root,{childList:true,subtree:true});`);
  await evaluate(`${feed}.querySelector('[data-focus="refresh"]').click();`);
  await wait(`return !${feed}.querySelector('[data-focus="refresh"]').disabled;`);
  assert.deepEqual(await evaluate(`return {sameGrid:${feed}.querySelector('.grid')===thumbnailProbe.grid,sameImage:${feed}.querySelector('article img')===thumbnailProbe.image,detached:thumbnailProbe.detached,loads:thumbnailProbe.loads};`),{sameGrid:true,sameImage:true,detached:0,loads:0},'Firefox refresh keeps the loaded grid and thumbnails connected');
  const reattached=await evaluate(`const host=document.getElementById('ledger-group-feed'),manager=host.parentElement;manager.removeChild(host);
    const frames=[];for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);const image=thumbnailProbe.image;frames.push(host.isConnected&&image.isConnected&&image.complete&&image.naturalWidth>0&&image.getBoundingClientRect().height>0);}return frames;`);
  assert.ok(reattached.every(Boolean),'Loaded Firefox thumbnails survive native page-area reconciliation before every frame');
  // Native Firefox events cross the page/content-script boundary. Guard Home
  // from its endpoint before its URL and page-subtype have changed.
  await wait(`return location.pathname==='/feed/subscriptions';`);
  await evaluate(`window.homeFrames=[];window.homeIntents=[];window.stopHomeFrames=false;
    const intent=e=>{if(e.detail?.url==='/')window.homeIntents.push(document.documentElement.hasAttribute('data-ledger-home'));};
    window.addEventListener('yt-navigate-start',intent,{once:true});
    function frame(){if(location.pathname==='/')homeFrames.push([...document.querySelectorAll('ytd-page-manager > ytd-browse')].every(n=>getComputedStyle(n).display==='none'));if(!stopHomeFrames)requestAnimationFrame(frame);}requestAnimationFrame(frame);
    document.querySelector('ytd-masthead a#logo').click();`);
  await wait(`return location.pathname==='/'&&!document.querySelector('#ledger-group-feed')&&homeFrames.length>=3;`);
  const home=await evaluate(`stopHomeFrames=true;return {frames:homeFrames,intents:homeIntents};`);
  assert.deepEqual(home.intents,[true],'Firefox sees the native Home destination before the URL changes');assert.ok(home.frames.every(Boolean),'Home stays hidden in every observed Firefox frame');
  await evaluate(`document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelector('a').click();`);
  await wait(`return ${feed}?.querySelectorAll('article').length===2;`);
  await evaluate(`const input=${feed}.querySelector('.search-group');input.focus();input.value='Earlier';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));`);
  await wait(`return ${feed}.querySelectorAll('article').length===1;`);
  await evaluate(`const input=${feed}.querySelector('.search-group');input.value='';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));`);
  await wait(`return ${feed}.querySelectorAll('article').length===2;`);
  await evaluate(`${feed}.querySelector('.video-options').click();`);
  await wait(`return ${feed}.querySelector('.video-menu')?.textContent.includes('Resume at 0:20');`);
  await evaluate(`[...${feed}.querySelectorAll('.video-menu button')].find(b=>b.textContent==='Hide from this group').click();`);
  await wait(`return ${feed}.querySelectorAll('article').length===1;`);
  await wait(`return [...${feed}.querySelectorAll('.ledger-undo button')].some(b=>b.textContent==='Undo');`);
  await evaluate(`const undo=[...${feed}.querySelectorAll('.ledger-undo button')].find(b=>b.textContent==='Undo');undo.focus();undo.click();`);
  await wait(`return ${feed}.querySelectorAll('article').length===2;`);
  // A native Firefox link opens the queue in a new tab without reloading it.
  const oldContexts=new Set((await send('browsingContext.getTree',{})).contexts.map(c=>c.context));
  await evaluate(`const link=${feed}.querySelectorAll('.thumbnail')[1];link.target='_blank';link.click();link.removeAttribute('target');`);
  let opened;for(let i=0;i<100&&!opened;i++){opened=(await send('browsingContext.getTree',{})).contexts.find(c=>!oldContexts.has(c.context));if(!opened)await sleep(100);}
  assert.ok(opened,'Link opens a new Firefox tab');evaluationContext=opened.context;
  await send('browsingContext.activate',{context:opened.context});
  await wait(`return location.search.includes('hNYoDSvIvuI')&&!!document.querySelector('#ledger-group-queue')?.shadowRoot.querySelector('button.current');`);
  assert.match(await evaluate(`return document.querySelector('#ledger-group-queue').shadowRoot.querySelector('button.current').textContent;`),/Earlier episode/);
  await send('browsingContext.close',{context:opened.context});evaluationContext=context;await send('browsingContext.activate',{context});
  // A regular card click starts at that video, leaving the group order intact.
  await evaluate(`${feed}.querySelectorAll('.video-title')[1].click();`);
  const panel="document.querySelector('#ledger-group-queue')?.shadowRoot";
  await wait(`return !!${panel}?.querySelector('[aria-label="Next queue video"]');`);
  assert.equal(await evaluate(`return ${panel}.querySelector('input[type=checkbox]').checked;`),false);
  await wait(`return ${panel}.querySelector('li .video-duration')?.textContent==='1:40';`);
  assert.equal(await evaluate(`return ${panel}.querySelectorAll('.video-duration').length;`),2);
  assert.match(await evaluate(`return ${panel}.querySelector('button.current').textContent;`),/Earlier episode/);
  assert.equal(await evaluate(`return ${panel}.querySelector('details').open;`),true);
  await evaluate(`${panel}.querySelector('[aria-label="Previous queue video"]').click();`);
  await wait(`return location.search.includes('26TR58pNuu0')&&!!${panel}?.querySelector('[aria-label="Next queue video"]');`);
  await evaluate(`${panel}.querySelector('[aria-label="Next queue video"]').click();`);
  await wait(`return location.search.includes('hNYoDSvIvuI')&&!!${panel}?.querySelector('[aria-label="Previous queue video"]');`);
  assert.equal(await evaluate(`return ${panel}.querySelector('[aria-label="Next queue video"]').disabled;`),true);
  await evaluate(`const root=${panel};root.querySelector('details').open=true;`);
  const shot=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync(path.join(__dirname,'discovery-firefox-live.png'),Buffer.from(shot.data,'base64'));
  // Strict autoplay permissions apply only to this disposable Firefox profile.
  // The destination uses the real native player and browser permission policy.
  await evaluate(`${panel}.querySelector('[aria-label="Previous queue video"]').click();`);
  await wait(`return location.search.includes('26TR58pNuu0')&&!!${panel}?.querySelector('input');`);
  await evaluate(`${panel}.querySelector('input').click();`);
  await wait(`return !${panel}.querySelector('input').disabled;`);
  await evaluate(`document.dispatchEvent(new Event('ledger-test-automatic-step'));`);
  await wait(`return location.search.includes('hNYoDSvIvuI')&&${panel}?.querySelector('[role=status]')?.textContent.includes('Your browser blocked autoplay.');`);
  assert.equal(await evaluate(`return document.querySelector('#movie_player video').paused;`),true);
  // WebDriver pointer input is a genuine user gesture for native media policy.
  await evaluate(`const play=document.createElement('button');play.textContent='Start test playback';play.style.cssText='position:fixed;top:100px;left:20px;width:160px;height:40px;z-index:2147483647';play.onclick=()=>document.querySelector('#movie_player video').play();document.body.append(play);`);
  await send('input.performActions',{context,actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',x:100,y:120,origin:'viewport'},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
  await wait(`const video=document.querySelector('#movie_player video');return !video.paused&&video.currentTime>.1&&${panel}.querySelector('[role=status]').textContent==='Autoplay is on for this group queue.';`);
  await evaluate(`document.querySelector('#movie_player video').pause();`);await sleep(600);
  assert.equal(await evaluate(`return document.querySelector('#movie_player video').paused;`),true,'Autoplay respects a later pause in Firefox');
  await evaluate(`${panel}.querySelector('[aria-label="Close group queue"]').click();`);await wait(`return !${panel};`);
  console.log('PASS: Firefox on live YouTube: stable loaded thumbnails, Home frame guard, search, progress/Resume menu, hide/Undo, selected-video queue in current and new tabs, expanded list, next/previous boundaries, autoplay permission denial and recovery by a real click, respecting pause and close. Playback tracking paused in disposable profile.');
 }catch(error){try{console.log(JSON.stringify(await diagnostic?.()));}catch{}throw error;}finally{
  for(const item of pending.values())clearTimeout(item.timer);
  socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
