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
  assert.equal(await log.locator('#request-log-rss-rate').textContent(),'0%');assert.equal(await log.locator('#request-log-page-count').textContent(),'3');
  assert.match(await log.locator('#request-log-rss-last').textContent(),/None recorded/);assert.match(await log.locator('#request-log-rss-attempt').textContent(),/HTTP 404/);
  await log.locator('#request-log-period').selectOption('week');assert.match(await log.locator('#request-log-rss-count').textContent(),/0 of 1 completed/);
  await dashboard.setViewportSize({width:1200,height:1000});await log.locator('.request-log-health').screenshot({path:'/tmp/ledger-rss-health-chrome.png'});
  await dashboard.setViewportSize({width:390,height:844});await log.locator('.request-log-health').screenshot({path:'/tmp/ledger-rss-health-mobile.png'});
  assert.ok(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Request health must fit a narrow screen');
  await dashboard.reload();await log.locator('#request-log-rss-rate').filter({hasText:'0%'}).waitFor();
  const exported=dashboard.waitForEvent('download');await log.getByRole('button',{name:'Export request log'}).click();
  const data=JSON.parse(fs.readFileSync(await (await exported).path(),'utf8'));assert.equal(data.sources.lastAttempt.rss.status,404);
  assert.equal((await worker.evaluate(()=>YouTubeRequestLog.snapshot())).recent.length,4,'Reading or exporting health must not trigger YouTube checks');
  await log.getByRole('button',{name:'Clear request log'}).click();await log.locator('#request-log-rss-rate').filter({hasText:'—'}).waitFor();
  assert.equal(await log.locator('#request-log-page-count').textContent(),'0');assert.match(await log.locator('#request-log-rss-count').textContent(),/No completed RSS/);
  console.log('PASS: packaged Chrome uploads fallback, cached refresh, source reuse, 429 protection, approximate UI and request log.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
