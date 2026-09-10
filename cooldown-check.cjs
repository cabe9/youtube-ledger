// Exercise the actual retry button using an isolated Chrome profile and synthetic responses.
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-cooldown-'));let context;
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(40000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async fixture=>{
   const id='UClZbO3wehSIsPUKLx_X5caw',now=Date.now(),until=now+7200000;
   globalThis.cooldownCalls=[];globalThis.refuseRetry=false;
   globalThis.fetch=async url=>{
    const rss=new URL(url).pathname==='/feeds/videos.xml';cooldownCalls.push({url,at:Date.now()});
    const response=new Response(rss?'Missing':'<script>var ytInitialData = '+JSON.stringify(fixture)+';</script>',{status:refuseRetry?429:rss?404:200});Object.defineProperty(response,'url',{value:String(url)});return response;
   };
   await browser.storage.local.set({paused:true,settings:{theme:'retrowave'},'youtubeRequests:v1':{pausedUntil:until,pauseScope:'automatic',pauseReason:'feed-failures'},'channelGroups:v1':{version:1,groups:[{id:'retry',name:'Retry test',channelIds:[id]}],channels:{[id]:{id,name:'CarlSagan42',avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[id]:{attemptedAt:now,fetchedAt:now-3600000,error:'HTTP 404',retryAt:until,retryAfter:until,entries:[{videoId:'a'.repeat(11),channelId:id,channel:'CarlSagan42',title:'Cached upload',publishedAt:now-3600000,views:{count:1,checkedAt:now},details:{status:'available',duration:123,shorts:false,checkedAt:now}}]}}}});
  },JSON.parse(fs.readFileSync('tests/fixtures/uploads-page-playlist.json')));
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{background:#111;color:white;font:14px Arial}ytd-page-manager{display:block}</style><ytd-masthead>YouTube</ytd-masthead><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'}));
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#463453"/></svg>'}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=retry');const feed=page.locator('#ledger-group-feed'),retry=feed.getByRole('button',{name:'Retry now',exact:true});
  await retry.waitFor();assert.equal((await worker.evaluate(()=>cooldownCalls)).length,0);assert.equal(await feed.locator('article').count(),1);
  await page.evaluate(()=>{window.cachedThumbnail=document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article img');});
  await feed.screenshot({path:'/tmp/ledger-cooldown-retry-chrome.png'});
  await retry.focus();await page.keyboard.press('Enter');
  await feed.locator('.fallback-note').waitFor();await page.waitForFunction(()=>!document.querySelector('#ledger-group-feed').shadowRoot.querySelector('.status').textContent.includes('Checking uploads'));
  assert.equal(await retry.count(),0);assert.equal(await page.evaluate(()=>cachedThumbnail.isConnected),true);
  const recovered=await worker.evaluate(async()=>({calls:cooldownCalls,status:await YouTubeRequests.status(),cache:(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1']}));
  assert.equal(recovered.calls.length,2);assert.ok(recovered.calls[1].at-recovered.calls[0].at>=9950,JSON.stringify(recovered.calls));assert.equal(recovered.status.pausedUntil,0);assert.equal(Object.values(recovered.cache.channels)[0].entries.length,4);
  await worker.evaluate(async()=>{refuseRetry=true;const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key];Object.values(cache.channels)[0].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({[key]:cache});});
  await feed.getByRole('button',{name:'Refresh uploads',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed').shadowRoot.querySelector('.status').textContent.includes('HTTP 429'));
  assert.equal(await retry.count(),0);
  const denied=await worker.evaluate(async()=>{const status=await YouTubeRequests.status();return GroupFeeds.handle({type:'groupFeed:retryCooldown',groupId:'retry',pausedUntil:status.pausedUntil},{tab:{id:999},url:'https://www.youtube.com/feed/subscriptions'}).then(()=>false,error=>error.name==='YouTubeCooldownError');});assert.equal(denied,true);
  assert.equal((await worker.evaluate(()=>YouTubeRequestLog.snapshot())).recent.length,3);
  console.log('PASS: packaged Chrome retry button, saved cooldown override, RSS fallback, retained thumbnails, request pacing and server-wait protection.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
