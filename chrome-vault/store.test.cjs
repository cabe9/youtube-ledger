const {test,before}=require('node:test'),assert=require('node:assert/strict');
require('./crypto.js');require('./store.js');
const password='quiet river lantern orchard 739',nextPassword='cobalt meadow autumn lantern 825';
function memory(initial={}){
 let data=structuredClone(initial),fail=false;
 return {get:async key=>key==null?structuredClone(data):typeof key==='string'?structuredClone(data[key]):Object.fromEntries(key.filter(k=>Object.hasOwn(data,k)).map(k=>[k,structuredClone(data[k])])),
  entries:async()=>Object.entries(structuredClone(data)),
  commit:async(values,removed=[])=>{if(fail){fail=false;throw Error('Disk full');}const next=structuredClone(data);for(const key of removed)delete next[key];Object.assign(next,structuredClone(values));data=next;},
  fail:()=>{fail=true;},raw:()=>structuredClone(data)};
}
function storage(initial={}){
 const io=memory(initial);let failClear=false;
 return {...io,get:async keys=>{const data=io.raw();return keys==null?data:Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));},
  set:values=>io.commit(values),remove:keys=>io.commit({},typeof keys==='string'?[keys]:keys),
  clear:async()=>{if(failClear){failClear=false;throw Error('Interrupted cleanup');}await io.commit({},Object.keys(io.raw()));},failClear:()=>{failClear=true;}};
}
const privateData={paused:false,recordingEpoch:'12345678-1234-1234-1234-123456789abc','setup:v1':{version:1,complete:true},
 'day:2026-10-03':[{title:'A PRIVATE TITLE',videoId:'abcdefghijk'}], 'goals:2026-10-03':'VERY PRIVATE NOTES',
 'channelGroups:v1':{groups:[{name:'MY PRIVATE GROUP'}]},'localSync:v1':{secret:'PRIVATE PAIRING SECRET'},settings:{theme:'retrowave'}};
let baseline,recoveryKey;
before(async()=>{
 const io=memory(),session=storage(),legacy=storage(privateData),vault=LedgerChromeStore(io,session,legacy);
 recoveryKey=(await vault.create(password)).recoveryKey;baseline=io.raw();
 assert.deepEqual(legacy.raw(),{});assert.deepEqual(await vault.get(null),privateData);
});
async function fresh({data=baseline,session=storage(),legacy=storage(),limit}={}){
 const io=memory(data),vault=LedgerChromeStore(io,session,legacy,{...(limit?{inboxLimit:limit}:{})});await vault.init();return {io,vault,session,legacy};
}
test('all profile fields and key names are encrypted; browser restart locks; recovery unlocks',async()=>{
 const raw=JSON.stringify(baseline);
 for(const text of [password,recoveryKey,...Object.keys(privateData),'A PRIVATE TITLE','VERY PRIVATE NOTES','PRIVATE PAIRING SECRET','MY PRIVATE GROUP']){
  if(['paused','recordingEpoch','setup:v1'].includes(text))continue;
  assert.ok(!raw.includes(text),text+' must not be in persisted ciphertext');
 }
 const {vault}=await fresh();assert.equal((await vault.status()).unlocked,false);
 await assert.rejects(vault.unlock('not the password'),/Could not unlock/);
 await vault.unlock(recoveryKey,true);assert.deepEqual(await vault.get(null),privateData);
});
test('session unlock survives a worker restart without persisting its secret',async()=>{
 const {io,vault,session,legacy}=await fresh();await vault.unlock(password);
 const other=LedgerChromeStore(io,session,legacy);await other.init();assert.equal((await other.status()).unlocked,true);
 assert.deepEqual(await other.get('settings'),{settings:privateData.settings});
 assert.ok(!JSON.stringify(io.raw()).includes(session.raw()['ledgerVaultSession:v1'].key));
});
test('remembered unlock resumes only its own vault and forgetting survives restart',async()=>{
 const {io,vault,session}=await fresh();await vault.unlock(password);
 const key=session.raw()['ledgerVaultSession:v1'].key;
 io.fail();await assert.rejects(vault.setDevice(crypto.randomUUID()),/Disk full/);
 assert.equal((await vault.status()).remembered,false);
 const device=crypto.randomUUID();await vault.setDevice(device);
 const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
 assert.equal((await restarted.status()).unlocked,false);assert.equal((await restarted.status()).remembered,true);
 await assert.rejects(restarted.resumeDevice('invalid'));
 await restarted.resumeDevice(key);assert.deepEqual(await restarted.get(null),privateData);
 const exported=await restarted.sealBackup({test:true});assert.ok(!JSON.stringify(exported).includes(device));
 assert.ok(!JSON.stringify(io.raw()).includes(key));
 await restarted.setDevice(null);
 const forgotten=LedgerChromeStore(io,storage(),storage());await forgotten.init();
 assert.equal((await forgotten.status()).remembered,false);
 await assert.rejects(forgotten.resumeDevice(key),/not enabled/);
 await forgotten.unlock(password);assert.deepEqual(await forgotten.get(null),privateData);
});
test('a damaged session key falls back to independent credentials without losing history',async()=>{
 const session=storage({'ledgerVaultSession:v1':{id:baseline.meta.config.id,key:'broken'}});
 const {io,vault}=await fresh({session});
 assert.equal((await vault.status()).unlocked,false);
 assert.match((await vault.status()).sessionUnlockError,/This session could not reopen/);
 assert.equal(session.raw()['ledgerVaultSession:v1'],undefined);
 assert.deepEqual(io.raw(),baseline);
 await vault.unlock(recoveryKey,true);
 assert.deepEqual(await vault.get(null),privateData);
 assert.equal((await vault.status()).sessionUnlockError,'');
});
test('browser automatic access survives a full restart, uses a non-extractable key and never travels in backups',async()=>{
 const {io,vault}=await fresh();await vault.unlock(password);
 assert.equal((await vault.status()).browserUnlock,false,'Old profiles remain passphrase-only');
 io.fail();await assert.rejects(vault.setBrowserUnlock(true),/Disk full/);
 assert.equal((await vault.status()).browserUnlock,false);assert.equal(io.raw()['browser-unlock'],undefined);
 await vault.setBrowserUnlock(true);
 const key=io.raw()['browser-unlock'].key;
 assert.equal(key.extractable,false);await assert.rejects(crypto.subtle.exportKey('pkcs8',key));
 const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
 assert.equal((await restarted.status()).unlocked,true);assert.deepEqual(await restarted.get(null),privateData);
 const backup=await restarted.sealBackup({note:'AUTOMATIC BACKUP'});
 assert.ok(!JSON.stringify(backup).includes('browser-unlock'));
 const locked=await fresh();await assert.rejects(locked.vault.openBackup(backup,'wrong secret'));
 assert.deepEqual(await locked.vault.openBackup(backup,password),{note:'AUTOMATIC BACKUP'});
 await assert.rejects(restarted.confirmSecret('wrong secret'));
 await restarted.confirmSecret(recoveryKey,true);
 io.fail();await assert.rejects(restarted.setBrowserUnlock(false),/Disk full/);
 assert.equal((await restarted.status()).browserUnlock,true);
 await restarted.setBrowserUnlock(false);assert.equal(io.raw()['browser-unlock'],undefined);
 const forgotten=LedgerChromeStore(io,storage(),storage());await forgotten.init();
 assert.equal((await forgotten.status()).unlocked,false);await forgotten.unlock(password);
 assert.deepEqual(await forgotten.get(null),privateData);
});
test('missing or mismatched browser keys fall back to manual unlock without replacing data',async()=>{
 for(const mismatch of [false,true]){
  const {io,vault}=await fresh();await vault.unlock(password);await vault.setBrowserUnlock(true);
  if(mismatch){const other=await LedgerChromeCrypto.create(nextPassword);await io.commit({'browser-unlock':{id:baseline.meta.config.id,key:await LedgerChromeCrypto.unlock(other.config,nextPassword)}});}
  else await io.commit({},['browser-unlock']);
  const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
  assert.equal((await restarted.status()).unlocked,false);assert.match((await restarted.status()).browserUnlockError,/Automatic access is unavailable/);
  await restarted.unlock(password);assert.deepEqual(await restarted.get(null),privateData);
  await restarted.setBrowserUnlock(true);
  const repaired=LedgerChromeStore(io,storage(),storage());await repaired.init();assert.equal((await repaired.status()).unlocked,true);
 }
});
test('locked callers cannot enable browser access and old password changes retain access choices',async()=>{
 const {io,vault}=await fresh();await assert.rejects(vault.setBrowserUnlock(true),/Unlock Ledger/);
 await vault.unlock(password);await vault.setBrowserUnlock(true);await vault.changePassword(password,nextPassword);
 const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
 assert.equal((await restarted.status()).unlocked,true);await restarted.confirmSecret(nextPassword);
 await assert.rejects(restarted.confirmSecret(password));assert.deepEqual(await restarted.get(null),privateData);
});
test('multi-key updates, removal and default reads are atomic on quota errors',async()=>{
 const {io,vault}=await fresh();await vault.unlock(password);io.fail();
 await assert.rejects(vault.mutate({'goals:2026-10-03':'REPLACEMENT',newKey:{secret:'SECOND'}}),/Disk full/);
 assert.deepEqual(await vault.get(null),privateData);
 await vault.mutate({'goals:2026-10-03':'REPLACEMENT',newKey:{secret:'SECOND'}},['settings']);
 assert.deepEqual(await vault.get({settings:{theme:'classic'},newKey:null}),{settings:{theme:'classic'},newKey:{secret:'SECOND'}});
 assert.ok(!JSON.stringify(io.raw()).includes('REPLACEMENT'));
});
test('concurrent writes serialize and a deleted private record cannot return after restart',async()=>{
 const {io,vault,session,legacy}=await fresh();await vault.unlock(password);
 await Promise.all(Array.from({length:8},(_,n)=>vault.mutate({['goals:day'+n]:'private note '+n})));
 await vault.mutate({},['day:2026-10-03','goals:2026-10-03']);
 const resumed=LedgerChromeStore(io,session,legacy);await resumed.init();
 const values=await resumed.get(null);assert.equal(values['day:2026-10-03'],undefined);
 assert.equal(Object.keys(values).filter(k=>k.startsWith('goals:day')).length,8);
});
test('migration resumes after cleanup failure without losing the committed encrypted records',async()=>{
 const io=memory(),session=storage(),legacy=storage(privateData),vault=LedgerChromeStore(io,session,legacy);
 legacy.failClear();await assert.rejects(vault.create(password),/Interrupted cleanup/);
 assert.deepEqual(legacy.raw(),privateData);assert.equal(io.raw().meta.migrationPending,true);
 const resumed=LedgerChromeStore(io,storage(),legacy);await resumed.init();await resumed.unlock(password);
 assert.deepEqual(legacy.raw(),{});assert.deepEqual(await resumed.get(null),privateData);assert.equal((await resumed.status()).migrationPending,false);
});
test('failed migration commit leaves every legacy field intact',async()=>{
 const io=memory(),session=storage(),legacy=storage(privateData),vault=LedgerChromeStore(io,session,legacy);io.fail();
 await assert.rejects(vault.create(password),/Disk full/);assert.deepEqual(legacy.raw(),privateData);assert.deepEqual(io.raw(),{});
});
test('new profiles get a persistent recording generation shared by locked and unlocked capture',async()=>{
 const io=memory(),session=storage(),vault=LedgerChromeStore(io,session,storage());
 await vault.create(password);await vault.mutate({paused:false,'setup:v1':{version:1,complete:true}});
 const control=await vault.controls(),stored=await vault.get('recordingEpoch');
 assert.match(control.recordingEpoch,/^[\w-]{36}$/);assert.equal(control.recordingEpoch,stored.recordingEpoch);
 const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();assert.deepEqual(await restarted.controls(),control);
});
test('locked inbox receipts commit with ciphertext, survive restart and enforce quota without acking failures',async()=>{
 const {io,vault}=await fresh();
 const message={type:'events',epoch:privateData.recordingEpoch,recorderId:'12345678-1234-1234-1234-123456789abd',sequence:1,events:[{title:'LOCKED SECRET'}]};
 io.fail();await assert.rejects(vault.append(message,x=>x),/Disk full/);
 assert.equal((await vault.status()).pendingBatches,0);assert.deepEqual(await vault.append(message,x=>x),{ok:true});
 const restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
 assert.deepEqual(await restarted.append(message,x=>x),{ok:true,duplicate:true});
 assert.equal((await restarted.status()).pendingBatches,1);assert.ok(!JSON.stringify(io.raw()).includes('LOCKED SECRET'));
 const capped=LedgerChromeStore(io,storage(),storage(),{inboxLimit:1});await capped.init();
 await assert.rejects(capped.append({...message,sequence:2},x=>x),/Unlock Ledger/);
 await restarted.unlock(password);const entries=await restarted.entries();assert.deepEqual(entries[0].message,message);
 await restarted.acknowledge(entries[0].name);assert.equal((await restarted.status()).pendingBatches,0);
});
test('paused, unconfigured and obsolete-epoch locked batches do not persist',async()=>{
 const {vault}=await fresh();
 const message={epoch:'obsolete'};assert.equal((await vault.append(message,x=>x)).discarded,true);
 await vault.unlock(password);await vault.mutate({paused:true});
 assert.equal((await vault.append({epoch:privateData.recordingEpoch},x=>x)).discarded,true);
});
test('encrypted backups survive password change; wrong secret and tampering fail',async()=>{
 const {vault,io}=await fresh();await vault.unlock(password);
 const backup=await vault.sealBackup({private:'BACKUP SECRET'});
 assert.ok(!JSON.stringify(backup).includes('BACKUP SECRET'));
 await vault.changePassword(password,nextPassword);
 const locked=LedgerChromeStore(io,storage(),storage());await locked.init();
 await assert.rejects(locked.unlock(password));await locked.unlock(nextPassword);
 assert.deepEqual(await locked.openBackup(backup,password),{private:'BACKUP SECRET'});
 await assert.rejects(locked.openBackup(backup,nextPassword));
 const bad=structuredClone(backup),body=Buffer.from(bad.payload.body,'base64');body[0]^=1;bad.payload.body=body.toString('base64');
 await assert.rejects(locked.openBackup(bad,password));
 await assert.rejects(locked.openBackup({...backup,extra:true},password),/Invalid/);
 const recovered=LedgerChromeStore(io,storage(),storage());await recovered.init();await recovered.unlock(recoveryKey,true);
 assert.deepEqual(await recovered.get('settings'),{settings:privateData.settings});
});
test('tampered or missing records fail closed rather than appearing as empty history',async()=>{
 const {io,vault}=await fresh();await vault.unlock(password);
 const [name,envelope]=Object.entries(io.raw()).find(([key])=>key.startsWith('data:'));
 const bytes=Buffer.from(envelope.body,'base64');bytes[0]^=1;await io.commit({[name]:{...envelope,body:bytes.toString('base64')}});
 await assert.rejects(vault.get(null));
 await io.commit({},[name]);await assert.rejects(vault.get(null),/missing/);
});
test('replacement recovery keys invalidate the old profile key but preserve old backup access',async()=>{
 const {vault,io}=await fresh();await vault.unlock(password);const backup=await vault.sealBackup({note:'RECOVERY BACKUP'});
 await assert.rejects(vault.replaceRecovery('wrong password'));
 const result=await vault.replaceRecovery(password),restarted=LedgerChromeStore(io,storage(),storage());await restarted.init();
 await assert.rejects(restarted.unlock(recoveryKey,true));await restarted.unlock(result.recoveryKey,true);
 assert.deepEqual(await restarted.openBackup(backup,recoveryKey,true),{note:'RECOVERY BACKUP'});
 assert.ok(!JSON.stringify(io.raw()).includes(result.recoveryKey));
});
