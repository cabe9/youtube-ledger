// Check hidden-tab refresh triggers, actual YouTube tab matching, and Settings autosave.
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-background-'));let context,deadline;
 const waitFor=async(surface,predicate)=>{for(let i=0;i<180;i++){if(await surface.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Timed out waiting for background state');};
 try{
  const extension=path.join(profile,'test-extension');fs.cpSync(path.join(__dirname,'dist/chrome'),extension,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.content_scripts[0].js.unshift('test-hidden.js');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(extension,'test-hidden.js'),"Object.defineProperty(document,'visibilityState',{get:()=> 'hidden'});");
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(45000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  deadline=setTimeout(()=>{console.error('Background check exceeded 150 seconds');void context.close();},150000);deadline.unref();
  await worker.evaluate(async()=>{
   const ids=['a','b'].map(c=>'UC'+c.repeat(22));globalThis.backgroundCalls=[];
   globalThis.fetch=async url=>{
    const id=new URL(url).searchParams.get('channel_id');backgroundCalls.push({url,at:Date.now()});
    if(globalThis.holdBackgroundFetch){holdBackgroundFetch=false;await new Promise(resolve=>globalThis.releaseBackgroundFetch=resolve);}
    const response=new Response('<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+id+'</yt:channelId><title>Fixture</title></feed>');Object.defineProperty(response,'url',{value:String(url)});return response;
   };
   await browser.storage.local.set({paused:true,settings:{backgroundGroupChecks:false},'channelGroups:v1':{version:1,groups:[{id:'background',name:'Background test',channelIds:ids}],channels:Object.fromEntries(ids.map(id=>[id,{id,name:'Fixture',url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:Date.now()}]))},'channelUploads:v1':{version:1,channels:{}}});
  });
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<ytd-masthead>YouTube</ytd-masthead><ytd-page-manager><ytd-watch-flexy></ytd-watch-flexy></ytd-page-manager>'}));
  const youtube=await context.newPage();await youtube.goto('https://www.youtube.com/watch?v=abcdefghijk');
  const dashboard=await context.newPage();await dashboard.goto(new URL('dashboard.html#settings',worker.url()).href);
  const setting=dashboard.locator('#setting-backgroundGroupChecks');await setting.waitFor();assert.equal(await setting.isChecked(),false);
  console.log('Checking hidden-tab settings trigger…');
  await setting.check();await waitFor(dashboard,async()=>(await browser.storage.local.get('settings')).settings.backgroundGroupChecks===true);
  await waitFor(dashboard,async()=>Object.keys((await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1'].channels).length===2);
  console.log('Two channels cached; checking requests…');
  const result=await worker.evaluate(async()=>({calls:backgroundCalls,log:await YouTubeRequestLog.snapshot(),cache:(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1']}));
  assert.equal(result.calls.length,2,JSON.stringify(result));assert.ok(result.calls[1].at-result.calls[0].at>=9950);assert.ok(result.log.recent.every(r=>r.mode==='background'));
  await worker.evaluate(async()=>GroupFeeds.handle({type:'groupFeed:checkAll'},{tab:{id:999},url:'https://www.youtube.com/watch?v=abcdefghijk'}));assert.equal((await worker.evaluate(()=>backgroundCalls)).length,2);
  console.log('Warm sweep complete; preparing live progress…');
  await worker.evaluate(async()=>{const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key];Object.values(cache.channels)[0].attemptedAt=1;holdBackgroundFetch=true;await browser.storage.local.set({[key]:cache});});
  await youtube.goto('https://www.youtube.com/feed/subscriptions#ledger-group=background');
  console.log('Group page open; waiting for live counter…');
  await youtube.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('.upload-progress-label')?.textContent==='1 of 2 channels checked');
  const progress=youtube.locator('#ledger-group-feed .upload-progress');assert.equal(await progress.locator('progress').getAttribute('value'),'1');assert.match(await progress.textContent(),/1 already cached/);
  console.log('Partial progress visible; capturing bar…');
  await youtube.locator('#ledger-group-feed').screenshot({path:'/tmp/ledger-background-progress-chrome.png'});
  await waitFor(worker,()=>typeof globalThis.releaseBackgroundFetch==='function');await worker.evaluate(()=>releaseBackgroundFetch());
  await youtube.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('.upload-progress-label')?.textContent==='2 of 2 channels checked');assert.match(await progress.textContent(),/1 refreshed · 1 already cached/);
  await setting.uncheck();await waitFor(dashboard,async()=>(await browser.storage.local.get('settings')).settings.backgroundGroupChecks===false);
  await worker.evaluate(async()=>{const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key];for(const c of Object.values(cache.channels))c.attemptedAt=1;await browser.storage.local.set({[key]:cache});await GroupFeeds.handle({type:'groupFeed:checkAll'},{tab:{id:999},url:'https://www.youtube.com/watch?v=abcdefghijk'});});assert.equal((await worker.evaluate(()=>backgroundCalls)).length,3);
  await youtube.close();await setting.check();await waitFor(dashboard,async()=>(await browser.storage.local.get('settings')).settings.backgroundGroupChecks===true);
  await worker.evaluate(async()=>GroupFeeds.handle({type:'groupFeed:checkAll'},{tab:{id:999},url:'https://www.youtube.com/watch?v=abcdefghijk'}));assert.equal((await worker.evaluate(()=>backgroundCalls)).length,3);
  console.log('PASS: packaged Chrome hidden YouTube tab triggers background refresh, settings autosave, paced checks, live channel progress, cache reuse and stopping after the last YouTube tab closes.');
 }finally{clearTimeout(deadline);await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
