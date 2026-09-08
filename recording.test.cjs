const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto:crypto}=require('node:crypto');
const clone=structuredClone,V='a'.repeat(11),C='UC'+'a'.repeat(22),recorderId='11111111-1111-4111-8111-111111111111';
const sender={tab:{id:1},url:'https://www.youtube.com/watch?v='+V},dashboard={url:'chrome-extension://test/dashboard.html#settings'};
const sample=(start=1000,id='visit')=>({id,videoId:V,title:'A video',channel:'Alpha',url:sender.url,start,end:start+1000,state:'foreground',position:start/1000-1,positionEnd:start/1000,duration:1000,rate:1});
function setup({quota=100000,chromeOnly=false}={}){
 const data={},sessionData={};let badge='',listener;
 const select=(source,keys)=>keys===null?source:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in source).map(k=>[k,source[k]]));
 const size=source=>Object.entries(source).reduce((n,[k,v])=>n+Buffer.byteLength(k)+Buffer.byteLength(JSON.stringify(v)),0);
 const storage=source=>({get:async keys=>clone(select(source,keys)),set:async value=>{if(source===data&&size({...data,...value})>quota)throw Error('QUOTA_BYTES quota exceeded');Object.assign(source,clone(value));},remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete source[k];},getBytesInUse:async keys=>size(select(source,keys))});
 const api={runtime:{getURL:p=>'chrome-extension://test/'+p,getManifest(){assert.equal(this,api.runtime);return {version:'0.13.1'};},onMessage:{addListener:fn=>listener=fn}},storage:{local:{...storage(data),QUOTA_BYTES:quota},session:storage(sessionData)},action:{onClicked:{addListener:()=>{}},setBadgeText:async ({text})=>badge=text},tabs:{create:async()=>{}}};
 if(chromeOnly)api.runtime.sendMessage=message=>new Promise(resolve=>listener(message,dashboard,resolve));
 const box={console,URL,TextEncoder,structuredClone,crypto,atob,setTimeout,AbortSignal,fetch};box[chromeOnly?'chrome':'browser']=api;vm.createContext(box);
 for(const name of ['compat','core','ledger-storage','watch-status','group-icons','channel-groups','backup','recording'])vm.runInContext(fs.readFileSync(__dirname+'/'+name+'.js','utf8'),box);
 if(chromeOnly)vm.runInContext(fs.readFileSync(__dirname+'/background.js','utf8'),box);
 return {box,data,sessionData,api,size,get badge(){return badge;},ready:()=>box.LedgerStorage.write(async()=>{}),write:(events,sequence=1)=>box.LedgerStorage.write(()=>box.LedgerRecording.events({type:'events',recorderId,sequence,events},sender))};
}
function bufferSetup(send){let time=0,errors=0,recoveries=0,lost=0;const box={crypto,Date};vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/recording-buffer.js','utf8'),box);const buffer=box.RecordingBuffer({send,now:()=>time,id:recorderId,onError:()=>errors++,onRecovery:()=>recoveries++,onLoss:n=>lost=n});return {buffer,advance:()=>time+=5000,get errors(){return errors;},get recoveries(){return recoveries;},get lost(){return lost;}};}
test('a lost reply retries the identical batch without double counting history or watch state',async()=>{
 const s=setup();await s.ready();let calls=0;const messages=[];
 const b=bufferSetup(async m=>{messages.push(clone(m));const reply=await s.write(m.events,m.sequence);if(++calls===1)throw Error('Reply lost after commit');return reply;});
 for(let i=1;i<=5;i++)b.buffer.add(sample(i*1000));await b.buffer.flush();assert.equal(b.errors,1);
 const day=Object.keys(s.data).find(k=>k.startsWith('day:'));assert.equal(s.data[day][0].seconds.foreground,5);
 s.data['videoProgress:v1'].videos[V].manual='unwatched';
 // Recreate the recording handler as after a service-worker restart; receipt is stored in the row.
 vm.runInContext(fs.readFileSync(__dirname+'/recording.js','utf8'),s.box);await s.ready();b.advance();await b.buffer.flush();
 assert.deepEqual(messages[0],messages[1]);assert.equal(s.data[day][0].seconds.foreground,5);assert.equal(s.data['videoProgress:v1'].videos[V].manual,'unwatched');assert.equal(b.recoveries,1);
 for(let i=6;i<=10;i++)b.buffer.add(sample(i*1000));await b.buffer.flush();assert.equal(s.data[day][0].seconds.foreground,10);assert.equal(messages[2].sequence,2);
});
test('bounded retry buffer reports overflow and keeps the oldest unacknowledged samples',async()=>{
 const sent=[];let failed=true;const b=bufferSetup(async m=>{sent.push(clone(m));return {ok:!failed,recordingError:failed?'Full':''};});
 for(let i=0;i<5;i++)b.buffer.add(sample(i*1000));await b.buffer.flush();
 for(let i=5;i<310;i++)b.buffer.add(sample(i*1000));assert.equal(b.lost,10);await b.buffer.flush();assert.equal(sent.length,1,'Backoff applies even while adding samples');
 failed=false;b.advance();await b.buffer.flush(true);await new Promise(r=>setImmediate(r));
 assert.deepEqual(sent[0],sent[1]);assert.equal(sent.slice(1).reduce((n,m)=>n+m.events.length,0),300);assert.ok(sent.every(m=>m.events.length<=100));assert.equal(b.recoveries,0,'A warning remains when some activity was lost');
});
test('quota recovery evicts only upload metadata, preserving history, notes, groups and watch state',async()=>{
 const s=setup({quota:50000});await s.ready();const key=s.box.LedgerStorage.cacheKey;
 s.data[key]={version:1,channels:{[C]:{fetchedAt:100,entries:Array.from({length:100},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:C,channel:'Alpha',title:'x'.repeat(200),publishedAt:i}))}}};
 s.data['goals:2026-09-06']='Keep these notes';s.data['channelGroups:v1']={version:1,groups:[],channels:{}};
 const protectedValues=clone({notes:s.data['goals:2026-09-06'],groups:s.data['channelGroups:v1']});
 s.data.padding='x'.repeat(50000-s.size(s.data)-Buffer.byteLength('padding')-2-100);
 assert.equal((await s.write(Array.from({length:25},(_,i)=>sample(i*1000,'visit-'+i)))).ok,true);
 const day=Object.keys(s.data).find(k=>k.startsWith('day:'));assert.equal(s.data[day].length,25);assert.equal(s.data['goals:2026-09-06'],protectedValues.notes);assert.deepEqual(s.data['channelGroups:v1'],protectedValues.groups);assert.ok(s.data['videoProgress:v1'].videos[V].observed);
 assert.ok(!s.data[key]||s.data[key].channels[C].entries.length<100);if(s.data[key]?.channels[C].entries.length)assert.equal(s.data[key].channels[C].entries[0].publishedAt,99,'Keep newest metadata first');
 assert.ok(s.size(s.data)<=50000);
});
test('cache refresh reserves space for recording and measures UTF-8 bytes',async()=>{
 const s=setup({quota:50000});await s.ready();s.data.notes='x'.repeat(20000);
 const cache={version:1,channels:{[C]:{fetchedAt:1,entries:Array.from({length:100},(_,i)=>({channelId:C,videoId:String(i).padStart(11,'0'),title:'日本語'.repeat(100),publishedAt:i}))}}};
 const limited=await s.box.LedgerStorage.limitCache(cache);await s.api.storage.local.set({[s.box.LedgerStorage.cacheKey]:limited});assert.ok(50000-s.size(s.data)>=12500);assert.equal(limited.channels[C].entries[0].publishedAt,99);
});
test('full storage returns a failure, persists a warning, then accepts a safe retry after freeing space',async()=>{
 const s=setup({quota:30000});await s.ready();const reserve=s.box.LedgerStorage.reserveKey;
 // An already-full profile can have no reserve; session storage still reports failure.
 delete s.data[reserve];s.data.notes='x'.repeat(30000-s.size(s.data)-Buffer.byteLength('notes')-2-20);
 const events=Array.from({length:5},(_,i)=>sample(i*1000));const result=await s.write(events);
 assert.equal(result.ok,false);assert.match(result.recordingError,/ran out of storage/);assert.equal(s.badge,'!');assert.ok(s.data[s.box.LedgerRecording.key]||s.sessionData[s.box.LedgerRecording.key]);assert.equal(Object.keys(s.data).some(k=>k.startsWith('day:')),false);
 delete s.data.notes;assert.equal((await s.write(events)).ok,true);assert.equal((await s.write(events)).ok,true);
 const day=Object.keys(s.data).find(k=>k.startsWith('day:'));assert.equal(s.data[day][0].seconds.foreground,5);assert.equal(s.badge,'!','Recovery does not silently dismiss a warning about possibly missing activity');
 assert.equal((await s.box.LedgerRecording.handle({type:'recording:dismiss'},sender)).ok,false);
 await s.box.LedgerRecording.handle({type:'recording:dismiss'},dashboard);assert.equal(s.badge,'');assert.equal(s.sessionData[s.box.LedgerRecording.key],undefined);
});
test('receipt commits are atomic across midnight and private or unrelated pages cannot record',async()=>{
 const s=setup();await s.ready();const start=+new Date(2026,8,5,23,59,59),event={...sample(start),end:start+2000};
 await s.write([event]);await s.write([event]);assert.equal(s.data['day:2026-09-05'][0].seconds.foreground,1);assert.equal(s.data['day:2026-09-06'][0].seconds.foreground,1);
 assert.deepEqual(s.data['day:2026-09-05'][0].playbackIntervals,[[start,start+1000]]);assert.deepEqual(s.data['day:2026-09-06'][0].playbackIntervals,[[start+1000,start+2000]]);
 for(const from of [{...sender,tab:{id:1,incognito:true}},{...sender,url:'https://example.com/'},dashboard])assert.equal((await s.box.LedgerRecording.events({events:[sample()]},from)).ok,false);
 const backup=s.box.LedgerBackup.wrap(s.data);assert.doesNotThrow(()=>s.box.LedgerBackup.validate(backup));
 for(const intervals of [[[start-1,start+1000]],[[start,start+1001]],[[start,start+700],[start+600,start+900]]]){const bad=clone(backup);bad.data['day:2026-09-05'][0].playbackIntervals=intervals;assert.throws(()=>s.box.LedgerBackup.validate(bad));}
});
test('Chrome-only compatibility supports backup export, pre-restore backup and restore RPC',async()=>{
 const s=setup({chromeOnly:true});await s.ready();s.data.settings=s.box.Ledger.settings({theme:'classic'});
 const backup=await s.box.browser.runtime.sendMessage({type:'backup:export'});assert.equal(backup.extensionVersion,'0.13.1');
 const restored=clone(backup);restored.data.settings.theme='retrowave';
 const recovery=await s.box.browser.runtime.sendMessage({type:'backup:export'});assert.equal(recovery.data.settings.theme,'classic');
 assert.equal((await s.box.browser.runtime.sendMessage({type:'backup:restore',backup:restored})).ok,true);assert.equal(s.data.settings.theme,'retrowave');
});
