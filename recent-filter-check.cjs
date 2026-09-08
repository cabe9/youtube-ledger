const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-recent-default-'));let context;const lookups=[],errors=[];
 const A='UC'+'a'.repeat(22),ids=['a'.repeat(11),'b'.repeat(11),'c'.repeat(11)];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(({A,ids})=>{const now=Date.now();return chrome.storage.local.set({paused:true,'channelGroups:v1':{version:1,groups:['podcasts','music'].map(id=>({id,name:id,channelIds:[A],sort:'rate-desc',createdAt:now,updatedAt:now})),channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,viewsAttemptedAt:now,entries:ids.map((videoId,i)=>({videoId,channelId:A,channel:'Alpha',title:'Episode '+i,publishedAt:now-[1,6,8][i]*86400000,...(i<2?{views:{count:1000,checkedAt:now},details:{status:'available',duration:300,shorts:false,checkedAt:now}}:{})}))}}}});},{A,ids});
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"/>'}));
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(route.request().resourceType()!=='document'&&u.pathname==='/watch'){
    lookups.push(u.searchParams.get('v'));return route.fulfill({contentType:'text/html',body:'<script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:ids[2],channelId:A,lengthSeconds:'300',viewCount:'2000'},microformat:{playerMicroformatRenderer:{isShortsEligible:false}}})+';</script>'});
   }
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   return route.fulfill({contentType:'text/html',body:'<style>ytd-guide-renderer{display:block;width:200px;float:left}ytd-page-manager{display:block;margin-left:200px}</style><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');const feed=page.locator('#ledger-group-feed');
  const count=n=>page.waitForFunction(n=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelectorAll('article').length===n,n);
  await count(2);await feed.getByRole('button',{name:'Remove filter: Last 7 days',exact:true}).waitFor();await page.waitForTimeout(400);assert.deepEqual(lookups,[],'Older videos outside the default range do not enter metadata sorting work');
  await feed.getByRole('button',{name:/^Filters/}).click();assert.equal(await feed.getByLabel('Uploaded',{exact:true}).inputValue(),'week');
  await feed.getByLabel('Uploaded',{exact:true}).selectOption('all');await count(3);await page.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('article[data-video-id="ccccccccccc"] .video-stats')?.textContent.includes('2K'));
  assert.deepEqual(lookups,[ids[2]]);await page.reload();await count(3);assert.equal(await feed.getByRole('button',{name:'Remove filter: Last 7 days',exact:true}).count(),0);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'music',exact:true}).click();await count(2);await feed.getByRole('button',{name:'Remove filter: Last 7 days',exact:true}).waitFor();
  const stored=await worker.evaluate(()=>chrome.storage.local.get('groupBrowsing:v1'));assert.equal(stored['groupBrowsing:v1'].groups.podcasts.uploadedFilter,'all');assert.equal(stored['groupBrowsing:v1'].groups.music.uploadedFilter,'week');assert.deepEqual(errors,[]);
  console.log('PASS: seven-day default, matching-only metadata work, Any time reveals older uploads, and each group retains its explicit date-filter choice.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
