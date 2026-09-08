const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('./core.js');require('./group-icons.js');require('./channel-groups.js');require('./group-feeds.js');require('./backup.js');
const A='UC'+'a'.repeat(22),V='a'.repeat(11),W='b'.repeat(11),X='c'.repeat(11);
const player=(id=V,length='379',extra={})=>({videoDetails:{videoId:id,channelId:A,lengthSeconds:length,...extra}});
const html=value=>'<!doctype html><script>var ytInitialPlayerResponse = '+JSON.stringify(value)+';</script>';
test('video duration formatting and identity checks distinguish live, upcoming and archived streams',()=>{
 assert.equal(Ledger.videoLength(379),'6:19');assert.equal(Ledger.videoLength(3600),'1:00:00');assert.equal(Ledger.videoLength(3661),'1:01:01');assert.equal(Ledger.videoLength(.9),'0:01');for(const value of [0,-1,Infinity,NaN,'60',604801])assert.equal(Ledger.videoLength(value),'');
 assert.deepEqual(GroupFeeds.parseVideoDetails(player(),V,A,1),{status:'available',duration:379,checkedAt:1,shorts:'unknown'});
 assert.equal(GroupFeeds.parseVideoDetails(player(V,'123',{isLiveContent:true}),V,A).status,'available','Archived streams retain their duration');
 assert.equal(GroupFeeds.parseVideoDetails(player(V,'123',{isLive:true}),V,A).status,'live');
 const live=player();live.microformat={playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:true}}};assert.equal(GroupFeeds.parseVideoDetails(live,V,A).status,'live');
 assert.equal(GroupFeeds.parseVideoDetails(player(V,'0',{isUpcoming:true}),V,A).status,'upcoming');
 for(const value of ['0','NaN','1.5','-2','604801',undefined])assert.equal(GroupFeeds.parseVideoDetails(player(V,value,{lengthSeconds:value}),V,A).status,'unavailable');
 assert.throws(()=>GroupFeeds.parseVideoDetails(player(W),V,A));assert.throws(()=>GroupFeeds.parseVideoDetails(player(),V,'UC'+'b'.repeat(22)));assert.throws(()=>GroupFeeds.parseVideoDetails({},V,A));
 assert.equal(Ledger.videoDetailsDue({status:'live',checkedAt:1},60001),true);assert.equal(Ledger.videoDetailsDue({status:'available',duration:10,checkedAt:1},60001),false);assert.equal(Ledger.videoDetailsDue({status:'unavailable',checkedAt:1},60001),false);assert.equal(Ledger.videoDetailsDue({status:'live',checkedAt:100},99),true);
});
test('streaming reads stop at the verified player JSON without consuming recommendations or page assets',async()=>{
 const source=html(player())+'<div>Recommendations with other lengths</div>',encoder=new TextEncoder();let cancelled=false,read=0;
 const chunks=[source.slice(0,31),source.slice(31), 'unused tail'];
 const response={body:{getReader:()=>({read:async()=>({done:false,value:encoder.encode(chunks[read++])}),cancel:async()=>{cancelled=true;}})}};
 const actual=await GroupFeeds.readPlayer(response);assert.equal(actual.videoDetails.lengthSeconds,'379');assert.equal(read,2);assert.equal(cancelled,true);
});
test('view counts are verified against video and channel identity and accept only exact nonnegative integers',()=>{
 for(const count of ['0','1234567'])assert.equal(GroupFeeds.parseVideoDetails(player(V,'379',{viewCount:count}),V,A,100).viewCount,Number(count));
 for(const viewCount of ['-1','12.5','1,234','123K','999999999999999999999',undefined])assert.equal(GroupFeeds.parseVideoDetails(player(V,'379',{viewCount}),V,A,100).viewCount,undefined);
 assert.throws(()=>GroupFeeds.parseVideoDetails(player(W,'379',{viewCount:'100'}),V,A));
});
function setup(){
 const entries=[V,W,X].map(videoId=>({videoId,channelId:A,channel:'Alpha',title:'Episode',publishedAt:1000}));
 const data={'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:1,updatedAt:1}],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A}}},'channelUploads:v1':{version:1,channels:{[A]:{entries,viewsAttemptedAt:Date.now()}}},'videoProgress:v1':{version:1,videos:{[V]:{observed:true,segments:[[0,3]],duration:100}}}};
 let active=0,peak=0;const requests=[],gates=[];
 const box={Ledger,ChannelGroups,URL,Date,Map,Set,Promise,structuredClone,AbortSignal,TextDecoder,fetch:async(url,options)=>{
  requests.push({url,options});active++;peak=Math.max(peak,active);await new Promise(resolve=>gates.push(resolve));active--;
  const id=new URL(url).searchParams.get('v');return {ok:true,url,text:async()=>id===X?'<html>Sign in</html>':html(player(id,id===W?'3661':'379'))};
 },browser:{storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),set:async values=>Object.assign(data,structuredClone(values))}}}};
 vm.runInNewContext(fs.readFileSync('group-feeds.js','utf8'),box);
 return {box,data,requests,gates,get peak(){return peak;},release(){for(const done of gates.splice(0))done();}};
}
const turn=()=>new Promise(r=>setImmediate(r));
test('a failed Shorts classification upgrade preserves a fresh cached duration and retries with a cooldown',async()=>{
 const s=setup(),group=s.data['channelGroups:v1'].groups[0],entry=s.data['channelUploads:v1'].channels[A].entries[2];
 group.hideShorts=true;entry.details={status:'available',duration:20,checkedAt:Date.now()};
 const message={type:'groupFeed:details',groupId:'podcasts',videoIds:[X]},sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'};
 const pending=s.box.GroupFeeds.handle(message,sender);await turn();assert.equal(s.requests.length,1);s.release();await pending;
 let details=s.data['channelUploads:v1'].channels[A].entries[2].details;assert.equal(details.duration,20);assert.equal(details.shorts,'unknown');
 await s.box.GroupFeeds.handle(message,sender);assert.equal(s.requests.length,1);
 details.shorts=true;details.checkedAt=Date.now()-8*86400000;
 const retry=s.box.GroupFeeds.handle(message,sender);await turn();s.release();await retry;
 assert.equal(s.data['channelUploads:v1'].channels[A].entries[2].details.shorts,true,'Known Shorts remain classified after a failed refresh');
});
test('visible-video requests share four bounded workers, preserve RSS details and backups, and never change watch state',async()=>{
 const s=setup(),before=structuredClone(s.data['videoProgress:v1']),sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'},message={type:'groupFeed:details',groupId:'podcasts',videoIds:[V,W,X]};
 const tasks=[s.box.GroupFeeds.handle(message,sender),s.box.GroupFeeds.handle(message,sender)];await turn();assert.equal(s.requests.length,3);s.release();await turn();s.release();await Promise.all(tasks);
 assert.equal(s.requests.length,3);assert.equal(s.peak,3);assert.ok(s.requests.every(r=>r.options.credentials==='omit'));
 const entries=s.data['channelUploads:v1'].channels[A].entries;assert.deepEqual(entries.map(e=>e.details.status),['available','available','unavailable']);assert.deepEqual(s.data['videoProgress:v1'],before);
 const merged=GroupFeeds.merge(s.data['channelUploads:v1'],A,[{...entries[0],details:undefined,title:'Renamed by creator'}],Date.now());assert.equal(merged.channels[A].entries[0].details.duration,379);
 await s.box.GroupFeeds.handle(message,sender);assert.equal(s.requests.length,3,'Cache avoids repeat lookups, including failures');
 const backup={format:'youtube-ledger-backup',schemaVersion:1,data:s.data};assert.deepEqual(LedgerBackup.validate(backup),s.data);
 for(const bad of [{status:'available',duration:0,checkedAt:1},{status:'available',duration:Infinity,checkedAt:1},{status:'live',duration:10,checkedAt:1},{status:'available',duration:379,checkedAt:-1}]){const copy=structuredClone(backup);copy.data['channelUploads:v1'].channels[A].entries[0].details=bad;assert.throws(()=>LedgerBackup.validate(copy));}
 await assert.rejects(s.box.GroupFeeds.handle({...message,videoIds:['z'.repeat(11)]},sender),/no longer/);await assert.rejects(s.box.GroupFeeds.handle(message,{tab:{id:2,incognito:true},url:sender.url}),/cannot/);assert.equal(s.requests.length,3);
});
test('profile restore and channel removal prevent in-flight metadata from restoring discarded cache entries',async()=>{
 for(const action of ['restore','remove']){
  const s=setup(),request=s.box.GroupFeeds.handle({type:'groupFeed:details',groupId:'podcasts',videoIds:[V]},{tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'});await turn();
  if(action==='restore'){s.box.GroupFeeds.invalidate();s.data['channelUploads:v1']={version:1,channels:{}};}
  else s.data['channelGroups:v1'].groups=[];
  s.release();await request;assert.equal(Object.keys(s.data['channelUploads:v1'].channels).length,0);
 }
});
test('view sorting upgrades cached durations, uses an hourly cooldown, and preserves older counts on a failed refresh',async()=>{
 const s=setup(),entry=s.data['channelUploads:v1'].channels[A].entries[0],sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'},message={type:'groupFeed:details',groupId:'podcasts',videoIds:[V]};
 s.data['channelGroups:v1'].groups[0].sort='views-desc';entry.details={status:'available',duration:379,shorts:false,checkedAt:Date.now()};let requests=0;
 s.box.fetch=async url=>{requests++;return {ok:true,url,text:async()=>html(player(V,'379',{viewCount:'12345'}))};};
 const result=await s.box.GroupFeeds.handle(message,sender);assert.equal(requests,1);assert.equal(result.views[V].count,12345);
 await s.box.GroupFeeds.handle(message,sender);assert.equal(requests,1);
 const current=s.data['channelUploads:v1'].channels[A].entries[0];current.views.checkedAt=Date.now()-3600001;current.details.viewsAttemptedAt=Date.now()-3600001;
 s.box.fetch=async url=>{requests++;return {ok:false,url};};
 await s.box.GroupFeeds.handle(message,sender);assert.equal(requests,2);
 const after=s.data['channelUploads:v1'].channels[A].entries[0];assert.equal(after.views.count,12345);assert.equal(after.details.duration,379);assert.equal(Ledger.videoViewsDue(after),false);
 await s.box.GroupFeeds.handle(message,sender);assert.equal(requests,2,'Unavailable counts do not cause a retry loop');
});

test('legacy caches recover fifteen view counts with one shared RSS request instead of individual watch pages',async()=>{
 const s=setup(),now=Date.now(),xml=fs.readFileSync('tests/fixtures/youtube-uploads.xml','utf8').replaceAll('UCvryaJCRHcTVjOC_DcuYxGg',A).replaceAll('vryaJCRHcTVjOC_DcuYxGg',A.slice(2));
 const entries=GroupFeeds.parse(xml,A,now).map(({views,...entry})=>({...entry,details:{status:'available',duration:300,shorts:false,checkedAt:now}}));
 s.data['channelUploads:v1'].channels[A]={entries,fetchedAt:now,attemptedAt:now};s.data['channelGroups:v1'].groups[0].sort='rate-desc';
 const urls=[];s.box.fetch=async url=>{urls.push(url);assert.ok(url.includes('/feeds/videos.xml?'));return {ok:true,url,text:async()=>xml};};
 const message={type:'groupFeed:details',groupId:'podcasts',videoIds:entries.slice(0,12).map(e=>e.videoId)},sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'};
 const [result]=await Promise.all([s.box.GroupFeeds.handle(message,sender),s.box.GroupFeeds.handle(message,sender)]);
 assert.equal(urls.length,1);assert.equal(Object.keys(result.views).length,12);
 const cached=s.data['channelUploads:v1'].channels[A];assert.equal(cached.entries.filter(e=>Ledger.validVideoViews(e.views)).length,15);assert.ok(cached.viewsAttemptedAt>=now);
 await s.box.GroupFeeds.handle(message,sender);assert.equal(urls.length,1);
 assert.deepEqual(LedgerBackup.validate({format:'youtube-ledger-backup',schemaVersion:1,data:s.data}),s.data);
});
test('parallel metadata work stays limited to four downloads across callers',async()=>{
 const s=setup(),entries=Array.from({length:8},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:A,channel:'Alpha',title:'Episode',publishedAt:1000}));
 s.data['channelUploads:v1'].channels[A].entries=entries;
 const message={type:'groupFeed:details',groupId:'podcasts',videoIds:entries.map(e=>e.videoId)},sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'};
 const pending=[s.box.GroupFeeds.handle(message,sender),s.box.GroupFeeds.handle(message,sender)];await turn();assert.equal(s.requests.length,4);
 s.release();await turn();assert.equal(s.requests.length,8);s.release();await Promise.all(pending);
 assert.equal(s.peak,4);assert.equal(s.requests.length,8);
});

test('visible Shorts checks promote queued work ahead of background counts without duplicating downloads',async()=>{
 const s=setup(),entries=Array.from({length:9},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:A,channel:'Alpha',title:'Episode',publishedAt:1000}));
 s.data['channelUploads:v1'].channels[A].entries=entries;s.data['channelGroups:v1'].groups[0].hideShorts=true;
 const sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'},request=videoIds=>({type:'groupFeed:details',groupId:'podcasts',videoIds});
 const normal=s.box.GroupFeeds.handle(request(entries.slice(0,8).map(e=>e.videoId)),sender);await turn();assert.equal(s.requests.length,4);
 const urgent=s.box.GroupFeeds.handle({...request(entries.slice(7).map(e=>e.videoId)),shortsFirst:true},sender);await turn();
 s.release();await turn();assert.deepEqual(s.requests.slice(4,6).map(r=>new URL(r.url).searchParams.get('v')),entries.slice(7).map(e=>e.videoId));
 s.release();await turn();s.release();await Promise.all([normal,urgent]);assert.equal(s.peak,4);assert.equal(s.requests.length,9);
});
