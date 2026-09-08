// Actual extension in a disposable profile with controlled YouTube navigation and playback.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=__dirname,A='UC'+'a'.repeat(22),V='aaaaaaaaaaa';
function fixture(url){
 const u=new URL(url);
 const channel=/^\/(?:@|channel\/|c\/|user\/)/.test(u.pathname),watch=u.pathname==='/watch';
   return `<!doctype html><html><head><meta property="og:title" content="Alpha"><link rel="canonical" href="https://www.youtube.com/channel/${A}"></head><body><ytd-browse page-subtype="${channel?'channels':'subscriptions'}"><a id="creator" href="/@alpha/videos">Alpha channel</a><a id="upload" href="/watch?v=${V}">Alpha episode</a></ytd-browse>${watch?`<ytd-watch-metadata><h1>Alpha episode</h1><div id="channel-name"><a href="/channel/${A}">Alpha</a></div></ytd-watch-metadata><video controls src="/fixture.wav"></video>`:''}<div id="related"><a id="recommended" href="/watch?v=${V}">Recommended Alpha episode</a></div></body></html>`;
}
module.exports={fixture};
if(require.main===module)(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-channel-source-'));let context;const errors=[];
 try{
  const extension=path.join(root,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const wav=Buffer.alloc(44+8000*20*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  await context.route('https://www.youtube.com/**',r=>{
   const u=new URL(r.request().url());if(u.pathname==='/fixture.wav')return r.fulfill({contentType:'audio/wav',body:wav});
   return r.fulfill({contentType:'text/html',body:fixture(u.href)});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({paused:false,settings:Ledger.settings({hideRecommendations:false})}));
  const page=await context.newPage();
  async function observed(p){
   const cdp=await context.newCDPSession(p),worlds=[];cdp.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await cdp.send('Runtime.enable');
   try{for(let n=0;n<50;n++){const world=worlds.find(w=>w.name===id||w.origin==='chrome-extension://'+id);if(world){const result=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:`JSON.stringify(PlaybackSource.read('${V}'))`,returnByValue:true});const data=result.result.value&&JSON.parse(result.result.value);if(data?.videoId)return data;}await p.waitForTimeout(100);}throw Error('No source');}finally{await cdp.detach();}
  }
  async function world(p,expression){const cdp=await context.newCDPSession(p),worlds=[];cdp.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await cdp.send('Runtime.enable');const w=worlds.find(w=>w.name===id||w.origin==='chrome-extension://'+id);assert.ok(w);const result=await cdp.send('Runtime.evaluate',{contextId:w.id,expression,returnByValue:true,awaitPromise:true});await cdp.detach();assert.equal(result.exceptionDetails,undefined);return result.result.value;}
  await page.goto('https://www.youtube.com/feed/subscriptions');await page.locator('#creator').click();await page.waitForURL('**/@alpha/videos');await page.locator('#upload').click();await page.waitForURL('**/watch?**');
  assert.equal((await observed(page)).source.kind,'channel','Subscriptions → creator → video records Channel page');
  const beforeCanonical=await observed(page);await page.evaluate(()=>{history.replaceState({},'',location.pathname+location.search);document.dispatchEvent(new Event('yt-navigate-finish'));});const afterCanonical=await observed(page);assert.equal(afterCanonical.id,beforeCanonical.id,'URL cleanup preserves the observed visit');
  await world(page,fs.readFileSync(path.join(root,'watch-source.js'),'utf8'));assert.equal((await observed(page)).id,beforeCanonical.id,'Reinjecting in the same document preserves the visit');
  await page.bringToFront();await page.locator('video').evaluate(v=>v.play());await page.waitForTimeout(2400);await page.locator('video').evaluate(v=>{v.pause();v.dispatchEvent(new Event('ended',{bubbles:true}));});await page.waitForTimeout(2500);
  const saved=await worker.evaluate(()=>chrome.storage.local.get(null));const sessions=Object.entries(saved).filter(([key])=>key.startsWith('day:')).flatMap(([,rows])=>rows);
  assert.ok(sessions.some(row=>row.source.kind==='channel'&&Object.values(row.seconds).some(n=>n>0)),'Actual playback saved as channel');
  await page.goto('https://www.youtube.com/results?search_query=Alpha');await page.locator('#creator').click();await page.waitForURL('**/@alpha/videos');
  await page.locator('#upload').evaluate(a=>a.target='_blank');const opened=context.waitForEvent('page');await page.locator('#upload').click();const tab=await opened;await tab.waitForLoadState('domcontentloaded');assert.equal((await observed(tab)).source.kind,'channel','Search → creator → new-tab video also records Channel page');await tab.close();
  await page.goto('https://www.youtube.com/channel/'+A+'/videos');await page.locator('#upload').evaluate(a=>a.addEventListener('click',e=>{e.preventDefault();history.pushState({},'',a.href);document.dispatchEvent(new Event('yt-navigate-finish'));}));await page.locator('#upload').click();assert.equal((await observed(page)).source.kind,'channel','Native SPA navigation preserves Channel page');
  // Source resolution can still be pending when YouTube replaces the link URL.
  await page.goto('https://www.youtube.com/@alpha/videos');await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('ledger:watch-source')||'null')?.videoId==='');
  await world(page,"globalThis.originalSourceSend=browser.runtime.sendMessage;browser.runtime.sendMessage=message=>message.type==='sourceContext:get'?new Promise(resolve=>setTimeout(resolve,400)).then(()=>originalSourceSend(message)):originalSourceSend(message);");
  const spaCleanup=a=>a.addEventListener('click',e=>{e.preventDefault();history.pushState({},'',a.href);document.dispatchEvent(new Event('yt-navigate-finish'));history.replaceState({},'',location.pathname+location.search);document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.locator('#upload').evaluate(spaCleanup);await page.locator('#upload').click();assert.equal((await observed(page)).source.kind,'channel','URL cleanup while resolving keeps the source');
  const beforeClick=await observed(page);await page.locator('#recommended').evaluate(spaCleanup);await page.locator('#recommended').click();const clicked=await observed(page);assert.equal(clicked.source.kind,'recommendations','A fresh click on the same video takes priority over URL continuity');assert.notEqual(clicked.id,beforeClick.id);
  await page.goto('https://www.youtube.com/feed/subscriptions');await page.locator('#upload').click();assert.equal((await observed(page)).source.kind,'subscriptions','Direct feed click remains Subscriptions');
  await page.goto('https://www.youtube.com/watch?v='+V);assert.equal((await observed(page)).source.kind,'unknown','Direct links do not inherit Channel page');await page.locator('#recommended').click();assert.equal((await observed(page)).source.kind,'recommendations','Same creator from recommendations remains Recommendations');
  // A cold/reinjected script may still be waiting for the paused setting when URL cleanup runs.
  await world(page,"globalThis.originalStorageGet=browser.storage.local.get.bind(browser.storage.local);browser.storage.local.get=keys=>keys==='paused'?new Promise(resolve=>setTimeout(resolve,400)).then(()=>originalStorageGet(keys)):originalStorageGet(keys);sessionStorage.removeItem('ledger:watch-source');");
  await world(page,fs.readFileSync(path.join(root,'watch-source.js'),'utf8'));
  await page.evaluate(()=>{history.replaceState({},'',location.pathname+location.search);document.dispatchEvent(new Event('yt-navigate-finish'));});
  assert.equal((await observed(page)).source.kind,'recommendations','Initial link evidence survives URL cleanup before storage is ready');
  await world(page,'browser.storage.local.get=originalStorageGet');
  await worker.evaluate(()=>chrome.storage.local.set({paused:true}));await page.waitForFunction(()=>sessionStorage.getItem('ledger:watch-source')===null);
  await worker.evaluate(()=>chrome.storage.local.set({paused:false}));await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('ledger:watch-source')||'null')?.source.kind==='unknown');assert.equal((await observed(page)).source.kind,'unknown','Resuming recording does not reuse a stale visit');
  const dashboard=await context.newPage();await dashboard.goto('chrome-extension://'+id+'/dashboard.html#history');await dashboard.locator('#source-filter option[value="channel"]').waitFor({state:'attached'});await dashboard.locator('#source-filter').selectOption('channel');assert.match(await dashboard.locator('#rows .source-badges').innerText(),/Channel page/);
  const report=await dashboard.evaluate(()=>report());assert.ok(report.sources.some(s=>s.key==='channel'));assert.ok(report.rawSessions.some(s=>s.source.kind==='channel'));assert.ok(report.dailyVideos.some(v=>v.sources.some(s=>s.source.kind==='channel')));assert.equal(await dashboard.evaluate(()=>Ledger.sourceLabel({kind:'unknown'})),'Source not captured');assert.deepEqual(errors,[]);
  console.log('PASS: creator-first navigation from subscriptions/search, same-tab/new-tab/SPA channel clicks, saved playback, History Channel page filter and LLM export; direct subscription clicks, recommendations and unknown direct links remain distinct. Canonical URL cleanup and source-script reinjection preserve observed visits.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
