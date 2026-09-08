const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-recording-')),extension=path.join(__dirname,'dist/chrome');let context;const errors=[];
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1200,height:900},args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(()=>LedgerStorage.write(async()=>{}));
  const used=await worker.evaluate(async()=>{
   await chrome.storage.local.remove(LedgerStorage.reserveKey);
   const data={settings:Ledger.settings({theme:'classic'}),[WatchStatus.key]:{version:1,videos:{}}};
   for(let i=1;i<=11;i++)data['goals:2026-08-'+String(i).padStart(2,'0')]='x'.repeat(950000);
   await chrome.storage.local.set(data);
   const before=await chrome.storage.local.getBytesInUse(null),quota=chrome.storage.local.QUOTA_BYTES,key='goals:2026-08-12';
   await chrome.storage.local.set({[key]:'x'.repeat(quota-before-key.length-2-100)});
   return {quota,used:await chrome.storage.local.getBytesInUse(null),valid:!!LedgerBackup.validate(LedgerBackup.wrap(await chrome.storage.local.get(null)))};
  });assert.equal(used.quota-used.used,100);assert.ok(used.valid);
  const samples=8000*45,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().endsWith('.wav')?{contentType:'audio/wav',body:wav}:{contentType:'text/html',body:'<!doctype html><title>Quota fixture - YouTube</title><ytd-watch-metadata><h1>Quota fixture</h1></ytd-watch-metadata><video autoplay src="/fixture.wav"></video>'}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/watch?v=quotatest01');
  await page.locator('#ledger-recording-warning').waitFor();assert.match(await page.locator('#ledger-recording-warning p').textContent(),/could not save/);
  assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})), '!');assert.deepEqual(await worker.evaluate(async()=>Object.keys(await chrome.storage.local.get(null)).filter(k=>k.startsWith('day:'))),[]);
  const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
  await dashboard.locator('#recording-warning').waitFor();assert.equal(await dashboard.locator('#tracking-indicator').textContent(),'Recording warning');assert.match(await dashboard.locator('#recording-warning').textContent(),/ran out of storage/);
  await dashboard.screenshot({path:path.join(__dirname,'recording-warning-preview.png')});
  // Free only a disposable fixture note. The same failed batch must now be recovered.
  await worker.evaluate(()=>chrome.storage.local.remove('goals:2026-08-01'));
  await page.locator('#ledger-recording-warning').waitFor({state:'detached',timeout:15000});
  const playhead=await page.locator('video').evaluate(v=>{v.pause();document.dispatchEvent(new Event('visibilitychange'));return v.currentTime;});
  await page.waitForTimeout(400);
  const saved=await worker.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).filter(([k])=>k.startsWith('day:')).flatMap(([,v])=>v).reduce((n,r)=>n+Ledger.playbackSeconds(r.seconds),0));
  assert.ok(saved>=playhead-2.5&&saved<=playhead+1.2,`Retried activity counted once: ${saved}s vs ${playhead}s played`);
  assert.equal(await dashboard.locator('#tracking-indicator').textContent(),'Recording warning','Keep the warning until history has been checked');
  await dashboard.getByRole('button',{name:'Dismiss warning'}).click();await dashboard.locator('#recording-warning').waitFor({state:'hidden'});assert.equal(await dashboard.locator('#tracking-indicator').textContent(),'Tracking active');assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})), '');
  assert.deepEqual(errors,[]);console.log(`PASS: real Chrome quota failure surfaces on YouTube, dashboard and badge; freeing storage recovers ${saved.toFixed(2)} seconds without double counting; warning dismissal restores normal status.`);
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
