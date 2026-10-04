// Real Chrome MV3 vault, using synthetic records and a disposable profile only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const extension=process.env.LEDGER_EXTENSION_DIR ? path.resolve(process.env.LEDGER_EXTENSION_DIR) : path.resolve(__dirname,'../dist/chrome-preview/0.18.0');
const password='orchard quiet lantern river 846',nextPassword='another gentle river meadow 629';
const until=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label);};
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-chrome-vault-')),errors=[];
 let context;
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:['--autoplay-policy=no-user-gesture-required','--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=()=>context.serviceWorkers()[0]||context.waitForEvent('serviceworker');
 async function dashboard(id){const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('chrome-extension://'+id+'/dashboard.html');return page;}
 const persisted=w=>w.evaluate(async()=>({local:await chrome.storage.local.get(null),idb:await LedgerVaultIDB().entries()}));
 async function youtube(videoId='cryptotest1'){
  const samples=8000*60,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const page=await context.newPage();
  await page.route('https://www.youtube.com/**',route=>route.fulfill(route.request().url().endsWith('fixture.wav')?{contentType:'audio/wav',body:wav}:{contentType:'text/html',body:'<!doctype html><title>ENCRYPTED CHROME FIXTURE - YouTube</title><ytd-masthead><div id="center"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead><ytd-watch-metadata><h1>ENCRYPTED CHROME FIXTURE</h1><div id="owner"><div id="channel-name"><a href="https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa">PRIVATE CREATOR</a></div></div></ytd-watch-metadata><video autoplay src="/fixture.wav"></video><ytd-watch-flexy video-id="'+videoId+'"><div id="related">Recommendation</div></ytd-watch-flexy>'}));
  await page.goto('https://www.youtube.com/watch?v='+videoId);await page.bringToFront();return page;
 }
 try{
  context=await launch();let w=await worker(),id=new URL(w.url()).host;
  await w.evaluate(async()=>{await chrome.storage.local.set({settings:{theme:'retrowave',animateRetrowave:false},'goals:2026-10-03':'PRIVATE MIGRATED NOTE'});});
  let page=await dashboard(id);
  await page.getByRole('heading',{name:'Welcome to Ledger'}).waitFor();
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-confirm').fill(password);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await until(async()=>await page.locator('#vault-key').isVisible()||/failed|error|missing|Invalid|could not|Cannot|unsupported/i.test(await page.locator('#vault-message').textContent()),'vault creation');
  assert.equal(await page.locator('#vault-key').isVisible(),true,await page.locator('#vault-message').textContent());
  const recovery=await page.locator('#vault-key-value').inputValue();assert.ok(recovery.length>40);
  await page.locator('#vault-key-saved').check();await page.getByRole('button',{name:'Continue to Ledger'}).click();
  await page.locator('#setup-save').waitFor();await page.locator('#setup-tracking').check();await page.locator('#setup-hideRecommendations').check();
  await page.locator('#setup-save').click();await page.locator('#setup-panel').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(async()=>(await LedgerBrowser.storage.local.get('goals:2026-10-03'))['goals:2026-10-03']),'PRIVATE MIGRATED NOTE');
  let raw=await persisted(w);assert.deepEqual(raw.local,{});assert.ok(!JSON.stringify(raw).includes('PRIVATE MIGRATED NOTE'));
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('#setting-theme').selectOption('classic');
  assert.equal(await page.getByRole('tabpanel').count(),1,'Deferred startup preserves the four Settings categories');
  await until(()=>page.evaluate(async()=>(await LedgerBrowser.storage.local.get('settings')).settings.theme==='classic'),'theme write');
  const yt=await youtube();
  await until(()=>w.evaluate(async()=>Object.entries(await LedgerBrowser.storage.local.get(null)).some(([key,rows])=>key.startsWith('day:')&&rows.some(row=>row.title==='ENCRYPTED CHROME FIXTURE'))),'unlocked real recording');
  // Only extension scripts can make this call. The worker enforces a separate
  // allowlist for the YouTube sender, even for a forged internal storage request.
  const cdp=await context.newCDPSession(yt),worlds=[];cdp.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await cdp.send('Runtime.enable');
  const isolated=worlds.find(world=>world.name.includes('Ledger')||world.origin==='chrome-extension://'+id);
  assert.ok(isolated,'Ledger isolated content world: '+JSON.stringify(worlds));
  await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'globalThis.ledgerTestChanges=[]; chrome.runtime.onMessage.addListener(m=>{if(m.type==="vault:changed")ledgerTestChanges.push(m);});'});
  await page.evaluate(async()=>{const {settings}=await LedgerBrowser.storage.local.get('settings');await LedgerBrowser.storage.local.set({settings:{...settings,reviewPreference:'PRIVATE REVIEW INSTRUCTIONS'}});});
  const visible=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'chrome.runtime.sendMessage({type:"vault:storage",method:"get",keys:["settings"]})',awaitPromise:true,returnByValue:true});
  assert.equal(visible.result.value.settings.reviewPreference,undefined,'Content scripts do not need private review instructions');
  const changes=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'JSON.stringify(ledgerTestChanges)',returnByValue:true});
  assert.ok(!changes.result.value.includes('PRIVATE REVIEW INSTRUCTIONS'),'Settings notifications must omit review instructions too');
  for(const request of [{type:'vault:storage',method:'get',keys:null},{type:'vault:storage',method:'clear'},{type:'vault:password',secret:password,next:nextPassword},{type:'vault:remember',enabled:true},{type:'vault:remember',enabled:false},{type:'vault:browserUnlock',enabled:true},{type:'vault:browserUnlock',enabled:false,secret:password}]){
    const denied=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'chrome.runtime.sendMessage('+JSON.stringify(request)+')',awaitPromise:true,returnByValue:true});
    assert.ok(denied.result.value?.ledgerError,'YouTube must not access dashboard-only operations');
  }
  // A second dashboard in the same session opens without a password.
  const second=await dashboard(id);await second.locator('#trend-totals .card').first().waitFor();
  assert.equal(await second.locator('#vault-entry').count(),0);
  const targets=await cdp.send('Target.getTargets'),target=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url===w.url());
  assert.ok(target);await cdp.send('Target.closeTarget',{targetId:target.targetId});
  assert.equal((await page.evaluate(()=>LedgerBrowser.runtime.sendMessage({type:'vault:status'}))).unlocked,true,'Worker restart keeps session unlock');
  w=await worker();
  const backup=await page.evaluate(()=>LedgerBrowser.runtime.sendMessage({type:'backup:export'}));
  assert.equal(backup.format,'ledger-encrypted-profile');assert.ok(!JSON.stringify(backup).includes('PRIVATE MIGRATED NOTE'));
  assert.equal((await page.evaluate(backup=>LedgerBrowser.runtime.sendMessage({type:'vault:openBackup',backup}),backup)).format,'youtube-ledger-backup');
  await page.getByRole('link',{name:'Groups',exact:true}).click();await page.getByRole('textbox',{name:'New group name',exact:true}).fill('Private Chrome group');
  await page.getByRole('button',{name:'Create group',exact:true}).click();await page.getByRole('button',{name:/Private Chrome group/}).first().waitFor();
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('#settings-tab-data').click();
  const savedDownload=page.waitForEvent('download');await page.locator('#backup-export').click();
  const exported=JSON.parse(fs.readFileSync(await(await savedDownload).path(),'utf8'));assert.equal(exported.format,'ledger-encrypted-profile');
  await page.locator('#backup-file').setInputFiles({name:'encrypted-ledger.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.locator('#backup-restore').waitFor();await page.locator('#backup-status').filter({hasText:'Profile checked'}).waitFor();
  // Exercise actual encrypted export/import UI and its automatic recovery file.
  const recoveryDownload=page.waitForEvent('download');await page.locator('#backup-restore').click();await recoveryDownload;
  await page.locator('#backup-status').filter({hasText:'Profile imported.'}).waitFor();
  assert.equal(await page.evaluate(async()=>(await LedgerBrowser.storage.local.get('channelGroups:v1'))['channelGroups:v1'].groups[0].name),'Private Chrome group');
  for(const width of [430,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Encrypted data settings fit '+width);}
  await page.setViewportSize({width:1280,height:900});
  await context.close();context=await launch();w=await worker();
  page=await dashboard(id);await page.getByRole('heading',{name:'Unlock your Ledger'}).waitFor();
  assert.equal(await page.locator('main').isVisible(),false);assert.equal(await w.evaluate(async()=>(await chrome.storage.session.get('ledgerVaultSession:v1'))['ledgerVaultSession:v1']),undefined);
  const lockedVideo=await youtube('lockedtest1');
  await until(()=>w.evaluate(async()=>(await LedgerChromeVaultStore.status()).pendingBatches>=3),'locked real recording');
  raw=await persisted(w);for(const secret of ['PRIVATE MIGRATED NOTE','ENCRYPTED CHROME FIXTURE','PRIVATE CREATOR','cryptotest1',password,recovery])assert.ok(!JSON.stringify(raw).includes(secret),'persisted plaintext: '+secret);
  // Page storage must not contain Ledger source hints or private group searches.
  assert.deepEqual(await lockedVideo.evaluate(()=>Object.keys(sessionStorage).filter(key=>/ledger/i.test(key))),[]);
  await page.bringToFront();await page.locator('#vault-secret').fill('wrong passphrase');await page.locator('#vault-submit').click();
  await page.getByText(/Could not unlock/).waitFor();assert.equal(await page.locator('main').isVisible(),false);
  await lockedVideo.evaluate(()=>document.querySelector('video').pause());
  const lockedSeconds=await w.evaluate(async password=>{const io=LedgerVaultIDB(),meta=await io.get('meta'),key=await LedgerChromeCrypto.unlock(meta.config,password);let total=0;for(const [name,sealed]of await io.entries())if(name.startsWith('inbox:')){const payload=await LedgerChromeCrypto.open(meta.config,key,sealed);for(const event of payload.message.events)if(event.videoId==='lockedtest1'&&event.state==='foreground')total+=(event.end-event.start)/1000;}return total;},password);
  // Interrupt between the durable history commit and removing its inbox entry.
  await w.evaluate(()=>{const acknowledge=LedgerChromeVaultStore.acknowledge;let fail=true;LedgerChromeVaultStore.acknowledge=name=>{if(fail){fail=false;return Promise.reject(Error('Simulated interruption after saving history'));}return acknowledge(name);};});
  await page.locator('#vault-secret').fill(recovery);await page.locator('#vault-recovery').check();await page.locator('#vault-submit').click();
  await page.getByText('Simulated interruption after saving history',{exact:true}).waitFor();
  await page.locator('#vault-submit').click();
  await page.locator('#vault-entry').waitFor({state:'detached'});
  assert.equal((await w.evaluate(()=>LedgerChromeVaultStore.status())).pendingBatches,0);
  const all=await page.evaluate(()=>LedgerBrowser.storage.local.get(null));assert.equal(all.settings.theme,'classic');assert.equal(all['goals:2026-10-03'],'PRIVATE MIGRATED NOTE');
  assert.ok(Object.entries(all).some(([key,rows])=>key.startsWith('day:')&&rows.some(row=>row.videoId==='lockedtest1'&&row.seconds.foreground>0)),'Viewing captured while locked must be merged, not discarded');
  const replayed=Object.entries(all).filter(([key])=>key.startsWith('day:')).flatMap(([,rows])=>rows).filter(row=>row.videoId==='lockedtest1').reduce((sum,row)=>sum+row.seconds.foreground,0);
  assert.ok(replayed>=lockedSeconds&&replayed<lockedSeconds+2,'Interrupted replay must not add the same five-second batch twice');
  await page.evaluate(({password,nextPassword})=>LedgerBrowser.runtime.sendMessage({type:'vault:password',secret:password,next:nextPassword}),{password,nextPassword});
  raw=await persisted(w);assert.deepEqual(raw.local,{},'Background writes after restart must stay behind the vault');
  for(const value of ['PRIVATE MIGRATED NOTE','lockedtest1','Private Chrome group'])assert.ok(!JSON.stringify(raw).includes(value));
  await context.close();context=await launch();w=await worker();page=await dashboard(id);
  await page.locator('#vault-secret').fill(nextPassword);await page.locator('#vault-submit').click();await page.locator('#vault-entry').waitFor({state:'detached'});
  // Old backups keep the key wrapping from the time they were exported.
  assert.ok(await page.evaluate(({backup,password})=>LedgerBrowser.runtime.sendMessage({type:'vault:openBackup',backup,secret:password}),{backup,password}));
  assert.deepEqual(errors,[]);
  console.log('PASS: Chrome vault UI, verified migration, actual playback, ciphertext-only persistence and full backups, two dashboards, locked recording after browser restart, wrong-key rejection, recovery unlock, inbox compaction, password changes and original-backup recovery.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
