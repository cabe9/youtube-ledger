// Exercise the frames before YouTube labels a reused browse view as Home.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-home-navigation-')),extension=path.join(__dirname,'dist/chrome');let context;const errors=[];
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async()=>{const C='UC'+'a'.repeat(22),now=Date.now();await browser.storage.local.set({paused:true,settings:Ledger.settings(),'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[C],createdAt:now,updatedAt:now}],channels:{[C]:{id:C,name:'Creator',url:'https://www.youtube.com/channel/'+C}}},'channelUploads:v1':{version:1,channels:{[C]:{fetchedAt:now,attemptedAt:now,entries:[{videoId:'aaaaaaaaaaa',channelId:C,channel:'Creator',title:'A group episode',publishedAt:now}]}}}});});
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>ytd-browse,ytd-page-manager,ytd-guide-renderer,ytd-guide-section-renderer{display:block}#native-feed{width:300px;height:120px}ytd-guide-renderer{width:220px;float:left}ytd-page-manager{margin-left:240px}</style><ytd-masthead><div id="center"><yt-searchbox style="display:block;width:400px;height:40px"><input name="search_query"></yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/">Home</a><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"><div id="native-feed">Native uploads</div></ytd-browse></ytd-page-manager>`}));
  await context.route('https://i.ytimg.com/**',r=>r.fulfill({status:204,body:''}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await page.locator('#ledger-group-feed').getByRole('heading',{name:'Podcasts',exact:true}).waitFor();
  const hidden=async()=>!(await page.locator('#native-feed').isVisible());
  async function homeFrames(mode='normal'){
   return page.evaluate(async mode=>{
    const browse=document.querySelector('ytd-browse'),manager=document.querySelector('ytd-page-manager');
    if(mode==='normal')document.dispatchEvent(new CustomEvent('yt-navigate-start',{detail:{url:'/',endpoint:{browseEndpoint:{browseId:'FEwhat_to_watch'}}}}));
    if(mode==='endpoint')document.dispatchEvent(new CustomEvent('yt-navigate-start',{detail:{endpoint:{browseEndpoint:{browseId:'FEwhat_to_watch'}}}}));
    // YouTube can replace the group container / reuse its native browse view first.
    manager.removeAttribute('data-ledger-group-view');document.getElementById('ledger-group-feed')?.remove();browse.removeAttribute('page-subtype');
    const preURL=getComputedStyle(browse).display;
    history.pushState({},'','/');browse.querySelector('#native-feed').textContent='Home recommendations';
    if(mode==='normal'||mode==='endpoint')document.dispatchEvent(new Event('yt-navigate-finish'));
    const frames=[];
    for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);frames.push(getComputedStyle(browse).display);if(i===3)browse.setAttribute('page-subtype','home');}
    return {preURL,frames};
   },mode);
  }
  const first=await homeFrames();assert.ok(first.frames.every(v=>v==='none'),'Home must stay hidden in every frame before page-subtype arrives: '+JSON.stringify(first));
  const eye=page.getByRole('button',{name:'Show recommendations',exact:true});await eye.click();assert.equal(await hidden(),false,'The eye can deliberately reveal Home');
  async function leave(url,subtype){await page.evaluate(({url,subtype})=>{document.dispatchEvent(new CustomEvent('yt-navigate-start',{detail:{url}}));history.pushState({},'',url);document.querySelector('ytd-browse').setAttribute('page-subtype',subtype);document.dispatchEvent(new Event('yt-navigate-finish'));}, {url,subtype});assert.equal(await hidden(),false,'Other native browse pages remain available');}
  await leave('/@creator','channels');
  const second=await homeFrames('endpoint');assert.equal(second.preURL,'none','Native endpoint guards Home before the URL changes');assert.ok(second.frames.every(v=>v==='none'));
  await leave('/feed/subscriptions','subscriptions');
  // Fallback for a missed native navigation event: observe the DOM in the same turn as the URL change.
  const fallback=await homeFrames('no-events');assert.ok(fallback.frames.every(v=>v==='none'),'A missing navigate event must not leave a one-second flash');
  await leave('/@creator','channels');
  await page.evaluate(()=>{document.querySelector('ytd-browse').removeAttribute('page-subtype');history.back();});
  await page.waitForURL('https://www.youtube.com/');assert.equal(await hidden(),true,'Back to Home applies the guard without waiting for the next timer');
  await page.goForward();await page.waitForURL('https://www.youtube.com/@creator');assert.equal(await hidden(),false,'Forward releases the Home guard');
  await worker.evaluate(()=>browser.storage.local.set({settings:Ledger.settings({hideRecommendations:true,resetOnNavigate:false})}));await page.waitForTimeout(100);
  await page.getByRole('button',{name:'Show recommendations',exact:true}).click();const persistent=await homeFrames();assert.ok(persistent.frames.every(v=>v!=='none'),'Keep explicitly revealed recommendations when navigation reset is disabled');
  await worker.evaluate(()=>browser.storage.local.set({settings:Ledger.settings({hideRecommendations:false})}));await page.waitForTimeout(100);await leave('/feed/subscriptions','subscriptions');const defaultShown=await homeFrames();assert.ok(defaultShown.frames.every(v=>v!=='none'),'Respect a default of showing recommendations');
  assert.deepEqual(errors,[]);console.log('PASS: group → Home stays hidden before subtype assignment, native endpoint guards before URL update, missed-event mutation fallback, Back/Forward, other browse pages, eye reveal, persistent reveal and default-shown settings. Actual unpacked Chrome extension; controlled delayed DOM.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
