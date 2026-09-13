// Packaged Chromium extension, disposable profile and intercepted pages only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),fixture=require('./watch-evidence-fixture.cjs');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-watch-evidence-'));let context;const errors=[],external=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',p.url(),e.stack);}));
  await context.route('https://www.youtube.com/**',r=>r.request().resourceType()==='script'?r.fulfill({contentType:'application/javascript',body:''}):r.fulfill(r.request().url().endsWith('.wav')?{contentType:'audio/wav',...fixture.mediaResponse(r.request().headers().range)}:{contentType:'text/html',body:fixture.html(r.request().url())}));
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:fixture.svg}));await context.route('https://evil.test/**',r=>{external.push(r.request().url());return r.abort();});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;await worker.evaluate(fixture.seed);
  const data=()=>worker.evaluate(()=>chrome.storage.local.get(null)),until=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out');};
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=watch');const feed=page.locator('#ledger-group-feed');await feed.locator('article').nth(3).waitFor();
  // Ledger hides native cards in a group, so capture only on actual native pages.
  assert.equal((await data())['watchEvidence:v1'],undefined);
  const native=await context.newPage();await native.goto('https://www.youtube.com/feed/subscriptions');
  await until(async()=> (await data())['watchEvidence:v1']?.videos.aaaaaaaaaaa?.percent===95);
  await feed.locator('article').nth(0).getByText('Watched',{exact:true}).waitFor();await feed.locator('article').nth(1).getByText('Started',{exact:true}).waitFor();
  let saved=await data();assert.equal(saved['watchEvidence:v1'].videos.hidden00001,undefined);assert.equal(saved['watchEvidence:v1'].videos.zero0000001,undefined);assert.deepEqual(saved['videoProgress:v1'].videos,{});
  // Native history entries with no completion bar become Seen before; outside cards do not.
  await native.goto('https://www.youtube.com/feed/history#ledger-watch-check');await until(async()=>!!(await data())['watchEvidence:v1']?.videos.ccccccccccc);
  assert.equal((await data())['watchEvidence:v1'].videos.ddddddddddd,undefined);await feed.locator('article').nth(2).getByText('Seen before',{exact:true}).waitFor();
  await page.bringToFront();await feed.locator('[data-focus=filters]').click();await feed.getByRole('checkbox',{name:'Hide previously played',exact:true}).check();await until(async()=>await feed.locator('article').count()===1);assert.match(await feed.locator('article').textContent(),/Video 4/);
  await feed.getByRole('button',{name:'Remove filter: Hide previously played',exact:true}).click();await feed.locator('article').nth(3).waitFor();
  await feed.getByRole('button',{name:'More options for Video 1',exact:true}).click();await feed.getByRole('menuitem',{name:'Mark unwatched',exact:true}).click();await until(async()=>(await data())['videoProgress:v1'].videos.aaaaaaaaaaa?.manual==='unwatched');assert.equal(await feed.locator('article').first().locator('.watch-badge').isVisible(),false);
  // Modal preview, HTML import inertness and cross-tab updates.
  await feed.locator('[data-focus=group-options]').click();await feed.getByRole('menuitem',{name:'Update watch status',exact:true}).click();const modal=page.getByRole('dialog',{name:'Update watch status',exact:true});
  await page.setViewportSize({width:390,height:850});await modal.screenshot({path:'/tmp/ledger-watch-status-mobile.png'});const bounds=await modal.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  await modal.getByLabel('YouTube watch-history file').setInputFiles({name:'watch-history.html',mimeType:'text/html',buffer:Buffer.from(fixture.importHTML)});await modal.getByRole('status').filter({hasText:'Ready to import'}).waitFor();assert.equal((await data())['watchEvidence:v1'].videos.ddddddddddd,undefined);
  await modal.getByRole('button',{name:'Import seen videos',exact:true}).click();await modal.getByRole('status').filter({hasText:'1 video records updated'}).waitFor();assert.deepEqual(external,[]);assert.equal(await page.evaluate(()=>window.importExecuted),undefined);
  await modal.getByRole('button',{name:'Done',exact:true}).click();await feed.locator('article').nth(3).getByText('Seen before',{exact:true}).waitFor();
  // Reload persistence and autosaving opt-out.
  await page.setViewportSize({width:1440,height:1000});await page.reload();await feed.locator('article').nth(3).getByText('Seen before',{exact:true}).waitFor();
  const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${id}/dashboard.html#settings`);await dashboard.getByRole('checkbox',{name:'Learn watch status from YouTube'}).uncheck();await until(async()=>(await data()).settings.learnYouTubeProgress===false);
  await native.goto('https://www.youtube.com/feed/subscriptions');await native.locator('ytd-video-renderer').first().evaluate(row=>{row.querySelector('a').href='/watch?v=eeeeeeeeeee';row.querySelector('#progress').style.width='100%';});await native.waitForTimeout(1800);assert.equal((await data())['watchEvidence:v1'].videos.eeeeeeeeeee,undefined);
  await dashboard.getByRole('button',{name:'Update watch status',exact:true}).click();const popup=context.waitForEvent('page');await dashboard.getByRole('button',{name:'Check YouTube history',exact:true}).click();const history=await popup;await history.waitForLoadState('domcontentloaded');assert.equal(history.url(),'https://www.youtube.com/feed/history#ledger-watch-check');await history.locator('#ledger-watch-check').waitFor();await history.evaluate(()=>window.history.replaceState({fixture:true},'',location.href));await history.getByRole('button',{name:'Done',exact:true}).click();assert.deepEqual(await history.evaluate(()=>window.history.state),{fixture:true});assert.equal(new URL(history.url()).hash,'');
  saved=await data();assert.deepEqual(saved['videoProgress:v1'].videos,{aaaaaaaaaaa:{observed:false,segments:[],manual:'unwatched',externalIgnored:true}});assert.equal(saved['test:unexpected-fetch'],undefined);
  // Real media: seek over the first 18%, then play to the end. No fake seconds.
  const play=await context.newPage();await play.goto('https://www.youtube.com/watch?v=natural0001');await play.locator('video').evaluate(async v=>{await new Promise(r=>v.readyState>=4?r():v.addEventListener('canplaythrough',r,{once:true}));v.currentTime=3.6;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));if(Math.abs(v.currentTime-3.6)>.1)throw Error('Fixture seek failed: '+v.currentTime);v.playbackRate=4;await v.play();});
  await until(async()=>(await data())['videoProgress:v1'].videos.natural0001?.finishedAt>0);
  const result=await worker.evaluate(async()=>{const s=await chrome.storage.local.get(WatchStatus.key),v=s[WatchStatus.key].videos.natural0001;return {state:WatchStatus.state(v),fraction:WatchStatus.fraction(v)};});assert.equal(result.state,'watched');assert.ok(result.fraction>=.8&&result.fraction<.9,JSON.stringify(result));
  assert.deepEqual(errors,[]);console.log('PASS: Chromium native progress/history capture, manual overrides, filtering, inert HTML preview/import, Settings opt-out, native history launch, reload persistence, no metadata fetches, no imported playback, and real 80% natural completion.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
