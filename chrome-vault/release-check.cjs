// First-public-release lifecycle in a disposable profile, with synthetic data.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const source=process.env.LEDGER_EXTENSION_DIR ? path.resolve(process.env.LEDGER_EXTENSION_DIR) : path.resolve(__dirname,'../dist/chrome-release-candidate/0.18.0/extension');
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-store-release-')),profile=path.join(temporary,'profile'),extension=path.join(temporary,'extension');
 fs.cpSync(source,extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
 assert.equal(manifest.name,'YouTube Ledger');assert.equal(manifest.optional_permissions,undefined);
 assert.ok(!fs.existsSync(path.join(extension,'local-sync.js')));
 const errors=[],password='Release lifecycle synthetic passphrase 492';let context,page,worker,id;
 async function launch(){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  // Match a real unpacked install. CLI-only installs otherwise get disabled by
  // Chrome at runtime.reload() when Developer mode has never been enabled.
  const manager=await context.newPage();await manager.goto('chrome://extensions/');
  await manager.evaluate(()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));await manager.close();
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');id=new URL(worker.url()).host;
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('chrome-extension://'+id+'/dashboard.html');
 }
 const request=message=>page.evaluate(message=>LedgerBrowser.runtime.sendMessage(message),message);
 const settings=async()=>{await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('#settings-tab-data').click();};
 try{
  await launch();await page.getByRole('heading',{name:'Welcome to Ledger'}).waitFor();
  assert.equal(await page.locator('#vault-remember-row').isVisible(),false,'No public companion setup');
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-confirm').fill(password);await page.locator('#vault-submit').click();
  await page.locator('#vault-key').waitFor();const recovery=await page.locator('#vault-key-value').inputValue();
  await page.locator('#vault-key-saved').check();await page.locator('#vault-continue').click();
  await page.locator('#setup-save').waitFor();await page.locator('#setup-tracking').check();await page.locator('#setup-save').click();await page.locator('#setup-panel').waitFor({state:'hidden'});
  await page.evaluate(()=>LedgerBrowser.storage.local.set({'goals:2026-10-03':'RELEASE PRIVATE NOTE'}));
  await settings();assert.equal(await page.locator('#local-sync').count(),0);assert.equal(await page.locator('.vault-remember-tools').isVisible(),false);
  assert.ok(!(await page.locator('body').innerText()).includes('companion'));
  await assert.rejects(request({type:'vault:remember',enabled:true}),/not included/);
  await assert.rejects(request({type:'localSync:status'}),/not included/);
  const before=await worker.evaluate(()=>LedgerVaultIDB().entries());
  const backup=await request({type:'backup:export'});
  // Browser update/reload rehearsal. The copied candidate increments only its
  // version; this tests preservation, not old-version code compatibility.
  await context.close();manifest.version='0.18.1';fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  await launch();await page.getByRole('heading',{name:'Unlock your Ledger'}).waitFor();
  assert.equal(await worker.evaluate(()=>chrome.runtime.getManifest().version),'0.18.1');
  assert.deepEqual(await worker.evaluate(()=>LedgerVaultIDB().entries()),before,'Version-only update preserves the encrypted profile');
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-submit').click();await page.locator('#vault-entry').waitFor({state:'detached'});
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],'RELEASE PRIVATE NOTE');
  // A damaged session key used to poison startup even with valid recovery.
  await worker.evaluate(async()=>{const meta=await LedgerVaultIDB().get('meta');await chrome.storage.session.set({'ledgerVaultSession:v1':{id:meta.config.id,key:'broken'}});});
  const cdp=await context.newCDPSession(page),targets=await cdp.send('Target.getTargets');
  await cdp.send('Target.closeTarget',{targetId:targets.targetInfos.find(t=>t.type==='service_worker'&&t.url===worker.url()).targetId});
  await page.reload();await page.getByText(/This session could not reopen Ledger/).waitFor();
  await page.locator('#vault-recovery').check();await page.locator('#vault-secret').fill(recovery);await page.locator('#vault-submit').click();await page.locator('#vault-entry').waitFor({state:'detached'});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],'RELEASE PRIVATE NOTE');
  await request({type:'vault:browserUnlock',enabled:true});
  assert.equal((await request({type:'vault:status'})).browserUnlock,true);
  assert.equal((await request({type:'data:eraseAll'})).ok,true);
  await new Promise(resolve=>setTimeout(resolve,1800));
  // Chrome closes extension pages when runtime.reload() completes.
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(let attempt=0;;attempt++){
   try{await page.goto('chrome-extension://'+id+'/dashboard.html');break;}
   catch(error){if(attempt===20)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
  }
  await page.getByRole('heading',{name:'Unlock your Ledger'}).waitFor();
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-submit').click();await page.locator('#setup-save').waitFor();
  assert.equal((await request({type:'vault:status'})).browserUnlock,false);
  assert.equal((await request({type:'vault:status'})).paused,true);
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],undefined);
  // Old encrypted backup remains usable after explicit deletion of live data.
  await page.locator('#setup-save').click();await page.locator('#setup-panel').waitFor({state:'hidden'});await settings();
  await page.locator('#backup-file').setInputFiles({name:'ledger-release-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#backup-status').filter({hasText:'Profile checked'}).waitFor();
  const download=page.waitForEvent('download');await page.locator('#backup-restore').click();await download;
  await page.locator('#backup-status').filter({hasText:'Profile imported.'}).waitFor();
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],'RELEASE PRIVATE NOTE');
  assert.equal((await request({type:'vault:status'})).browserUnlock,false,'Backup cannot re-enable the browser key');
  const localPolicy=await context.newPage();await localPolicy.goto('chrome-extension://'+id+'/docs/privacy.html');
  await localPolicy.getByRole('heading',{name:'Privacy policy for Chrome',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: public companion removal, version-update preservation, damaged-session recovery, erase-all stops recording/removes automatic key, encrypted backup restore and bundled Chrome policy.');
 }finally{await context?.close();fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
})().catch(error=>{console.error(error);process.exitCode=1;});
