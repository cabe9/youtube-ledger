// A real browser profile and real IndexedDB CryptoKey cloning, no native host.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const extension=process.env.LEDGER_EXTENSION_DIR ? path.resolve(process.env.LEDGER_EXTENSION_DIR) : path.resolve(__dirname,'../dist/chrome-preview/0.18.0');
const password='Quiet orchard automatic access 573';
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-browser-access-')),errors=[];
 const images=path.resolve(__dirname,'../dist/public-setup-check');fs.mkdirSync(images,{recursive:true});
 let context,page,id,worker;
 async function launch(){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:1000},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');id=new URL(worker.url()).host;
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome-extension://'+id+'/dashboard.html');
 }
 const request=message=>page.evaluate(message=>LedgerBrowser.runtime.sendMessage(message),message);
 async function dataSettings(){await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('#settings-tab-data').click();}
 async function credential(value){const dialog=page.locator('dialog');await dialog.locator('[name=secret]').fill(value);await dialog.getByRole('button',{name:'Continue',exact:true}).click();}
 try{
  await launch();await page.getByRole('heading',{name:'Welcome to Ledger'}).waitFor();
  assert.equal(await page.locator('#vault-browser-remember').isChecked(),false,'Automatic access is an explicit choice');
  await page.screenshot({path:path.join(images,'01-welcome.png'),fullPage:true});
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-confirm').fill(password);await page.locator('#vault-browser-remember').check();
  await page.locator('#vault-submit').click();await page.locator('#vault-key').waitFor();
  const recovery=await page.locator('#vault-key-value').inputValue();
  await page.locator('#vault-key-saved').check();await page.locator('#vault-continue').click();
  await page.locator('#setup-panel').waitFor();
  assert.equal((await request({type:'vault:status'})).paused,true);
  assert.ok(!(await page.locator('#setup-panel').textContent()).includes('not encrypted'));
  await page.locator('.setup-connection').waitFor();
  await page.screenshot({path:path.join(images,'02-tracking-and-connection.png'),fullPage:true});
  await page.locator('#setup-tracking').check();await page.locator('#setup-save').click();await page.locator('#setup-panel').waitFor({state:'hidden'});
  await page.evaluate(()=>LedgerBrowser.storage.local.set({'goals:2026-10-03':'AUTOMATIC PRIVATE NOTE'}));
  const backup=await request({type:'backup:export'});assert.equal(backup.format,'ledger-encrypted-profile');
  assert.ok(!JSON.stringify(backup).includes('browser-unlock'));assert.ok(!JSON.stringify(backup).includes('AUTOMATIC PRIVATE NOTE'));
  assert.equal(await worker.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),false);
  const privateKey=await worker.evaluate(async()=>{const data=await LedgerVaultIDB().get('browser-unlock');let rejected=false;try{await crypto.subtle.exportKey('pkcs8',data.key);}catch{rejected=true;}return {extractable:data.key.extractable,rejected};});
  assert.deepEqual(privateKey,{extractable:false,rejected:true});
  await context.close();await launch();await page.locator('#trend-totals .card').first().waitFor();
  assert.equal(await page.locator('#vault-entry').count(),0,'Restart opens without a helper or password');
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],'AUTOMATIC PRIVATE NOTE');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.session.get('ledgerVaultSession:v1'))['ledgerVaultSession:v1']),undefined,'Automatic access needs no serialized session key');
  const denied=await request({type:'vault:browserUnlock',enabled:false,secret:'wrong'}).catch(e=>({error:e.message}));assert.match(denied.error,/Could not unlock/);
  assert.equal((await request({type:'vault:status'})).browserUnlock,true);
  await dataSettings();await page.screenshot({path:path.join(images,'03-access-settings.png'),fullPage:true});
  for(const width of [430,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings width '+width);}
  await page.getByRole('button',{name:'Require a passphrase after restart',exact:true}).click();await credential(password);
  await page.getByRole('button',{name:'Open automatically in this browser',exact:true}).waitFor();
  assert.equal(await worker.evaluate(()=>LedgerVaultIDB().get('browser-unlock')),undefined);
  await context.close();await launch();await page.getByRole('heading',{name:'Unlock your Ledger'}).waitFor();
  await page.locator('#vault-secret').fill(password);await page.locator('#vault-submit').click();await dataSettings();
  await page.getByRole('button',{name:'Open automatically in this browser',exact:true}).click();
  await page.locator('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await request({type:'vault:status'})).browserUnlock,false);
  await page.getByRole('button',{name:'Open automatically in this browser',exact:true}).click();
  await page.locator('dialog').getByRole('button',{name:'Enable automatic access',exact:true}).click();
  await page.getByRole('button',{name:'Require a passphrase after restart',exact:true}).waitFor();
  // Key loss must preserve records and permit the independent recovery key.
  await worker.evaluate(()=>LedgerVaultIDB().commit({},['browser-unlock']));await context.close();await launch();
  await page.getByText(/Automatic access is unavailable/).waitFor();
  await page.locator('#vault-recovery').check();await page.locator('#vault-secret').fill(recovery);await page.locator('#vault-submit').click();
  await page.locator('#vault-entry').waitFor({state:'detached'});assert.equal((await request({type:'vault:status'})).browserUnlock,true);
  const opened=await request({type:'vault:openBackup',backup,secret:password});assert.equal(opened.format,'youtube-ledger-backup');
  assert.equal((await page.evaluate(()=>LedgerBrowser.storage.local.get('goals:2026-10-03')))['goals:2026-10-03'],'AUTOMATIC PRIVATE NOTE');
  assert.deepEqual(errors,[]);
  console.log('PASS: browser-only automatic access, explicit consent, full restart, non-extractable IDB key, no native permission, private backup, manual fallback, recovery, confirmed disabling and 320px settings.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
