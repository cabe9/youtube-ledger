const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-sorting-'));let context,release;const errors=[],lookups=[];
 const A='UC'+'a'.repeat(22),ids=Array.from({length:64},(_,i)=>String(i).padStart(11,'0'));
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1050},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:['podcasts','music'].map(id=>({id,name:id==='podcasts'?'Podcasts':'Music',channelIds:[A],createdAt:now,updatedAt:now})),channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Alpha',title:'Episode '+i,publishedAt:now-(i+1)*3600000,details:{status:'available',duration:60+i,shorts:false,checkedAt:now},...(i===63?{}:{views:{count:i?100*(i+1):0,checkedAt:now}})}))}}},'videoProgress:v1':{version:1,videos:{}}});},{A,ids});
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#493255"/></svg>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(route.request().resourceType()!=='document'&&u.pathname==='/watch'){
    const id=u.searchParams.get('v');lookups.push(id);await new Promise(resolve=>{release=resolve;});
    return route.fulfill({contentType:'text/html',body:'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:id,channelId:A,lengthSeconds:id===ids[62]?'30':'3661',viewCount:id===ids[62]?'1500000':'1000000'},microformat:{playerMicroformatRenderer:{isShortsEligible:false}}})+';</script>'});
   }
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   return route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#171717;color:white;font:14px Arial}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:220px}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-page-manager{margin-left:0}}</style><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  const page=await context.newPage(),url='https://www.youtube.com/feed/subscriptions#ledger-group=podcasts';await page.goto(url);
  const feed=page.locator('#ledger-group-feed'),sort=feed.getByRole('combobox',{name:'Sort uploads'}),direction=feed.locator('[data-focus=sort-direction]');
  const first=expected=>page.waitForFunction(id=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('article')?.dataset.videoId===id,expected);
  await first(ids[0]);assert.equal(await sort.inputValue(),'date');assert.equal(await direction.getAttribute('data-direction'),'descending');assert.deepEqual(lookups,[]);
  assert.equal(await feed.locator('article').first().locator('.video-stats').innerText(),'0 views');
  await page.screenshot({path:'/tmp/ledger-group-view-counts.png'});
  await feed.evaluate(host=>{window.kept=host.shadowRoot.querySelector('article[data-video-id="00000000030"] img');});
  await sort.selectOption('views');await first(ids[62]);
  for(let i=0;i<100&&!release;i++)await page.waitForTimeout(20);assert.deepEqual(lookups,[ids[63]],'View sorting checks the video below the first 48 cards');release();release=null;
  await first(ids[63]);assert.equal(await feed.locator('.new-divider').count(),0);assert.equal(await page.evaluate(()=>kept.isConnected),true);
  assert.match(await feed.locator('article').first().locator('.video-stats').innerText(),/1M views/);
  await direction.click();await first(ids[0]);assert.match(await feed.locator('article').first().locator('.video-stats').innerText(),/^0 views$/);
  await page.reload();await first(ids[0]);assert.equal(await sort.inputValue(),'views');assert.equal(await direction.getAttribute('data-direction'),'ascending');
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Music',exact:true}).click();await first(ids[0]);assert.equal(await sort.inputValue(),'date');
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Podcasts',exact:true}).click();await first(ids[0]);assert.equal(await sort.inputValue(),'views');
  // Metadata can change after the sort's initial check, including below the visible page.
  await sort.selectOption('length');await first(ids[0]);await page.waitForTimeout(250);
  await worker.evaluate(async({A,id})=>{const key='channelUploads:v1',data=await chrome.storage.local.get(key);delete data[key].channels[A].entries.find(e=>e.videoId===id).details;await chrome.storage.local.set(data);},{A,id:ids[62]});
  for(let i=0;i<100&&!release;i++)await page.waitForTimeout(50);assert.deepEqual(lookups,[ids[63],ids[62]]);release();release=null;
  await first(ids[62]);assert.equal(await direction.getAttribute('data-direction'),'ascending');await direction.click();await first(ids[63]);
  await sort.selectOption('rate');await first(ids[62]);assert.match(await feed.locator('.sort-note').innerText(),/Average views per hour since upload/);assert.match(await feed.locator('article').first().locator('.video-stats').innerText(),/views\/hour/);
  await direction.click();await first(ids[0]);
  for(const width of [1440,736,360]){await page.setViewportSize({width,height:1050});assert.equal(await feed.locator('.feed-header').evaluate(el=>el.scrollWidth>el.clientWidth),false);}
  await page.setViewportSize({width:1440,height:1050});await feed.locator('.feed-header').screenshot({path:'/tmp/ledger-group-sorting-header.png'});
  await sort.selectOption('views');await direction.click();await first(ids[0]);await feed.getByRole('searchbox',{name:'Search this group'}).fill('Episode 6');await first(ids[6]);
  const expected=[ids[6],ids[60],ids[61],ids[63],ids[62]];assert.deepEqual(await feed.locator('article').evaluateAll(nodes=>nodes.map(n=>n.dataset.videoId)),expected);
  await feed.getByRole('button',{name:'Play group',exact:true}).click();await page.waitForURL(/ledger-queue=/);
  const stored=await worker.evaluate(()=>chrome.storage.session.get('groupQueues:v1'));assert.deepEqual(Object.values(stored['groupQueues:v1'])[0].entries.map(e=>e.videoId),expected);
  const local=await worker.evaluate(()=>chrome.storage.local.get(null));assert.deepEqual(local['videoProgress:v1'],{version:1,videos:{}});assert.ok(!Object.keys(local).some(k=>k.startsWith('day:')));assert.deepEqual(lookups,[ids[63],ids[62]]);assert.deepEqual(errors,[]);
  console.log('PASS: separate metric/direction controls, zero views, saved per-group ordering, offscreen view/duration lookups, stable images, average view rates, responsive header, and queue order.');
 }finally{release?.();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
