// Exercise a near-quota legacy migration without reading any real profile.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-vault-large-')),extension=process.env.LEDGER_EXTENSION_DIR ? path.resolve(process.env.LEDGER_EXTENSION_DIR) : path.resolve(__dirname,'../dist/chrome-preview/0.18.0');let context;
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 try{
  context=await launch();let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const result=await worker.evaluate(async()=>{
   const data={};for(let n=1;n<=10;n++)data['goals:2026-09-'+String(n).padStart(2,'0')]='SYNTHETIC PRIVATE NOTE '+n+' '+'.'.repeat(900000);
   await chrome.storage.local.set(data);const originalBytes=await chrome.storage.local.getBytesInUse(null),start=performance.now();
   await LedgerChromeVaultStore.create('Synthetic large-profile test only 925');await LedgerData.ready();
   const actual=await LedgerBrowser.storage.local.get(Object.keys(data));
   if(JSON.stringify(actual)!==JSON.stringify(data))throw Error('Migration changed notes.');
   const backup=await LedgerChromeVaultStore.sealBackup(LedgerBackup.wrap(actual));
   const restored=await LedgerChromeVaultStore.openBackup(backup);
   if(JSON.stringify(restored.data)!==JSON.stringify(data))throw Error('Large backup changed notes.');
   if(JSON.stringify(await LedgerVaultIDB().entries()).includes('SYNTHETIC PRIVATE NOTE'))throw Error('Plaintext in encrypted database.');
   if(Object.keys(await chrome.storage.local.get(null)).length)throw Error('Legacy records were not removed.');
   return {originalBytes,encryptedBytes:await LedgerChromeVaultStore.bytes(),elapsedMs:Math.round(performance.now()-start)};
  });
  assert.ok(result.originalBytes>9000000);await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(async()=>(await LedgerChromeVaultStore.status()).unlocked),false);
  await worker.evaluate(async()=>{await LedgerChromeVaultStore.unlock('Synthetic large-profile test only 925');const data=await LedgerBrowser.storage.local.get(null);for(let n=1;n<=10;n++){const value=data['goals:2026-09-'+String(n).padStart(2,'0')];if(value!=='SYNTHETIC PRIVATE NOTE '+n+' '+'.'.repeat(900000))throw Error('Restart changed a large note.');}});
  console.log('PASS: near-quota legacy profile migrates, decrypts, exports, restores and survives a full browser restart.',JSON.stringify(result));
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
