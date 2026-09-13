const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V='aaaaaaaaaaa',W='bbbbbbbbbbb',X='ccccccccccc',T=Date.now()-10000,clone=structuredClone;
function setup(){
 let data={},writes=0,fail=false;const tabs=[],box={URL,structuredClone,console,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,atob};
 box.browser={runtime:{getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'0.16.33'})},tabs:{create:async v=>tabs.push(v)},storage:{local:{get:async keys=>clone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async values=>{if(fail)throw Error('quota');writes++;Object.assign(data,clone(values));},remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}},session:{get:async()=>({}),set:async()=>{}}}};
 vm.createContext(box);for(const name of ['core','ledger-storage','watch-status','watch-evidence','group-icons','channel-groups','feed-library','backup'])vm.runInContext(fs.readFileSync(name+'.js','utf8'),box);
 return {box,tabs,get data(){return data;},set data(v){data=clone(v);},get writes(){return writes;},fail(){fail=true;}};
}
const youtube={url:'https://www.youtube.com/feed/subscriptions',tab:{id:1}},dashboard={url:'chrome-extension://test/dashboard.html#settings'};
test('YouTube progress, sightings, local playback and manual choices retain distinct meanings',()=>{
 const {WatchStatus:S}=setup().box;
 const value=(local={},evidence)=>S.entry({videos:{[V]:local},evidence:{[V]:evidence}},V);
 assert.equal(S.state(value()),'unwatched');assert.equal(S.state(value({}, {seenAt:T,source:'history-file'})),'seen');
 assert.equal(S.state(value({}, {percent:89.9})),'started');assert.equal(S.state(value({}, {percent:90})),'watched');
 assert.equal(S.fraction(value({}, {percent:100})),0);assert.equal(S.resume(value({}, {percent:50})),0);
 assert.equal(S.state(value({observed:true},{seenAt:T})),'started');
 assert.equal(S.state(value({manual:'unwatched'},{percent:100})),'unwatched');assert.equal(S.state(value({externalIgnored:true},{percent:100})),'unwatched');
 assert.equal(S.state(value({externalIgnored:true,observed:true},{percent:100})),'started');assert.equal(S.state(value({manual:'watched'})),'watched');
 assert.match(S.description(value({}, {percent:94})),/YouTube showed 94%/);assert.match(S.description(value({}, {seenAt:T})),/Completion.*unknown/);
});
test('natural completion requires 80% unique coverage and played ending; seeks, ads and replays do not fake coverage',()=>{
 const {WatchStatus:S}=setup().box,p={version:1,videos:{}};
 const add=(a,b,finished=false,extra={})=>S.add(p,{videoId:V,start:T+a*1000,end:T+b*1000,state:'foreground',position:a,positionEnd:b,duration:100,rate:1,finished,...extra});
 add(0,75);add(95,100,true);assert.equal(S.state(p.videos[V]),'watched');assert.equal(S.fraction(p.videos[V]),.8);
 p.videos[V]={observed:true,segments:[[0,80]],duration:100};add(80,100,true,{start:T,end:T+1000});assert.equal(S.state(p.videos[V]),'started','Seek jump fails playback rate validation');
 p.videos[V]={observed:true,segments:[[0,79]],duration:100};add(99,100,true);assert.equal(S.state(p.videos[V]),'started','Final second after a seek is insufficient');
 p.videos[V]={observed:true,segments:[[0,70]],duration:100};add(95,100,true);assert.equal(S.state(p.videos[V]),'started','75% is not enough');
 add(0,70);assert.equal(S.fraction(p.videos[V]),.75,'Replays do not increase unique coverage');add(70,90,false,{state:'ad'});assert.equal(S.fraction(p.videos[V]),.75);
 p.videos[V]={observed:true,segments:[[0,90]],duration:100};assert.equal(S.state(p.videos[V]),'watched','Existing 90% rule remains');
});
test('manual unwatched suppresses old external proof across new playback; automatic reset restores it',async()=>{
 const s=setup(),S=s.box.WatchStatus;s.data={[S.key]:{version:1,videos:{[V]:{observed:true,segments:[[0,85]],duration:100,finishedAt:T}}}};
 await S.handle({videoId:V,status:'unwatched'},youtube);const p=s.data[S.key];S.add(p,{videoId:V,start:T,end:T+1000,state:'foreground',position:0,positionEnd:1,duration:100});
 assert.equal(p.videos[V].finishedAt,undefined);assert.equal(S.state({...p.videos[V],evidence:{percent:100}}),'started');assert.equal(p.videos[V].externalIgnored,true);
 s.data={[S.key]:p};await S.handle({videoId:V,status:'recorded'},youtube);assert.equal(s.data[S.key].videos[V].externalIgnored,undefined);assert.equal(S.state({...s.data[S.key].videos[V],evidence:{percent:100}}),'watched');
});
test('observations are deduplicated and upgrade progress without modifying measured records',async()=>{
 const s=setup(),E=s.box.WatchEvidence;s.data={'day:2026-09-01':[{saved:'untouched'}],'videoProgress:v1':{version:1,videos:{}}};
 const observe=(percent)=>E.handle({type:'watchEvidence:observe',source:'youtube-progress',records:[{videoId:V,seenAt:T,percent}]},youtube);
 await observe(30);assert.equal(s.writes,1);await observe(30);await observe(10);assert.equal(s.writes,1);await observe(95);assert.equal(s.writes,2);
 await E.handle({type:'watchEvidence:import',records:[{videoId:V,seenAt:T+1},{videoId:W,seenAt:T}]},dashboard);
 assert.equal(s.data[E.key].videos[V].percent,95);assert.equal(s.data[E.key].videos[W].percent,undefined);assert.deepEqual(s.data['day:2026-09-01'],[{saved:'untouched'}]);assert.deepEqual(s.data['videoProgress:v1'],{version:1,videos:{}});
 const before=clone(s.data);s.fail();await assert.rejects(observe(99),/quota/);assert.deepEqual(s.data,before);
});
test('passive capture respects pause, setting and sender restrictions; explicit history check still works',async()=>{
 const s=setup(),E=s.box.WatchEvidence,m={type:'watchEvidence:observe',source:'youtube-history',records:[{videoId:V,seenAt:T}]};
 s.data={paused:true};await E.handle(m,youtube);assert.equal(s.writes,0);
 s.data={settings:{learnYouTubeProgress:false}};await E.handle(m,youtube);assert.equal(s.writes,0);
 await E.handle(m,{...youtube,url:'https://www.youtube.com/feed/history#ledger-watch-check'});assert.equal(s.writes,1);
 for(const sender of [{url:'https://evil.test',tab:{id:1}},{...youtube,tab:{id:1,incognito:true}},dashboard])await assert.rejects(E.handle(m,sender));
 await E.handle({type:'watchEvidence:open'},dashboard);assert.equal(s.tabs[0].url,'https://www.youtube.com/feed/history#ledger-watch-check');
 await assert.rejects(E.handle({...m,records:Array(101).fill(m.records[0])},youtube));
 await assert.rejects(E.handle({...m,records:[{videoId:V,seenAt:T,percent:101}]},youtube));
 await assert.rejects(E.handle({type:'watchEvidence:import',records:[{videoId:V,seenAt:T,percent:100}]},dashboard));
});
test('Takeout JSON parses only real video history and strips names, titles and unrelated data',()=>{
 const {WatchEvidence:E}=setup().box,input=[{header:'YouTube',titleUrl:'https://www.youtube.com/watch?v='+V,title:'private title',time:new Date(T).toISOString()}, {products:['YouTube'],titleUrl:'https://youtu.be/'+V,time:new Date(T-1000).toISOString()}, {header:'YouTube',titleUrl:'https://www.youtube.com/results?search_query=hello',time:new Date(T).toISOString()}, {header:'Other',titleUrl:'https://www.youtube.com/watch?v='+W,time:new Date(T).toISOString()}, {header:'YouTube',titleUrl:'https://evil.test/watch?v='+W,time:new Date(T).toISOString()}, {header:'YouTube',titleUrl:'https://www.youtube.com/shorts/'+W,time:new Date(T).toISOString()}, {header:'YouTube',titleUrl:'https://www.youtube.com/watch?v='+X,time:'invalid'}];
 assert.equal(JSON.stringify(E.parseJSON(JSON.stringify(input))),JSON.stringify({records:[{videoId:V,seenAt:T},{videoId:W,seenAt:T}],omitted:0}));
 for(const text of ['bad','{}','[]'])assert.throws(()=>E.parseJSON(text));
 for(const url of ['javascript:alert(1)','https://www.youtube.com.evil.test/watch?v='+V,'https://user@www.youtube.com/watch?v='+V,'https://www.youtube.com/watch?v=bad'])assert.equal(E.videoId(url),null);
});
test('evidence retention and filter prioritize known sightings without calling zero progress watched',()=>{
 const {WatchEvidence:E,WatchStatus:S,FeedLibrary:F}=setup().box;
 const input=Array.from({length:20000},(_,i)=>({videoId:String(i).padStart(11,'0'),seenAt:T-i}));
 const result=E.merge({videos:{[V]:{seenAt:1,source:'history-file'}}},input,'history-file');assert.equal(Object.keys(result.value.videos).length,20000);assert.equal(result.trimmed,1);assert.equal(result.value.videos[V],undefined);
 const p={videos:{[V]:{manual:'unwatched'}},evidence:{[V]:{percent:100},[W]:{seenAt:T},[X]:{percent:20}}};
 const entries=[V,W,X,'ddddddddddd'].map(videoId=>({videoId,title:'Video',channel:'Channel',publishedAt:T}));
 assert.deepEqual(Array.from(F.visible(entries,p,{hidePreviouslyPlayed:true}),v=>v.videoId),[V,'ddddddddddd']);
 assert.equal(F.visible(entries,p,{}, {filter:'started'}).length,1);assert.equal(F.visible(entries,p,{}, {filter:'unwatched'}).length,4,'Completion unknown is not excluded by unfinished filter');
});
test('evidence and manual suppression survive profile transfer; invalid proofs fail validation',()=>{
 const s=setup(),{LedgerBackup:B}=s.box,data={'watchEvidence:v1':{version:1,videos:{[V]:{seenAt:T,source:'youtube-progress',percent:95},[W]:{seenAt:1,source:'history-file'}}},'videoProgress:v1':{version:1,videos:{[V]:{observed:true,segments:[[10,100]],duration:100,finishedAt:T,externalIgnored:true}}},'groupBrowsing:v1':{version:1,groups:{g:{hidden:[],hidePreviouslyPlayed:true}}}};
 assert.deepEqual(clone(B.validate(B.wrap(data))),data);
 for(const mutate of [d=>d['watchEvidence:v1'].videos[V].percent=101,d=>d['watchEvidence:v1'].videos[V].seenAt=0,d=>d['watchEvidence:v1'].videos[V].source='unknown',d=>d['videoProgress:v1'].videos[V].externalIgnored='true',d=>d['videoProgress:v1'].videos[V].finishedAt=-1,d=>d['groupBrowsing:v1'].groups.g.hidePreviouslyPlayed='false']){const bad=clone(data);mutate(bad);assert.throws(()=>B.validate(B.wrap(bad)));}
});
test('fast-playback final position jitter is accepted without crediting a seek jump',()=>{
 const S=setup().box.WatchStatus,p={version:1,videos:{[V]:{observed:true,segments:[[3.6,17.5]],duration:20}}};
 S.add(p,{videoId:V,state:'foreground',start:T,end:T+415,position:17.5,positionEnd:20,duration:20,rate:4,finished:true});assert.equal(S.state(p.videos[V]),'watched');assert.equal(S.fraction(p.videos[V]),.82);
 const other={version:1,videos:{}};S.add(other,{videoId:V,state:'foreground',start:T,end:T+415,position:0,positionEnd:20,duration:20,rate:4,finished:true});assert.equal(S.fraction(other.videos[V]),0);assert.equal(S.state(other.videos[V]),'started');
});
test('collector captures sub-second play/pause and rejects seeks and media-element replacements',()=>{
 let mono=0,wall=T,media={currentTime:0,duration:100,paused:true,ended:false,seeking:false,readyState:4,playbackRate:1,muted:false,volume:1};const saved=[],handlers=new Map();
 const doc={visibilityState:'visible',hasFocus:()=>true,title:'Fixture - YouTube',getElementById:()=>null,querySelector:q=>q.includes('video')?media:null,dispatchEvent(){},addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},removeEventListener(){}};
 const box={URL,Event,console,crypto:require('node:crypto').webcrypto,location:{href:'https://www.youtube.com/watch?v='+V},Date:{now:()=>wall},performance:{now:()=>mono},setInterval:()=>1,clearInterval(){},document:doc,window:{addEventListener(){},removeEventListener(){}},Ledger:{channelURL:()=>'',avatarURL:()=>''},PlaybackSource:{read:()=>({id:'one',source:{kind:'channel'}})},browser:{storage:{local:{get:async()=>({})},onChanged:{addListener(){},removeListener(){}}},runtime:{sendMessage:async()=>({ok:true})}},RecordingBuffer:()=>({add:e=>saved.push(e),flush:async()=>{},stop(){},clear(){}})};
 vm.createContext(box);vm.runInContext(fs.readFileSync('content.js','utf8'),box);
 const fire=name=>(handlers.get(name)||[]).forEach(fn=>fn({type:name,target:media})),advance=(seconds,position)=>{mono+=seconds*1000;wall+=seconds*1000;media.currentTime=position;};
 media.paused=false;fire('playing');advance(.4,.4);media.paused=true;fire('pause');assert.equal(saved.filter(e=>e.state==='foreground').length,1);assert.equal(saved[0].positionEnd,.4);assert.equal(saved[0].media,undefined);
 media.paused=false;fire('playing');advance(.1,80);media.seeking=true;fire('seeking');media.seeking=false;fire('seeked');advance(.4,80.4);media.paused=true;fire('pause');assert.equal(saved.filter(e=>e.state==='foreground').length,2);assert.equal(saved.filter(e=>e.state==='foreground').at(-1).position,80);
 media={...media,currentTime:95,paused:false};advance(.1,95);fire('playing');advance(.5,95.5);media.paused=true;fire('pause');assert.equal(saved.filter(e=>e.state==='foreground').at(-1).position,95,'Does not join playback from the replaced element');
 assert.ok(saved.filter(e=>e.state==='foreground').every(e=>e.positionEnd-e.position<1));
});
