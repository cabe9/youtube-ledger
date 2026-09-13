const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),fixture=require('./new-videos-fixture.cjs');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-arrivals-'));let context;const errors=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:fixture.html()}));await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:fixture.svg}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(fixture.seed);const data=()=>worker.evaluate(()=>chrome.storage.local.get(null)),before=(await data())['videoProgress:v1'];
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-new');const feed=page.locator('#ledger-group-feed'),nav=page.locator('#ledger-groups-sidebar');await feed.locator('article').nth(2).waitFor();
  assert.equal(await feed.locator('article').count(),3);assert.equal(await nav.locator('[data-new-videos] .new-count').textContent(),'3');assert.equal(await feed.locator('article').first().locator('.watch-badge').textContent(),'Watched');
  assert.equal(await feed.locator('article[data-video-id=aaaaaaaaaaa] .arrival-memberships a').count(),2);assert.equal(await feed.locator('.creator-return').textContent(),'Back after 8 months');
  assert.equal(await feed.locator('.upload-progress,.freshness,.group-members').count(),0);
  await page.screenshot({path:'/tmp/ledger-new-videos-chrome.png',fullPage:true});
  await feed.getByRole('button',{name:'Returning creators',exact:true}).click();assert.equal(await feed.locator('article').count(),1);assert.equal(await feed.locator('article').getAttribute('data-video-id'),'aaaaaaaaaaa');
  await feed.getByRole('button',{name:'New arrivals',exact:true}).click();await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).check();assert.equal(await feed.locator('article').count(),2);
  await feed.getByRole('button',{name:'Caught up',exact:true}).click();await feed.getByText('You’re caught up. All recent keeps these videos available.',{exact:true}).waitFor();assert.deepEqual((await data())['videoProgress:v1'],before);
  await feed.getByRole('button',{name:'All recent',exact:true}).click();await feed.locator('article').nth(1).waitFor();assert.equal(await feed.locator('.new-upload:visible').count(),0);await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).uncheck();assert.equal(await feed.locator('.new-upload:visible').count(),1);
  await feed.getByRole('button',{name:'Caught up',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelector('[data-new-videos] .new-count'));
  await worker.evaluate(fixture.addLate);await feed.locator('article[data-video-id=late0000001]').waitFor();await feed.getByRole('button',{name:'New arrivals',exact:true}).click();assert.equal(await feed.locator('article').count(),1);
  await page.reload();await feed.locator('article[data-video-id=late0000001]').waitFor();assert.equal(await feed.locator('article').count(),1);
  // Watch actions and honest source survive the aggregate view.
  await feed.locator('.video-options').click();await feed.getByRole('menuitem',{name:'Mark watched',exact:true}).click();await feed.locator('.watch-badge').getByText('Watched',{exact:true}).waitFor();
  const launch=await feed.locator('.thumbnail').getAttribute('href');const source=await worker.evaluate(async url=>GroupFeeds.handle({type:'groupFeed:source',token:new URL(url).hash.slice('#ledger-launch='.length),videoId:'late0000001'},{url:'https://www.youtube.com/watch?v=late0000001',tab:{id:1}}),launch);assert.equal(source.groupName,'New videos');
  await page.setViewportSize({width:390,height:850});await feed.screenshot({path:'/tmp/ledger-new-videos-mobile.png'});const size=await feed.boundingBox();assert.ok(size.x>=0&&size.x+size.width<=390);
  await page.setViewportSize({width:1440,height:1000});await feed.locator('.arrival-memberships').getByRole('link',{name:'Learn Japanese',exact:true}).click();await feed.locator('[data-focus=group-options]').waitFor();assert.ok(page.url().endsWith('#ledger-group=learn'));await feed.locator('.creator-return').waitFor();
  await nav.locator('[data-new-videos]').click();await feed.locator('[data-focus=caught-up]').waitFor();assert.ok(page.url().endsWith('#ledger-new'));
  // Group-local hiding/removal updates the open combined view and its labels.
  await feed.getByRole('button',{name:'All recent',exact:true}).click();await worker.evaluate(async()=>{const s=await browser.storage.local.get('channelGroups:v1');s['channelGroups:v1'].groups=s['channelGroups:v1'].groups.filter(g=>g.id==='relax');await browser.storage.local.set(s);});
  await page.waitForFunction(()=>[...document.querySelector('#ledger-group-feed').shadowRoot.querySelectorAll('.arrival-memberships a')].every(a=>a.textContent==='Listening practice'));assert.equal(await feed.locator('article[data-video-id=ccccccccccc]').count(),0);
  assert.equal((await data())['test:unexpected-fetch'],undefined);assert.deepEqual(errors,[]);console.log('PASS: Chromium deduplication, badges, caught-up snapshot, late arrivals, watch-state independence, group links, source, cached-only loading, live membership edits, reload and mobile layout.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
