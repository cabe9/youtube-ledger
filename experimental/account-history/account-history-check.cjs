// Real extension + inert local parser; disposable profile and synthetic HTML only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
require('../../core.js');require('./account-history.js');
const ROOT=path.resolve(__dirname,'../..'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const escape=text=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-account-history-'));
  const extension=path.join(temp,'extension');fs.cpSync(path.join(ROOT,'dist/experimental/chrome'),extension,{recursive:true});
  // Test-only host grant avoids native permission UI. The shipped host is optional.
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
  assert.deepEqual(manifest.permissions,['storage','offscreen']);
  assert.deepEqual(manifest.optional_host_permissions,['https://myactivity.google.com/*']);
  manifest.host_permissions.push(...manifest.optional_host_permissions);
  fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host,day=Ledger.datesEnding(Ledger.dayKey(Date.now()),2)[0],base=+new Date(day+'T01:00:00');
    const accountKey=crypto.createHash('sha256').update('fixture@example.test').digest('hex');
    const shorts=Array.from({length:187},(_,i)=>({videoId:'s'+String(i).padStart(10,'0'),title:`Synthetic Short ${i}`,mediaType:'short',watchedAt:base+i*60000,videoDurationSeconds:30,channelName:'Fixture Channel',channelId:'UC'+'A'.repeat(22)}));
    const videos=[{...shorts[0],videoId:'v0000000000',title:'Recovered normal video',mediaType:'video',watchedAt:base+60*60000,videoDurationSeconds:900},{...shorts[0],videoId:'v0000000001',title:'Another normal video',mediaType:'video',watchedAt:base+190*60000,videoDurationSeconds:1200}];
    const unloaded=Array.from({length:150},(_,i)=>({...shorts[0],videoId:'u'+String(i).padStart(10,'0'),title:'Outside initial YouTube classification '+i,watchedAt:base-(i+1)*60000}));
    const all=[...shorts,...videos,...unloaded].sort((a,b)=>b.watchedAt-a.watchedAt),snapshot=all.slice(0,100);
    const rpcRow=r=>{const row=Array(33).fill(null);row[4]=r.watchedAt*1000;row[7]=['YouTube'];row[9]=[r.title,null,'Watched','https://www.youtube.com/watch?v='+r.videoId];row[19]=[['iOS']];row[23]=[null,Math.floor(r.videoDurationSeconds/60)+':'+String(r.videoDurationSeconds%60).padStart(2,'0')];row[32]=[[null,r.channelName,null,'https://www.youtube.com/channel/'+r.channelId]];return row;};
    const batch=start=>[all.slice(start,start+100).map(rpcRow),start+100<all.length?'cursor-'+(start+100):null];
    const cached=AccountHistory.normalize({...shorts[10],sourceOrder:178,device:'iOS'},accountKey);
    const direct={id:'direct',videoId:shorts[180].videoId,title:'Direct metadata stays authoritative',channel:'Direct channel',url:'https://www.youtube.com/watch?v='+shorts[180].videoId,start:shorts[180].watchedAt+10000,end:shorts[180].watchedAt+40000,label:'Learning',seconds:{foreground:20,backgroundAudio:10,backgroundSilent:0,paused:0,browsing:0,ad:0}};
    const content={sectionListRenderer:{contents:[{reelShelfRenderer:{items:shorts.map(s=>({shortsLockupViewModel:{onTap:{innertubeCommand:{reelWatchEndpoint:{videoId:s.videoId}}}}}))}},...videos.map(v=>({lockupViewModel:{contentId:v.videoId,contentType:'LOCKUP_CONTENT_TYPE_VIDEO'}}))]}};
    const sourceData={contents:{twoColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{selected:true,content}}]}}};
    const ytHTML=`<!doctype html><script>var ytInitialData = ${JSON.stringify(sourceData)};</script><img src="https://never-load.invalid/yt">`;
    const cards=snapshot.map(r=>`<c-wiz data-date="${day.replaceAll('-','')}"><div aria-label="Card showing an activity from YouTube"><a href="https://www.youtube.com/watch?v=${r.videoId}">${escape(r.title)}</a><a href="https://www.youtube.com/channel/${r.channelId}">${r.channelName}</a><div>${new Date(r.watchedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} • <a aria-label="Open details of activity &quot;Watched ${escape(r.title)}&quot;">Details</a></div><span class="bI9urf">${Math.floor(r.videoDurationSeconds/60)+':'+String(r.videoDurationSeconds%60).padStart(2,'0')}</span></div></c-wiz>`).join('');
    const bootstrap=`<script>var WIZ_global_data={"SNlM0e":"fixture-csrf","FdrFJe":"fixture-session","cfb2h":"fixture-build"};var AF_dataServiceRequests = {'ds:5' : {id:'y3VFHd',request:[[null,["youtube"]],null,100,null,[]]}};AF_initDataCallback({key:'ds:5',data:${JSON.stringify(batch(0))},sideChannel:{}});</script>`;
    const googleHTML=`<!doctype html>${bootstrap}<button aria-label="Google Account: Fixture (fixture@example.test)">Account</button>${cards}<button>Load more</button><script>fetch('https://never-load.invalid/script');throw new Error('Source scripts must be inert')</script><img src="https://never-load.invalid/image"><iframe src="https://never-load.invalid/frame"></iframe>`;
    let release,releaseManual;const gate=new Promise(resolve=>release=resolve),manualGate=new Promise(resolve=>releaseManual=resolve);let slow=true,fail=false;const requests=[];
    await context.route('https://**/*',async route=>{
      const url=route.request().url();requests.push({url,navigation:route.request().isNavigationRequest()});
      if(slow) await gate;
      if(fail) {await sleep(500);return route.fulfill({status:403,headers:{'retry-after':'259200'},contentType:'text/html',body:'Refused'});}
      if(url.startsWith('https://myactivity.google.com/_/FootprintsMyactivityUi/data/batchexecute?')) {
        const params=new URLSearchParams(route.request().postData());assert.equal(params.get('at'),'fixture-csrf');
        const payload=JSON.parse(JSON.parse(params.get('f.req'))[0][0][1]);assert.equal(payload[2],100);
        const start=Number(payload[1].slice('cursor-'.length));assert.ok([100,200].includes(start),'no fourth batch');
        if(start===100) await manualGate;
        await sleep(250);
        return route.fulfill({contentType:'application/json',body:")]}'\n\n100\n"+JSON.stringify([['wrb.fr','y3VFHd',JSON.stringify(batch(start)),null,null,null,'generic']])+'\n'});
      }
      if(url.startsWith('https://myactivity.google.com/product/youtube?')) return route.fulfill({contentType:'text/html',body:googleHTML});
      if(url.startsWith('https://www.youtube.com/feed/history?')) return route.fulfill({contentType:'text/html',body:ytHTML});
      return route.abort();
    });
    // Dashboard thumbnails are a separate, expected UI request. Source HTML
    // resources still hit the catch-all above and must never execute/load.
    await context.route('https://i.ytimg.com/**',route=>route.abort());
    const oldSync=Date.now()-25*60*60000;
    await worker.evaluate(({day,direct,cached,accountKey,oldSync})=>browser.storage.local.set({['day:'+day]:[direct],settings:{theme:'dark-green'},'accountHistory:config':{enabled:true,revision:1},'accountHistory:cache':{accountKey,observations:[cached],lastSuccessfulSync:oldSync,lastRecoveredCount:1}}),{day,direct,cached,accountKey,oldSync});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#overview?date=${day}`);
    await page.locator('#cross-device-shorts-count').filter({hasText:'1 recovered Shorts'}).waitFor();
    // A page shell can contain an empty-state translation in a script while
    // its activity has not loaded. It must not erase or validate the cache.
    const emptyStates=await page.evaluate(async()=>{
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='account-history-parser.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
      const account='<button aria-label="Google Account: Fixture (fixture@example.test)"></button>';
      let shellRejected=false;
      try {AccountHistoryParser.google(account+'<script>var message="No activity";</script>',{});}catch(error){shellRejected=error.code==='schema';}
      const empty=AccountHistoryParser.google(account+'<main>No activity</main>',{});
      return {shellRejected,emptyCards:empty.cardCount};
    });
    assert.deepEqual(emptyStates,{shellRejected:true,emptyCards:0});
    assert.match(await page.locator('#trend-totals').textContent(),/Directly tracked playback/);
    await page.getByRole('button',{name:'Sources',exact:true}).click();
    assert.equal(await page.locator('.source-segment').evaluateAll(nodes=>nodes.reduce((n,b)=>n+Number(b.dataset.seconds),0)),30,'Recovered history never enters recorded source playback');
    await page.getByRole('button',{name:'Playback',exact:true}).click();
    await sleep(300);assert.equal(requests.length,0,'Overview renders cache without initiating a check');
    const nav=view=>page.locator('.dashboard-nav').getByRole('link',{name:view,exact:true});
    await nav('History').click();await nav('Overview').click();await nav('History').click();
    assert.equal(await page.locator('#cross-device-rows details').count(),1,'cached session renders while source is blocked');
    await sleep(1000);assert.equal(requests.length,1,'concurrent views join the single flight');
    assert.ok(requests[0].url.includes('myactivity.google.com'));
    assert.equal(await page.locator('#cross-history-progress').isVisible(),true);
    assert.match(await page.locator('#cross-history-phase').textContent(),/Reading recent Google/);
    slow=false;release();
    await page.waitForFunction(async()=>((await browser.storage.local.get('accountHistory:cache'))['accountHistory:cache']?.lastSuccessfulSync || 0)>Date.now()-60000,null,{timeout:15000}).catch(async error=>{console.error(await worker.evaluate(()=>browser.storage.local.get('accountHistory:status')));throw error;});
    await page.waitForFunction(()=>document.querySelectorAll('#cross-device-rows details li').length===99);
    assert.ok(await page.locator('#cross-device-rows details').count()<10);
    assert.equal(await page.locator('#cross-device-rows details[open]').count(),0);
    assert.match(await page.locator('#cross-device-rows').textContent(),/Watch duration unavailable/);
    assert.equal(await page.locator('#rows tr').count(),1);
    assert.match(await page.locator('#rows').textContent(),/Direct metadata stays authoritative/);
    await page.locator('#cross-device-rows summary').first().click();await page.evaluate(()=>render());
    assert.equal(await page.locator('#cross-device-rows details[open]').count(),1);
    const stored=await worker.evaluate(()=>browser.storage.local.get(null));
    assert.equal(stored['accountHistory:cache'].observations.length,101);
    assert.equal(AccountHistory.project(stored['accountHistory:cache'],[direct]).events.length,100);
    assert.equal(stored['accountHistory:cache'].lastRecoveredCount,99);
    assert.equal(stored['accountHistory:cache'].coverage.googleCardCount,100);
    assert.deepEqual(stored['day:'+day],[direct]);
    assert.equal(requests.length,2,'no Load more, source scripts, images or frames');
    assert.equal(requests.some(row=>row.navigation),false,'no remote navigations');
    assert.equal(context.pages().filter(p=>/^https:/.test(p.url())).length,0,'no source tabs');
    assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0,'local parser closed');
    await page.locator('#cross-device-check-missing').click();
    await page.locator('#cross-history-phase').filter({hasText:'batch 2'}).waitFor();
    // A review in another dashboard joins the active manual read despite the
    // just-persisted daily budget, and exports the completed result.
    const reviewPage=await context.newPage();await reviewPage.goto(`chrome-extension://${extensionId}/dashboard.html#review?date=${day}`);
    const joinedDownload=reviewPage.waitForEvent('download');await reviewPage.locator('#prompt').click();
    await reviewPage.locator('#cross-review-status').filter({hasText:'Refreshing cross-device history…'}).waitFor();
    releaseManual();
    const joinedReport=JSON.parse(fs.readFileSync(await (await joinedDownload).path(),'utf8').split('\n\nDATA:\n')[1]);
    assert.equal(joinedReport.crossDeviceHistory.recoveredEvents.length,188);
    await reviewPage.close();
    await page.waitForFunction(async()=>((await browser.storage.local.get('accountHistory:cache'))['accountHistory:cache']?.lastRecoveredCount)===88);
    await page.waitForFunction(()=>document.querySelectorAll('#cross-device-rows details li').length===186);
    assert.equal(requests.length,6,'manual check: initial page + two continuations + YouTube classification');
    const expanded=await worker.evaluate(()=>browser.storage.local.get(null));
    assert.equal(expanded['accountHistory:cache'].coverage.batchesRead,3);
    assert.equal(expanded['accountHistory:cache'].coverage.googleCardCount,300);
    assert.equal(expanded['accountHistory:cache'].coverage.stopReason,'batch-limit');
    assert.match(await page.locator('#cross-history-coverage').textContent(),/111 watch entries could not be matched/);
    assert.equal(expanded['accountHistory:cache'].coverage.overlapCount,100,'directly tracked observation excluded from overlap evidence');
    assert.equal(expanded['accountHistory:cache'].observations.length,189);
    assert.equal(JSON.stringify(expanded).includes('fixture-csrf'),false,'request context is never persisted');
    assert.deepEqual(expanded['day:'+day],[direct]);
    const manual=await page.evaluate(()=>browser.runtime.sendMessage({type:'accountHistory:sync',force:true}));
    assert.equal(manual.throttled,true);assert.equal(requests.length,6);
    // A six-minute-old review uses cached data during the daily automatic limit.
    await page.evaluate(async()=>{const data=await browser.storage.local.get('accountHistory:cache');data['accountHistory:cache'].lastSuccessfulSync=Date.now()-6*60000;await browser.storage.local.set(data);});
    await nav('Review').click();let download=page.waitForEvent('download');await page.locator('#prompt').click();
    let downloaded=await download;let report=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8').split('\n\nDATA:\n')[1]);
    assert.equal(requests.length,6);assert.equal(report.crossDeviceHistory.minimumSyncIntervalMs,86400000);assert.equal(report.crossDeviceHistory.manualSyncIntervalMs,1200000);
    assert.match(await page.locator('#cross-review-status').textContent(),/Using cached history/);
    // Once eligible, review waits for a request, then falls back on a refusal.
    await page.evaluate(async()=>{const data=await browser.storage.local.get('accountHistory:cache');data['accountHistory:cache'].lastSuccessfulSync=Date.now()-25*60*60000;await browser.storage.local.set({...data,'accountHistory:status':{lastAttemptAt:Date.now()-25*60*60000}});});
    fail=true;download=page.waitForEvent('download');await page.locator('#prompt').click();
    await page.locator('#cross-review-status').filter({hasText:'Refreshing cross-device history…'}).waitFor();
    downloaded=await download;report=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8').split('\n\nDATA:\n')[1]);
    assert.ok(report.crossDeviceHistory.lastSuccessfulSync);assert.match(report.crossDeviceHistory.lastRefreshError,/refused access/);
    assert.equal(report.crossDeviceHistory.recoveredEvents.length,188);assert.equal(report.totalsSeconds.foreground,20);
    assert.equal(requests.length,7,'refusal stops before YouTube or any retry');
    const refusal=await worker.evaluate(async()=>(await browser.storage.local.get('accountHistory:status'))['accountHistory:status']);
    assert.equal(refusal.httpStatus,403);assert.equal(refusal.manualRetry,true);
    assert.ok(refusal.nextAllowedAt>=Date.now()+3*24*60*60000-10000,'longer server delay wins over 48-hour minimum');
    await nav('History').click();await page.reload();
    await page.locator('#cross-history-warning').filter({hasText:'HTTP 403'}).waitFor();
    assert.match(await page.locator('#cross-history-warning').textContent(),/Automatic sync stays paused.*manual retry is available after/);
    assert.equal(await page.locator('#cross-device-check-missing').isDisabled(),true);
    assert.match(await page.locator('#cross-review-status').textContent(),/^$/);
    for(const theme of ['dark-green','classic','retrowave','frutiger-aero']) {
      await nav('Settings').click();await page.locator('#setting-theme').selectOption(theme);await page.setViewportSize({width:375,height:900});
      for(const view of ['Overview','History','Settings']) {
        await nav(view).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' '+view);
        assert.equal(await page.locator('#cross-device-sync').isVisible(),view==='Settings');
        if(view==='History')assert.equal(await page.locator('#cross-history-warning').isVisible(),true);
        if(view==='Settings')assert.match(await page.locator('#cross-device-status').textContent(),/HTTP 403.*Cached history is kept.*manual retry is available after/);
      }
      assert.equal(await page.locator('#cross-device-sync').isDisabled(),true);
      assert.equal(await page.locator('#cross-device-sync').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
    }
    assert.equal(requests.length,7,'paused state survives navigation');
    await page.setViewportSize({width:1280,height:960});await nav('Settings').click();
    await page.screenshot({path:path.join(__dirname,'settings-preview.png'),fullPage:true});
    await nav('History').click();await page.screenshot({path:path.join(__dirname,'history-preview.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Experimental integration passed: cached-first History-only daily check, progress, two initial GETs, manual three-batch catch-up, no source tabs/resource execution, 20-minute manual budget, source-import overlap excluding direct playback, no persisted request context, authoritative direct records, collapsed sessions, review refusal fallback, four themes, narrow layouts. Synthetic data only.');
  } finally {await context.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
