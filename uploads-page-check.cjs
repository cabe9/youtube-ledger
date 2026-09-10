const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const check=require('./uploads-page-browser-test.cjs');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-uploads-fallback-'));let context;
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const result=await worker.evaluate(check,JSON.parse(fs.readFileSync('tests/fixtures/uploads-page-playlist.json')));assert.equal(result.ok,true);
  await worker.evaluate(()=>browser.storage.local.set({'groupBrowsing:v1':{version:1,groups:{fallback:{hidden:[],uploadedFilter:'all'}}}}));
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{background:#111;color:white;font:14px Arial}ytd-page-manager{display:block}</style><ytd-masthead>YouTube</ytd-masthead><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'}));
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#463453"/></svg>'}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=fallback');const feed=page.locator('#ledger-group-feed');
  await feed.locator('.fallback-note').waitFor();assert.match(await feed.locator('.fallback-note').textContent(),/first page/);
  assert.equal(await feed.locator('article').count(),3);
  assert.match(await feed.locator('article time').first().textContent(),/^~/);assert.match(await feed.locator('article time').first().getAttribute('title'),/Approximate/);
  assert.match(await feed.locator('.video-stats').first().textContent(),/~113K/);assert.match(await feed.locator('article').first().textContent(),/38:22/);
  await feed.screenshot({path:'/tmp/ledger-uploads-fallback-chrome.png'});
  const dashboard=await context.newPage();await dashboard.goto(new URL('dashboard.html#settings',worker.url()).href);const log=dashboard.locator('#request-log');await log.getByText('Uploads-page fallback',{exact:true}).first().waitFor();assert.match(await log.locator('#request-log-rows').textContent(),/CarlSagan42/);
  assert.equal((await worker.evaluate(()=>YouTubeRequestLog.snapshot())).recent.length,4);
  console.log('PASS: packaged Chrome uploads fallback, cached refresh, source reuse, 429 protection, approximate UI and request log.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
