const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=v=>JSON.parse(JSON.stringify(v)),V='a'.repeat(11),A='UC'+'a'.repeat(22);
function setup(){
 let data={},failSet=false;const box={console,URL,structuredClone,crypto:require('node:crypto').webcrypto,atob,setTimeout,AbortSignal,fetch};
 const browser={runtime:{getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'0.12.0'})},storage:{local:{get:async keys=>keys===null?clone(data):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,clone(data[k])])),set:async value=>{if(failSet){failSet=false;throw Error('quota');}Object.assign(data,clone(value));},remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete data[k];}},session:{get:async()=>({}),set:async()=>{}}}};box.browser=browser;
 vm.createContext(box);for(const name of ['core','ledger-storage','watch-status','group-icons','channel-groups','backup'])vm.runInContext(fs.readFileSync(__dirname+'/'+name+'.js','utf8'),box);
 return {box,browser,get data(){return data;},set data(v){data=clone(v);},fail(){failSet=true;}};
}
test('relative timestamps cover minutes, hours, days, future and older exact dates',()=>{
 const {Ledger}=setup().box,now=Date.parse('2026-09-06T12:00:00Z');
 assert.match(Ledger.relativeTime(now-60000,now),/1 minute ago/);assert.match(Ledger.relativeTime(now-7200000,now),/2 hours ago/);assert.match(Ledger.relativeTime(now-3*86400000,now),/3 days ago/);assert.match(Ledger.relativeTime(now+3600000,now),/in 1 hour/);assert.equal(Ledger.relativeTime(NaN,now),'');assert.match(Ledger.relativeTime(now-40*86400000,now),/2026/);
});
test('watch status counts unique playback, excludes seeking/ads, respects manual reset and original history migration',async()=>{
 const s=setup(),W=s.box.WatchStatus,p={version:1,videos:{}};
 const event={videoId:V,start:0,end:5000,state:'foreground',position:0,positionEnd:5,duration:10,rate:1};
 W.add(p,event);W.add(p,event);assert.equal(W.state(p.videos[V]),'started');assert.equal(p.videos[V].segments[0][1],5);
 W.add(p,{...event,state:'ad',position:5,positionEnd:10});assert.equal(W.state(p.videos[V]),'started');
 W.add(p,{...event,position:5,positionEnd:9});assert.equal(W.state(p.videos[V]),'watched');
 s.data={[W.key]:p};const sender={tab:{id:1},url:'https://www.youtube.com/watch?v='+V};
 await W.handle({videoId:V,status:'unwatched'},sender);assert.equal(W.state(s.data[W.key].videos[V]),'unwatched');
 const next=s.data[W.key];W.add(next,event);assert.equal(W.state(next.videos[V]),'started');assert.equal(next.videos[V].segments[0][1],5);
 s.data={'day:2026-09-06':[{videoId:V,seconds:{foreground:9000},end:100}]};const migrated=await W.read();assert.equal(W.state(migrated.videos[V]),'started');
});
test('bulk memberships are atomic, reorder preserves IDs, collapse and filters persist',()=>{
 const {ChannelGroups:C}=setup().box;let state=C.change(null,{action:'create',name:'Podcasts'},()=> 'one');state=C.change(state,{action:'create',name:'Music'},()=> 'two');
 state=C.change(state,{action:'bulk',groupIds:['one','two'],channels:[{id:A,name:'Alpha'}]});assert.deepEqual(clone(state.groups.map(g=>g.channelIds)),[[A],[A]]);
 assert.throws(()=>C.change(state,{action:'bulk',groupIds:['one'],channels:[{id:A,name:'Alpha'},{id:'bad',name:'bad'}]}));assert.equal(state.groups[0].channelIds.length,1);
 state=C.change(state,{action:'reorder',ids:['two','one']});state=C.change(state,{action:'collapse',collapsed:true});state=C.change(state,{action:'filter',groupId:'one',filter:'started'});assert.equal(state.groups[0].id,'two');assert.equal(state.collapsed,true);assert.equal(state.groups[1].watchFilter,'started');assert.throws(()=>C.change(state,{action:'reorder',ids:['one','one']}));
});
test('portable backup validates, round-trips all records and rolls back a failed storage write',async()=>{
 const s=setup(),{Ledger,LedgerBackup:B,ChannelGroups:C}=s.box;const rows=[];
 Ledger.add(rows,{id:'visit',videoId:V,title:'A video',channel:'Alpha',url:'https://www.youtube.com/watch?v='+V,start:1000,end:2000,state:'foreground',source:{kind:'group',groupId:'one',groupName:'Podcasts'}});
 s.data={'day:2026-09-06':rows,'goals:2026-09-06':'My notes','purposes:2026-09-06':{['video:'+V]:'Learning'},settings:Ledger.settings({theme:'classic'}),paused:true,'channelGroups:v1':C.change(null,{action:'create',name:'Podcasts',channel:{id:A,name:'Alpha'}},()=> 'one'),other:'kept'};
 const sender={url:'chrome-extension://test/dashboard.html#settings'},backup=await B.handle({type:'backup:export'},sender);assert.equal(backup.data.other,undefined);assert.deepEqual(clone(B.validate(backup)),clone(backup.data));
 const legacy=clone(backup);legacy.extensionVersion='0.13.6';legacy.data.settings.shortMinutes=7;
 assert.deepEqual(clone(B.validate(legacy)),clone(backup.data),'Old threshold is ignored while all active settings and records survive');
 s.data={'day:2026-09-05':[],settings:Ledger.settings(),other:'kept'};await B.handle({type:'backup:restore',backup:legacy},sender);assert.equal(s.data['day:2026-09-05'],undefined);assert.equal(s.data.other,'kept');assert.equal(s.data['goals:2026-09-06'],'My notes');
 const before=clone(s.data);s.fail();const changed=clone(backup);changed.data['goals:2026-09-06']='changed';await assert.rejects(B.handle({type:'backup:restore',backup:changed},sender),/previous Ledger data was restored/);assert.deepEqual(s.data,before);
 const bad=clone(backup);bad.data['day:2026-09-06'][0].url='javascript:alert(1)';assert.throws(()=>B.validate(bad));assert.throws(()=>B.validate({schemaVersion:5,dailyVideos:[]}));
 await assert.rejects(B.handle({type:'backup:restore',backup},{url:'https://www.youtube.com/'}));
});

test('profile transfer preserves latest upload dates even when all cached videos were trimmed',async()=>{
 const s=setup(),B=s.box.LedgerBackup,sender={url:'chrome-extension://test/dashboard.html#settings'};
 s.data={'channelUploads:v1':{version:1,channels:{[A]:{entries:[],latestUploadAt:1000,fetchedAt:10000000000,attemptedAt:10000000000}}}};
 const backup=await B.handle({type:'backup:export'},sender);s.data={};await B.handle({type:'backup:restore',backup},sender);
 assert.equal(s.data['channelUploads:v1'].channels[A].latestUploadAt,1000);
 for(const value of [-1,0,'1000',null]){const bad=clone(backup);bad.data['channelUploads:v1'].channels[A].latestUploadAt=value;assert.throws(()=>B.validate(bad));}
 const old=clone(backup);delete old.data['channelUploads:v1'].channels[A].latestUploadAt;assert.doesNotThrow(()=>B.validate(old));
});
