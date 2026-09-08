// Actual Chromium extension with controlled YouTube metadata and image fixtures.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A='UC'+'a'.repeat(22),ids=Array.from({length:24},(_,i)=>String(i).padStart(11,'0'));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-video-length-'));let context,release,releaseQueue,inQueue=false;const gate=new Promise(resolve=>release=resolve),queueGate=new Promise(resolve=>releaseQueue=resolve),requests=[],queueRequests=[],errors=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:960},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(20000);
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#497586"/><circle cx="240" cy="135" r="70" fill="#a2cbb9"/></svg>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/watch'){
    if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<style>body{background:#171717;color:white}ytd-watch-flexy{display:block;width:360px;margin:24px}</style><ytd-watch-flexy><div id="secondary-inner"></div></ytd-watch-flexy>'});
    const videoId=u.searchParams.get('v'),index=ids.indexOf(videoId);requests.push(videoId);await gate;
    if(inQueue){queueRequests.push(videoId);if(index>=7)await queueGate;}
    const videoDetails={videoId,channelId:A,lengthSeconds:index===3?'3661':'379',...(index===1?{isLive:true,isLiveContent:true}:index===2?{isUpcoming:true,lengthSeconds:'0'}:index===6?{isLiveContent:true}:{})};
    const body=[4,5].includes(index)?'<html>Unavailable</html>':'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails})+';</script><script>var recommendations = {"lengthSeconds":"999"};</script>';
    return route.fulfill({contentType:'text/html',body});
   }
   return route.fulfill({contentType:'text/html',body:'<style>body{background:#171717;color:#fff}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:230px}</style><ytd-masthead><div id="center"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,settings:Ledger.settings({theme:'retrowave'}),'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Example creator',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,error:'',entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Example creator',title:['A short conversation','Live stream','Upcoming premiere','A longer episode','Previously played video','Unavailable length','Archived live stream'][i]||'Episode '+i,publishedAt:now-86400000-i*1000}))}}},'videoProgress:v1':{version:1,videos:{[ids[4]]:{observed:true,segments:[[0,3]],duration:120}}}});},{A,ids});
  const playbackBefore=await worker.evaluate(()=>chrome.storage.local.get('videoProgress:v1'));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');const feed=page.locator('#ledger-group-feed');await feed.locator('article').nth(23).waitFor({state:'attached'});
  await feed.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  await page.evaluate(()=>{const root=document.querySelector('#ledger-group-feed').shadowRoot;window.lengthNodes=[root.querySelector('.content header'),root.querySelector('.thumbnail img'),root.querySelector('.grid')];});
  const offscreen=await feed.locator('article').evaluateAll(cards=>cards.filter(card=>card.getBoundingClientRect().top>=innerHeight).map(card=>card.dataset.videoId));
  const options=feed.getByRole('button',{name:'More options for A short conversation',exact:true});await options.click();release();
  await feed.locator('article').nth(0).locator('.video-duration').filter({hasText:'6:19'}).waitFor();await feed.getByRole('menu',{name:'Watch options'}).waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.lengthNodes.every(node=>node.isConnected)),true,'Length updates preserve header, image and grid');
  assert.ok(offscreen.length>0);assert.ok(offscreen.every(id=>!requests.includes(id)),'Off-screen metadata is not fetched');
  for(const [i,text] of [[0,'6:19'],[1,'Live'],[2,'Upcoming'],[3,'1:01:01'],[4,'2:00'],[5,'—'],[6,'6:19']]){const card=feed.locator('article').nth(i);await card.scrollIntoViewIfNeeded();await card.locator('.video-duration').filter({hasText:text}).waitFor();assert.equal(await card.locator('.video-duration').innerText(),text);}
  const live=feed.locator('article').nth(1).locator('.video-duration');assert.equal(await live.evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');assert.equal(await live.getAttribute('title'),'Live now');
  await feed.locator('article').nth(0).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/ledger-video-lengths.png',fullPage:false});
  const count=requests.length;await page.reload();await feed.locator('article').first().locator('.video-duration').filter({hasText:'6:19'}).waitFor();await page.waitForTimeout(300);assert.equal(requests.length,count,'Cached lengths survive reload without repeat requests');
  // Queue badges use the same cache and recorded fallback. Unseen queue items
  // load only when scrolled into view and update without replacing thumbnails.
  await worker.evaluate(A=>chrome.storage.local.get('channelUploads:v1').then(data=>{for(const entry of data['channelUploads:v1'].channels[A].entries.slice(7))delete entry.details;return chrome.storage.local.set(data);}),A);
  inQueue=true;await feed.locator('.video-title').first().click();await page.waitForURL(/ledger-queue=/);
  const panel=page.locator('#ledger-group-queue');await panel.locator('.video-duration').first().filter({hasText:'6:19'}).waitFor();assert.equal(queueRequests.length,0,'Queue opens with cached durations without new lookups');
  for(const [i,text] of [[0,'6:19'],[1,'Live'],[2,'Upcoming'],[3,'1:01:01'],[4,'2:00'],[5,'—'],[6,'6:19']])assert.equal(await panel.locator('li').nth(i).locator('.video-duration').innerText(),text);
  await panel.screenshot({path:'/tmp/ledger-queue-durations.png'});
  await panel.locator('li').nth(7).scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#ledger-group-queue').shadowRoot.querySelectorAll('li')[7].querySelector('.video-duration').textContent==='…');
  await page.evaluate(()=>{const root=document.querySelector('#ledger-group-queue').shadowRoot;window.queueDurationNodes=[root.querySelector('ol'),root.querySelectorAll('li')[7].querySelector('img')];});
  releaseQueue();await panel.locator('li').nth(7).locator('.video-duration').filter({hasText:'6:19'}).waitFor();
  assert.ok(queueRequests.includes(ids[7]));assert.ok(!queueRequests.includes(ids[23]),'Off-screen queue metadata is not fetched');
  assert.equal(await page.evaluate(()=>queueDurationNodes.every(node=>node.isConnected)),true,'Queue duration updates preserve list and thumbnail nodes');
  await worker.evaluate(({A,id})=>chrome.storage.local.get('channelUploads:v1').then(data=>{data['channelUploads:v1'].channels[A].entries.find(entry=>entry.videoId===id).details={status:'available',duration:3723,checkedAt:Date.now()};return chrome.storage.local.set(data);}),{A,id:ids[1]});
  await panel.locator('li').nth(1).locator('.video-duration').filter({hasText:'1:02:03'}).waitFor();
  await panel.locator('li').first().scrollIntoViewIfNeeded();await page.waitForTimeout(300);const queueCount=queueRequests.length;
  await page.reload();await panel.locator('.video-duration').first().filter({hasText:'6:19'}).waitFor();await page.waitForTimeout(300);assert.equal(queueRequests.length,queueCount,'Queue reload uses the current duration cache');
  assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get('videoProgress:v1')),playbackBefore);assert.equal(await worker.evaluate(async()=>Object.keys(await chrome.storage.local.get(null)).some(key=>key.startsWith('day:'))),false,'Metadata creates no watch history');assert.deepEqual(errors,[]);
  console.log('PASS: feed and queue duration badges, visible-only fetching, m:ss/h:mm:ss, Live/Upcoming, recorded fallback, missing lengths, cache reload/updates, unchanged history, menus and thumbnail nodes.');
 }finally{release();releaseQueue();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
