// Actual Chromium extension: async Shorts filtering and saved group controls.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A='UC'+'a'.repeat(22),ids=Array.from({length:4},(_,i)=>String(i).padStart(11,'0'));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-shorts-'));let context,release;const gate=new Promise(resolve=>release=resolve),requests=[],errors=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(20000);
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#497586"/></svg>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/watch'&&route.request().resourceType()!=='document'){
    const videoId=u.searchParams.get('v'),i=ids.indexOf(videoId);requests.push(videoId);await gate;
    const player={videoDetails:{videoId,channelId:A,lengthSeconds:i===0?'150':'20'},microformat:{playerMicroformatRenderer:{externalVideoId:videoId,...(i===2?{}:{isShortsEligible:i===0})}}};
    return route.fulfill({contentType:'text/html',body:'<script>var ytInitialPlayerResponse = '+JSON.stringify(player)+';</script>'});
   }
   return route.fulfill({contentType:'text/html',body:'<style>body{background:#171717;color:#fff}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:230px}</style><ytd-masthead><div id="center"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,settings:Ledger.settings({theme:'retrowave'}),'channelGroups:v1':{version:1,groups:['podcasts','music'].map(id=>({id,name:id==='podcasts'?'Podcasts':'Music',channelIds:[A],createdAt:now,updatedAt:now})),channels:{[A]:{id:A,name:'Example creator',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,error:'',entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Example creator',title:['A 150-second Short','An ordinary 20-second video','Unclassified upload','Known Short'][i],publishedAt:now-86400000-i*1000,views:{count:100,checkedAt:now},details:{status:'available',duration:i===0?150:20,checkedAt:now,...(i===3?{shorts:true}:{})}}))}}},'videoProgress:v1':{version:1,videos:{}}});},{A,ids});
  const page=await context.newPage(),url='https://www.youtube.com/feed/subscriptions#ledger-group=podcasts';await page.goto(url);const feed=page.locator('#ledger-group-feed'),toggle=feed.locator('[data-focus=hide-shorts]');
  await feed.locator('article').nth(3).waitFor();assert.equal(await toggle.isChecked(),false);assert.equal(requests.length,0,'Legacy lengths alone do not trigger classification');
  await page.evaluate(()=>{window.keptImage=document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article[data-video-id="00000000001"] img');});
  await feed.getByRole('button',{name:/^Filters/}).click();await toggle.focus();await page.keyboard.press('Space');await feed.locator('article').nth(3).waitFor({state:'detached'});assert.equal(await toggle.isChecked(),true);
  release();await feed.locator('article[data-video-id="00000000000"]').waitFor({state:'detached'});assert.equal(await feed.locator('article').count(),2);
  assert.equal(await page.evaluate(()=>window.keptImage.isConnected),true,'Normal video keeps its thumbnail when a Short is removed');
  const ordinary=feed.locator('article[data-video-id="00000000001"]');assert.equal(await ordinary.locator('.video-duration').innerText(),'0:20');
  await feed.locator('article[data-video-id="00000000002"] .video-duration').waitFor();
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed').shadowRoot.querySelector('[data-focus="hide-shorts"]')===document.querySelector('#ledger-group-feed').shadowRoot.activeElement);
  const saved=await worker.evaluate(()=>chrome.storage.local.get(null));assert.equal(saved['channelGroups:v1'].groups[0].hideShorts,true);assert.equal(saved['channelGroups:v1'].groups[1].hideShorts,undefined);
  await page.screenshot({path:'/tmp/ledger-shorts-toggle.png'});
  await page.reload();await feed.locator('article').nth(1).waitFor();assert.equal(await toggle.isChecked(),true);assert.equal(await feed.locator('article').count(),2);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Music',exact:true}).click();await feed.locator('article').nth(3).waitFor();assert.equal(await toggle.isChecked(),false);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Podcasts',exact:true}).click();await feed.locator('article').nth(2).waitFor({state:'detached'});assert.equal(await toggle.isChecked(),true);
  await feed.getByRole('button',{name:/^Filters/}).click();await toggle.uncheck();await feed.locator('article').nth(3).waitFor();await toggle.check();await feed.locator('article').nth(2).waitFor({state:'detached'});
  await feed.getByRole('button',{name:'Play group',exact:true}).click();await page.waitForURL(/watch\?v=00000000001/);
  const queue=await worker.evaluate(()=>chrome.storage.session.get('groupQueues:v1'));assert.deepEqual(Object.values(queue['groupQueues:v1'])[0].entries.map(e=>e.videoId),[ids[1],ids[2]],'Play group uses the filtered snapshot');
  const after=await worker.evaluate(()=>chrome.storage.local.get(null));assert.deepEqual(after['videoProgress:v1'],{version:1,videos:{}});assert.ok(!Object.keys(after).some(k=>k.startsWith('day:')));assert.ok(requests.length<=3,'Unknown classification is not repeatedly fetched');assert.deepEqual(errors,[]);
  console.log('PASS: Hide Shorts, ordinary short/unknown videos, keyboard and focus, async thumbnail preservation, per-group autosave/reload, filtered queue, and unchanged watch history.');
 }finally{release();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
