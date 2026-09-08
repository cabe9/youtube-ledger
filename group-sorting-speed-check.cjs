// Exercise slow YouTube responses and a large cache without real account data.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-sort-speed-'));let context,releaseSlow;const lookups=[],completed=[],errors=[];
 const A='UC'+'a'.repeat(22),ids=Array.from({length:96},(_,i)=>String(i).padStart(11,'0'));
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'g',name:'Podcasts',channelIds:[A],sort:'rate-desc',createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,viewsAttemptedAt:now,entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Alpha',title:'Episode '+i,publishedAt:now-(i+3)*3600000,details:{status:'available',duration:300,shorts:false,checkedAt:now},...(i<80?{views:{count:1000,checkedAt:now-7200000}}:{})}))}}},'videoProgress:v1':{version:1,videos:{}}});},{A,ids});
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"/>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(route.request().resourceType()!=='document'&&u.pathname==='/watch'){
    const id=u.searchParams.get('v');lookups.push(id);
    if(id===ids[80])await new Promise(resolve=>{releaseSlow=resolve;});
    await route.fulfill({contentType:'text/html',body:'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:id,channelId:A,lengthSeconds:'300',viewCount:'1000000'},microformat:{playerMicroformatRenderer:{isShortsEligible:false}}})+';</script>'});completed.push(id);return;
   }
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   return route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#171717;color:white;font:14px Arial}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:220px}</style><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=g');
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('article')?.dataset.videoId==='00000000000');
  const feed=page.locator('#ledger-group-feed');assert.match(await feed.locator('article').first().locator('.video-stats').innerText(),/1K views\/hour/);
  await feed.evaluate(host=>{window.kept=host.shadowRoot.querySelector('article[data-video-id="00000000030"] img');});
  // The first request stays blocked, but the other fifteen must finish and sort.
  const deadline=Date.now()+7000;while(completed.length<15&&Date.now()<deadline)await page.waitForTimeout(50);
  assert.equal(completed.length,15);assert.ok(releaseSlow);assert.ok(!completed.includes(ids[80]));
  assert.deepEqual([...new Set(lookups)].sort(),ids.slice(80),'Fill missing counts first; avoid revisiting eighty stale offscreen counts');
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('article')?.dataset.videoId==='00000000081');
  assert.equal(await page.evaluate(()=>kept.isConnected),true);
  releaseSlow();releaseSlow=null;
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('article')?.dataset.videoId==='00000000080');
  await page.waitForFunction(()=>!document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('.sort-note')?.textContent.includes('Updating'));
  await page.reload();await feed.locator('article').first().waitFor();await page.waitForTimeout(500);assert.equal(lookups.length,16,'Cached rates are immediately reusable on the next visit');
  assert.deepEqual(errors,[]);console.log('PASS: 96-video feed uses cached rates immediately; fifteen results complete and reorder while one response is blocked; only sixteen missing counts are fetched; reload makes no new requests.');
 }finally{releaseSlow?.();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
