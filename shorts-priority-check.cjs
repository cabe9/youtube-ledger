const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-shorts-priority-'));let context;const gates=new Map(),requests=[],errors=[];
 const A='UC'+'a'.repeat(22),ids=Array.from({length:96},(_,i)=>String(i).padStart(11,'0'));
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'g',name:'Podcasts',channelIds:[A],sort:'rate-desc',createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,viewsAttemptedAt:now,entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Alpha',title:'Episode '+i,publishedAt:now-(i+3)*3600000,details:{status:'available',duration:150,checkedAt:now,...(i===15?{shorts:true}:{})},...(i<64?{views:{count:1000,checkedAt:now}}:{})}))}}},'videoProgress:v1':{version:1,videos:{}}});},{A,ids});
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"/>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(route.request().resourceType()!=='document'&&u.pathname==='/watch'){
    const id=u.searchParams.get('v'),i=ids.indexOf(id);requests.push(i);
    if(i<8||i>=64&&i<68)await new Promise(resolve=>gates.set(i,resolve));
    return route.fulfill({contentType:'text/html',body:'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:id,channelId:A,lengthSeconds:'150',viewCount:i<64?'1000':'1'},microformat:{playerMicroformatRenderer:{...(i===3?{}:{isShortsEligible:i<8&&i%2===0})}}})+';</script>'});
   }
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   return route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#171717;color:white;font:14px Arial}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:220px}</style><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=g');const feed=page.locator('#ledger-group-feed');
  const waitFor=async predicate=>{const end=Date.now()+7000;while(!predicate()&&Date.now()<end)await page.waitForTimeout(20);assert.ok(predicate(),JSON.stringify(requests));};
  await waitFor(()=>gates.has(67));assert.deepEqual(requests,[64,65,66,67]);
  await feed.evaluate(host=>{window.kept=host.shadowRoot.querySelector('article[data-video-id="00000000001"] img');});
  await feed.getByRole('button',{name:/^Filters/}).click();await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).check();
  await feed.locator('article[data-video-id="00000000015"]').waitFor({state:'detached'});
  await feed.locator('.shorts-note').getByText('Checking nearby videos for Shorts…',{exact:true}).waitFor();
  // Let the four active downloads finish; visible classifications must overtake queued counts.
  await page.waitForTimeout(250);for(let i=64;i<68;i++)gates.get(i)();
  await waitFor(()=>gates.has(3));assert.deepEqual(requests.slice(4,8),[0,1,2,3]);
  gates.get(0)();
  let classified=false;const until=Date.now()+5000;while(Date.now()<until){const ready=await worker.evaluate(async({A,id})=>(await chrome.storage.local.get('channelUploads:v1'))['channelUploads:v1'].channels[A].entries.find(e=>e.videoId===id).details.shorts===true,{A,id:ids[0]});if(ready){classified=true;break;}await page.waitForTimeout(20);}assert.ok(classified);
  await page.waitForTimeout(200);assert.equal(await feed.locator('article[data-video-id="00000000000"]').count(),1,'A single completed classification does not shift the grid');
  for(let i=1;i<4;i++)gates.get(i)();await waitFor(()=>gates.has(7));
  assert.deepEqual(requests.slice(4,12),[0,1,2,3,4,5,6,7]);for(let i=4;i<8;i++)gates.get(i)();
  for(const i of [0,2,4,6])await feed.locator('article[data-video-id="'+ids[i]+'"]').waitFor({state:'detached'});
  assert.equal(await feed.locator('article[data-video-id="00000000003"]').count(),1,'Unknown classification stays available');assert.equal(await page.evaluate(()=>kept.isConnected),true);
  // Prefetch the rows just below the viewport before resuming the offscreen view scan.
  await waitFor(()=>requests.includes(16));assert.ok(requests.indexOf(8)<requests.indexOf(68)||!requests.includes(68));
  await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).uncheck();await feed.locator('article[data-video-id="00000000000"]').waitFor();
  await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).check();await feed.locator('article[data-video-id="00000000000"]').waitFor({state:'detached'});
  assert.equal(requests.filter(i=>i===0).length,1,'Cached classification makes later toggles immediate');assert.deepEqual(errors,[]);
  console.log('PASS: visible Shorts checks jump ahead of queued view counts, run top-to-bottom, remove completed groups together, prefetch nearby rows, preserve ordinary/unknown videos and thumbnails, and reuse cached classifications.');
 }finally{for(const resolve of gates.values())resolve();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
