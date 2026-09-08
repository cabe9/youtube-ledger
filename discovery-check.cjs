const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),V='a'.repeat(11),W='b'.repeat(11);
const blockAutoplay=process.env.LEDGER_TEST_BLOCK_AUTOPLAY==='1';
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-discovery-'));let context;const errors=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:['--autoplay-policy='+(blockAutoplay?'document-user-activation-required':'no-user-gesture-required'),`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const samples=8000*20,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  await context.route('https://www.youtube.com/**',route=>{
   const u=new URL(route.request().url());if(u.pathname==='/fixture.wav')return route.fulfill({contentType:'audio/wav',body:wav});if(!['document','fetch','xhr'].includes(route.request().resourceType()))return route.fulfill({status:204,body:''});
   const c=u.pathname.includes(B)?B:A;return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta property="og:title" content="${c===A?'Alpha':'Beta'}"><link rel="canonical" href="https://www.youtube.com/channel/${c}"><style>body{font:14px Arial;background:#171717;color:white}ytd-guide-renderer{display:block;width:230px;float:left}ytd-page-manager{display:block;margin-left:240px}ytd-guide-section-renderer,ytd-guide-entry-renderer{display:block}button,a{color:inherit}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-page-manager{margin-left:0}}</style></head><body><ytd-masthead><div id="center"><yt-searchbox><input></yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer><ytd-guide-section-renderer><ytd-guide-entry-renderer><a href="/channel/${A}">Alpha</a></ytd-guide-entry-renderer></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="${u.pathname==='/'?'home':'subscriptions'}"><div id="related"><a id="recommended" href="/watch?v=${V}" target="_blank">Recommended video</a></div><ytd-channel-renderer><a href="/channel/${B}">Beta</a></ytd-channel-renderer><ytd-watch-flexy><div id="secondary-inner"></div></ytd-watch-flexy><ytd-watch-metadata><h1>Fixture episode</h1><div id="channel-name"><a href="/channel/${A}">Alpha</a></div></ytd-watch-metadata><video controls src="/fixture.wav"></video><button class="ytp-autonav-toggle-button" aria-checked="true">Autoplay</button><a class="ytp-next-button" href="/watch?v=${W}">Next</a></ytd-browse></ytd-page-manager><script>window.leakedMenuKeys=[];window.addEventListener('keydown',event=>{if([' ','ArrowDown','ArrowUp','Escape'].includes(event.key)){window.leakedMenuKeys.push(event.key);event.preventDefault();}},true);</script></body></html>`});
  });
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#2d493b"/><circle cx="240" cy="135" r="70" fill="#415d4d"/></svg>'}));
  const day=await worker.evaluate(()=>Ledger.dayKey(Date.now()));
  await worker.evaluate(({A,B,V,W,day})=>{
   const now=Date.now(),rows=[];for(const [name,source,seconds] of [['g',{kind:'group',groupId:'podcasts',groupName:'Podcasts'},3],['r',{kind:'recommendations'},4]])Ledger.add(rows,{id:name,videoId:V,title:'Episode one',channel:'Alpha',url:'https://www.youtube.com/watch?v='+V,start:now-seconds*1000,end:now,state:'foreground',source});
   return chrome.storage.local.set({settings:Ledger.settings({hideRecommendations:false,theme:'retrowave'}),['day:'+day]:rows,['goals:'+day]:'Listen thoughtfully','channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:now,updatedAt:now},{id:'music',name:'Music',channelIds:[],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A}}},'videoProgress:v1':{version:1,videos:{[V]:{observed:true,segments:[[0,10]],duration:100,position:10,lastWatchedAt:now}}},'groupBrowsing:v1':{version:1,groups:{podcasts:{hidden:[],lastVisitedAt:now-86400000}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,error:'',entries:[{videoId:V,channelId:A,channel:'Alpha',title:'Episode one',publishedAt:now-2*3600000},{videoId:W,channelId:A,channel:'Alpha',title:'Episode two',publishedAt:now-2*86400000}]}}}});
  },{A,B,V,W,day});
  if(blockAutoplay){
   const url=await worker.evaluate(async({V,W})=>{
    const sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'},created=await GroupQueue.handle({type:'groupQueue:create',groupId:'podcasts',videoIds:[V,W]},sender),hash=new URLSearchParams(new URL(created.url).hash.slice(1)),ctx={token:hash.get('ledger-queue'),step:hash.get('ledger-step'),videoId:V};
    await GroupQueue.handle({type:'groupQueue:auto',...ctx,auto:true},sender);return (await GroupQueue.handle({type:'groupQueue:step',...ctx,index:1,automatic:true},sender)).url;
   },{V,W});
   const page=await context.newPage();await page.goto(url);const panel=page.locator('#ledger-group-queue');
   await panel.getByRole('status').filter({hasText:'Your browser blocked autoplay.'}).waitFor();
   assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
   await page.evaluate(()=>{const button=document.createElement('button');button.id='allow-play';button.textContent='Play video';button.onclick=()=>document.querySelector('video').play();document.body.append(button);});
   await page.locator('#allow-play').click();await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').currentTime>.1);
   await panel.getByRole('status').filter({hasText:'Autoplay is on for this group queue.'}).waitFor();
   await page.locator('video').evaluate(v=>v.pause());await page.waitForTimeout(600);assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
   assert.deepEqual(errors,[]);console.log('PASS: browser autoplay denial stays paused and displays guidance; a real user click starts playback and clears the notice; subsequent pause is respected.');return;
  }
  const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${id}/dashboard.html#history`);
  await dashboard.locator('#source-totals').filter({hasText:'Group: Podcasts: 3s'}).waitFor();assert.match(await dashboard.locator('#rows').innerText(),/Recommendations · 4s/);
  await dashboard.locator('#source-filter').selectOption('group:podcasts');await dashboard.locator('#rows .source-badges').filter({hasText:'Group: Podcasts · 3s'}).waitFor();assert.doesNotMatch(await dashboard.locator('#rows').innerText(),/Recommendations/);assert.match(await dashboard.locator('#review-rows').innerText(),/Recommendations · 4s/);
  await dashboard.evaluate(()=>document.activeElement.blur());
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');const feed=page.locator('#ledger-group-feed'),sidebar=page.locator('#ledger-groups-sidebar');await feed.locator('article').nth(1).waitFor();
  assert.match(await feed.locator('time').first().innerText(),/2 hours ago/);assert.match(await feed.locator('time').nth(1).innerText(),/2 days ago/);assert.ok(await feed.locator('time').first().getAttribute('title'));
  assert.equal(await feed.getByText('New since your last visit',{exact:true}).count(),1);
  assert.equal(await feed.locator('.new-upload:not([hidden])').count(),1);assert.match(await feed.locator('.freshness').innerText(),/checked/);
  const search=feed.getByRole('searchbox',{name:'Search this group'});await search.fill('Episode two');assert.equal(await feed.locator('article').count(),1);
  await search.press('End');await page.keyboard.press('Space');await page.keyboard.type('extra');assert.equal(await search.inputValue(),'Episode two extra');assert.equal(await feed.locator('article').count(),0);
  await search.fill('Alpha');assert.equal(await feed.locator('article').count(),2);await search.fill('');
  await feed.getByRole('button',{name:'Sort ascending',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article').dataset.videoId==='b'.repeat(11));
  await feed.getByRole('button',{name:'Sort descending',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article').dataset.videoId==='a'.repeat(11));
  const options=()=>feed.getByRole('button',{name:'More options for Episode one',exact:true}),menu=()=>feed.getByRole('menu');
  assert.equal(await feed.locator('article').first().locator('.playback-progress i').evaluate(e=>e.style.width),'10%');
  await options().click();assert.equal(await menu().getByRole('menuitem',{name:'Resume at 0:10'}).count(),1);await page.keyboard.press('Escape');
  await feed.screenshot({path:path.join(__dirname,'discovery-feed-preview.png')});
  await options().click();await menu().getByRole('menuitem',{name:'Hide from this group'}).click();await options().waitFor({state:'detached'});
  assert.equal(await feed.locator('.ledger-undo').isVisible(),true);await feed.locator('.ledger-undo').getByRole('button',{name:'Undo',exact:true}).click();await options().waitFor();
  await options().click();await menu().getByRole('menuitem',{name:'Hide from this group'}).click();await options().waitFor({state:'detached'});
  await feed.getByRole('button',{name:/^Filters/}).click();await feed.getByRole('checkbox',{name:'Show hidden videos only'}).check();await options().waitFor();assert.equal(await feed.getByRole('button',{name:'Play group',exact:true}).isDisabled(),true);
  await options().click();await menu().getByRole('menuitem',{name:'Restore to feed'}).click();await options().waitFor({state:'detached'});
  await feed.getByRole('button',{name:'Continue watching',exact:true}).click();await options().waitFor();assert.equal(await feed.locator('article').count(),1);
  // Resume keeps the timestamp and the currently filtered group queue.
  await options().click();await Promise.all([page.waitForURL(/watch\?v=aaaaaaaaaaa&t=10s/),menu().getByRole('menuitem',{name:'Resume at 0:10'}).click()]);assert.match(page.url(),/ledger-queue=/);
  async function source(p){const session=await context.newCDPSession(p),worlds=[];session.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await session.send('Runtime.enable');const world=worlds.find(w=>w.name===id||w.origin==='chrome-extension://'+id);assert.ok(world);const result=await session.send('Runtime.evaluate',{contextId:world.id,expression:'JSON.stringify(PlaybackSource.read(new URL(location.href).searchParams.get("v")))',returnByValue:true});await session.detach();return result.result.value?JSON.parse(result.result.value):null;}
  async function observed(p){let result;for(let i=0;i<30;i++){result=await source(p);if(result?.videoId)return result;await p.waitForTimeout(100);}return result;}
  assert.equal((await observed(page)).source.kind,'group');
  await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await options().waitFor();await feed.getByRole('button',{name:'All videos',exact:true}).click();await feed.locator('article').nth(1).waitFor();
  // Clicking a title starts there, with earlier videos still accessible.
  await feed.locator('.video-title').nth(1).click();await page.waitForURL(/watch\?v=bbbbbbbbbbb.*ledger-queue=/);
  const clickedQueue=page.locator('#ledger-group-queue');await clickedQueue.locator('button.current').waitFor();
  assert.match(await clickedQueue.locator('button.current').innerText(),/2.*Episode two/s);
  assert.equal(await clickedQueue.locator('details').getAttribute('open'),'');
  assert.equal(await clickedQueue.getByRole('button',{name:'Previous queue video',exact:true}).isDisabled(),false);
  assert.equal((await observed(page)).source.evidence,'group-queue-start');
  await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await feed.locator('article').nth(1).waitFor();
  for(const clickOptions of [{button:'middle'},{modifiers:[process.platform==='darwin'?'Meta':'Control']}]){
   const opened=context.waitForEvent('page');await feed.locator('.thumbnail').nth(1).click(clickOptions);const tab=await opened;
   await tab.waitForURL(/watch\?v=bbbbbbbbbbb.*ledger-queue=/);await tab.waitForLoadState('domcontentloaded');
   // Chromium can bypass the fixture route for a native popup's first request.
   // Reload the captured queue URL into the controlled page, as in feeds-check.
   await tab.reload();await tab.bringToFront();await tab.locator('#ledger-group-queue button.current').waitFor();
   assert.match(await tab.locator('#ledger-group-queue button.current').innerText(),/2.*Episode two/s);
   assert.equal((await observed(tab)).source.kind,'group');await tab.close();
  }
  // Context-menu links get a ready queue URL for native Open/Copy link actions.
  await feed.locator('.video-title').nth(1).dispatchEvent('contextmenu');
  const contextURL=await feed.locator('.video-title').nth(1).getAttribute('href');assert.match(contextURL,/ledger-queue=/);
  const contextTab=await context.newPage();await contextTab.goto(contextURL);await contextTab.locator('#ledger-group-queue button.current').waitFor();
  assert.match(await contextTab.locator('#ledger-group-queue button.current').innerText(),/2.*Episode two/s);await contextTab.close();
  // The thumbnail uses the displayed search and sort, including a single result.
  await search.fill('Episode two');await feed.locator('.thumbnail').click();await page.waitForURL(/watch\?v=bbbbbbbbbbb.*ledger-queue=/);
  await clickedQueue.locator('button.current').waitFor();assert.equal(await clickedQueue.locator('li').count(),1);
  await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await search.fill('');await feed.locator('article').nth(1).waitFor();
  // Full filtered snapshot is queued, not only the first rendered page.
  await feed.getByRole('button',{name:'Play group',exact:true}).click();await page.waitForURL(/ledger-queue=/);const queuePanel=page.locator('#ledger-group-queue');await queuePanel.waitFor();
  assert.equal(await queuePanel.getByRole('checkbox',{name:'Autoplay'}).isChecked(),false);assert.equal(await queuePanel.getByRole('button',{name:'Previous queue video',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>[...document.querySelector('#ledger-group-queue').shadowRoot.querySelectorAll('.queue-thumbnail')].every(image=>image.complete&&image.naturalWidth>0));
  assert.equal(await queuePanel.locator('.queue-thumbnail').count(),2);
  await queuePanel.evaluate(host=>{host.style.width='360px';});
  assert.equal(await queuePanel.locator('.queue').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  await queuePanel.screenshot({path:'/tmp/ledger-queue-thumbnails.png'});await queuePanel.evaluate(host=>host.style.removeProperty('width'));
  const firstVisit=await observed(page);assert.equal(firstVisit.source.evidence,'group-queue-start');
  await queuePanel.getByRole('checkbox',{name:'Autoplay'}).check();await page.locator('video').evaluate(async v=>{if(v.readyState<1)await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));v.currentTime=v.duration-.4;await v.play();});
  await page.waitForURL(/watch\?v=bbbbbbbbbbb.*ledger-queue=/);await queuePanel.waitFor();const secondVisit=await observed(page);assert.equal(secondVisit.source.evidence,'group-queue-auto');assert.equal(secondVisit.journey.previousVisitId,firstVisit.id);assert.equal(secondVisit.journey.previousVideoId,V);assert.equal(await queuePanel.getByRole('button',{name:'Next queue video',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('video').currentTime>.1);
  await page.locator('video').evaluate(v=>v.pause());await page.waitForTimeout(600);assert.equal(await page.locator('video').evaluate(v=>v.paused),true,'Autoplay does not undo a later pause');
  await page.reload();await queuePanel.waitFor();await page.waitForTimeout(600);assert.equal(await page.locator('video').evaluate(v=>v.paused),true,'Reloading a queue step does not restart playback');
  assert.equal(await queuePanel.locator('details').getAttribute('open'),'');await queuePanel.screenshot({path:path.join(__dirname,'discovery-queue-preview.png')});
  await page.locator('video').evaluate(async v=>{if(v.readyState<1)await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));v.currentTime=v.duration-.3;await v.play();});await queuePanel.getByRole('status').filter({hasText:'Queue finished.'}).waitFor();assert.match(page.url(),/v=bbbbbbbbbbb/);
  await queuePanel.getByRole('button',{name:'Previous queue video',exact:true}).click();await page.waitForURL(/watch\?v=aaaaaaaaaaa.*ledger-queue=/);await queuePanel.waitFor();assert.equal((await observed(page)).source.evidence,'group-queue-previous');
  // Clicking a recommendation leaves the group queue and records the explicit predecessor.
  const beforeRecommendation=await observed(page);const popup=context.waitForEvent('page');await page.locator('#recommended').click();const recommended=await popup;await recommended.waitForLoadState('domcontentloaded');const recommendedVisit=await observed(recommended);assert.equal(recommendedVisit.source.kind,'recommendations');assert.equal(recommendedVisit.journey.previousVisitId,beforeRecommendation.id);assert.equal(await recommended.locator('#ledger-group-queue').count(),0);await recommended.close();
  await queuePanel.getByRole('button',{name:'Close group queue',exact:true}).click();await queuePanel.waitFor({state:'detached'});await page.close();
  // Saved changes survive reload, and removal undo includes browsing state/cache.
  const managePage=await context.newPage();await managePage.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await managePage.locator('#ledger-group-feed article').nth(1).waitFor();
  await managePage.locator('#ledger-groups-sidebar').getByRole('button',{name:'Options for Podcasts',exact:true}).click();await managePage.getByRole('menuitem',{name:'Manage group',exact:true}).click();const manager=managePage.getByRole('dialog',{name:'Manage group'});await manager.getByRole('button',{name:'Remove',exact:true}).click();await manager.getByText('No channels yet.',{exact:true}).waitFor();await manager.locator('.ledger-undo').getByRole('button',{name:'Undo',exact:true}).click();await manager.getByRole('button',{name:'Remove',exact:true}).waitFor();
  await manager.getByRole('button',{name:'Delete group',exact:true}).click();await manager.locator('.ledger-undo').filter({hasText:'Group deleted.'}).waitFor();await manager.locator('.ledger-undo').getByRole('button',{name:'Undo',exact:true}).click();await managePage.waitForFunction(()=>document.querySelector('#ledger-group-manager-dialog').shadowRoot.querySelector('input[aria-label="Group name"]').value==='Podcasts');await managePage.close();
  // Both period and daily exports retain sources and real predecessor links.
  await worker.evaluate(({V,W,day})=>{const rows=[],now=Date.now(),one=crypto.randomUUID(),two=crypto.randomUUID();for(const [i,videoId,source,journey] of [[one,V,{kind:'group',groupId:'podcasts',groupName:'Podcasts'},null],[two,W,{kind:'recommendations'},{previousVisitId:one,previousVideoId:V,transition:'click'}]])Ledger.add(rows,{id:i,videoId,title:'Episode '+videoId[0],channel:'Alpha',url:'https://www.youtube.com/watch?v='+videoId,start:now-4000,end:now,state:'foreground',source,journey});return chrome.storage.local.set({['day:'+day]:rows});},{V,W,day});
  await dashboard.reload();await dashboard.getByRole('link',{name:'Overview',exact:true}).click();await dashboard.getByRole('button',{name:'Sources',exact:true}).click();await dashboard.getByRole('checkbox',{name:'Break down groups'}).check();await dashboard.locator('.source-summary-row').filter({hasText:'Group: Podcasts'}).waitFor();
  await dashboard.getByRole('button',{name:'Month',exact:true}).click();await dashboard.waitForFunction(()=>document.querySelectorAll('.trend-day').length===30);const download=dashboard.waitForEvent('download');await dashboard.getByRole('button',{name:'Export period review prompt',exact:true}).click();const exported=await download,body=fs.readFileSync(await exported.path(),'utf8'),report=JSON.parse(body.split('DATA:\n')[1]);assert.equal(report.dayCount,30);assert.equal(report.days.length,30);assert.equal(report.days.at(-1).notes,'Listen thoughtfully');assert.equal(report.sources.find(s=>s.key==='group:podcasts').seconds,4);assert.equal(report.viewingJourneys[1].predecessorRecorded,true);
  await dashboard.locator('.period-sources').screenshot({path:path.join(__dirname,'discovery-sources-preview.png')});await dashboard.getByRole('link',{name:'History',exact:true}).click();await dashboard.getByText('Viewing journeys',{exact:true}).click();await dashboard.locator('.journey-edge').filter({hasText:'Selected from: Episode a'}).waitFor();
  const daily=await dashboard.evaluate(()=>report());assert.equal(daily.schemaVersion,6);assert.equal(daily.viewingJourneys[1].predecessorRecorded,true);
  await dashboard.setViewportSize({width:390,height:850});assert.equal(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // A video past the queue's 500-item bound must still open at its own position.
  await worker.evaluate(A=>{const now=Date.now();return chrome.storage.local.set({'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,entries:Array.from({length:520},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:A,channel:'Alpha',title:'Large feed '+i,publishedAt:now-i*1000,details:{duration:100,status:'available',shorts:false,checkedAt:now}}))}}}});},A);
  const large=await context.newPage();await large.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');
  const largeFeed=large.locator('#ledger-group-feed');await largeFeed.locator('article').nth(47).waitFor();
  for(let count=48;count<520;count+=48){await largeFeed.getByRole('button',{name:'Load more',exact:true}).click();await largeFeed.locator('article').nth(Math.min(count+48,520)-1).waitFor();}
  await largeFeed.locator('.video-title').last().click();await large.waitForURL(/watch\?v=00000000519.*ledger-queue=/);
  const largeQueue=large.locator('#ledger-group-queue');await largeQueue.locator('button.current').waitFor();assert.equal(await largeQueue.locator('li').count(),20);
  assert.match(await largeQueue.locator('button.current').innerText(),/20.*Large feed 519/s);assert.match(await largeQueue.locator('li').first().innerText(),/Large feed 500/);
  await large.waitForFunction(()=>document.querySelector('#ledger-group-queue')?.shadowRoot.querySelector('ol').scrollTop>0);await large.close();
  assert.deepEqual(errors,[]);console.log('PASS: new-upload boundary, search/sort, queued Resume, hide/restore/Undo, selected-video queue, native modified/middle/context links, filtered and >500-video queues, visible current item, ended auto-next/end boundary, journey attribution, removal/deletion Undo and review exports.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
