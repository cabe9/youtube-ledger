const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A='UC'+'a'.repeat(22),V='a'.repeat(11),W='b'.repeat(11),clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function setup(){
 const stores={local:{},session:{}},box={console,URL,structuredClone,crypto:require('node:crypto').webcrypto,atob,btoa,CompressionStream,DecompressionStream,Blob,Response,setTimeout,AbortSignal,fetch};
 const storage=Object.fromEntries(Object.keys(stores).map(area=>[area,{get:async keys=>keys===null?clone(stores[area]):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in stores[area]).map(k=>[k,clone(stores[area][k])])),set:async value=>Object.assign(stores[area],clone(value)),remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete stores[area][k];}}]));
 box.browser={storage,runtime:{getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'0.13.0'})}};vm.createContext(box);
 for(const name of ['core','ledger-storage','ledger-undo','watch-status','group-icons','channel-groups','group-feeds','feed-library','group-queue','source-contexts','backup'])vm.runInContext(fs.readFileSync(__dirname+'/'+name+'.js','utf8'),box);
 const now=Date.now();stores.local={'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,entries:[{videoId:V,channelId:A,channel:'Alpha',title:'New episode',publishedAt:now-1000},{videoId:W,channelId:A,channel:'Alpha',title:'Older episode',publishedAt:now-100000}]}}}};
 return {box,stores,sender:{tab:{id:1},url:'https://www.youtube.com/watch?v='+V}};
}
test('new uploads are distinct from watched and hidden; search and sorting only cover collected uploads',()=>{
 const {box,stores}=setup(),entries=stores.local['channelUploads:v1'].channels[A].entries,F=box.FeedLibrary;
 assert.equal(F.newCount(entries,{}),0);assert.equal(F.newCount(entries,{lastVisitedAt:Date.now()-50000}),1);assert.equal(F.newCount(entries,{lastVisitedAt:Date.now()-50000,hidden:[V]}),0);
 const progress={videos:{[V]:{manual:'watched'}}};assert.deepEqual(clone(F.visible(entries,progress,{},{}).map(e=>e.videoId)),[V,W]);
 assert.deepEqual(clone(F.visible(entries,progress,{}, {sort:'oldest'}).map(e=>e.videoId)),[W,V]);
 assert.deepEqual(clone(F.visible(entries,progress,{}, {query:'ALPHA',filter:'unwatched'}).map(e=>e.videoId)),[W]);
 assert.deepEqual(clone(F.visible(entries,progress,{hidden:[V]}, {filter:'hidden',query:'new'}).map(e=>e.videoId)),[V]);assert.equal(F.visible(entries,progress,{}, {query:'not cached'}).length,0);
});
test('resume uses the most recent valid playhead, not the furthest watched range, and rejects seeks and out-of-order samples',()=>{
 const W=setup().box.WatchStatus,p={version:1,videos:{}};
 W.add(p,{videoId:V,state:'foreground',start:1000,end:6000,position:50,positionEnd:55,duration:100,rate:1});
 W.add(p,{videoId:V,state:'foreground',start:7000,end:12000,position:10,positionEnd:15,duration:100,rate:1});assert.equal(W.resume(p.videos[V]),15);assert.equal(W.fraction(p.videos[V]),.1);
 W.add(p,{videoId:V,state:'foreground',start:1000,end:6000,position:50,positionEnd:55,duration:100,rate:1});assert.equal(W.resume(p.videos[V]),15);
 W.add(p,{videoId:V,state:'foreground',start:13000,end:18000,position:15,positionEnd:90,duration:100,rate:1});assert.equal(W.resume(p.videos[V]),15);
 p.videos[V].manual='watched';assert.equal(W.resume(p.videos[V]),0);
});
test('hide is group-local, visits never alter playback, undo is atomic and does not overwrite later playback',async()=>{
 const {box:b,stores:s,sender}=setup();const progress={version:1,videos:{[V]:{observed:true,segments:[[0,5]],duration:100,position:5,lastWatchedAt:1000}}};s.local[b.WatchStatus.key]=clone(progress);
 const visit=await b.FeedLibrary.handle({type:'feedLibrary:visit',groupId:'podcasts'},sender);assert.equal(visit.previous,null);
 const hidden=await b.FeedLibrary.handle({type:'feedLibrary:hide',groupId:'podcasts',videoId:V,hidden:true},sender);assert.deepEqual(s.local[b.WatchStatus.key],progress);
 await b.LedgerUndo.handle({token:hidden.undoToken},sender);assert.deepEqual(s.local[b.FeedLibrary.key].groups.podcasts.hidden,[]);
 const changed=await b.WatchStatus.handle({videoId:V,status:'watched'},sender);await b.LedgerUndo.handle({token:changed.undoToken},sender);assert.deepEqual(s.local[b.WatchStatus.key],progress);
 const again=await b.WatchStatus.handle({videoId:V,status:'unwatched'},sender);b.WatchStatus.add(s.local[b.WatchStatus.key],{videoId:V,state:'foreground',start:2000,end:7000,position:5,positionEnd:10,duration:100});
 await assert.rejects(b.LedgerUndo.handle({token:again.undoToken},sender),/newer change/);assert.equal(s.local[b.WatchStatus.key].videos[V].position,10);
});
test('channel expansion is saved per group without overwriting concurrent browsing changes or playback',async()=>{
 const {box:b,stores:s,sender}=setup();
 s.local[b.ChannelGroups.key].groups.push({...clone(s.local[b.ChannelGroups.key].groups[0]),id:'music',name:'Music'});
 s.local[b.WatchStatus.key]={version:1,videos:{}};
 await Promise.all([
  b.FeedLibrary.handle({type:'feedLibrary:channels',groupId:'podcasts',expanded:true},sender),
  b.FeedLibrary.handle({type:'feedLibrary:visit',groupId:'podcasts'},sender),
  b.FeedLibrary.handle({type:'feedLibrary:hide',groupId:'podcasts',videoId:V,hidden:true},sender),
  b.FeedLibrary.handle({type:'feedLibrary:channels',groupId:'music',expanded:true},sender),
  b.FeedLibrary.handle({type:'feedLibrary:channels',groupId:'podcasts',expanded:false},sender)
 ]);
 const prefs=s.local[b.FeedLibrary.key];assert.equal(prefs.groups.podcasts.channelsExpanded,false);assert.equal(prefs.groups.music.channelsExpanded,true);
 assert.deepEqual(prefs.groups.podcasts.hidden,[V]);assert.ok(prefs.groups.podcasts.lastVisitedAt);assert.equal(prefs.groups.music.lastVisitedAt,undefined);
 assert.deepEqual(s.local[b.WatchStatus.key],{version:1,videos:{}});
 const before=clone(prefs);
 await assert.rejects(b.FeedLibrary.handle({type:'feedLibrary:channels',groupId:'podcasts',expanded:'true'},sender),/whether to show/);
 await assert.rejects(b.FeedLibrary.handle({type:'feedLibrary:channels',groupId:'missing',expanded:true},sender),/no longer exists/);
 assert.deepEqual(s.local[b.FeedLibrary.key],before);
});
test('hidden channels suppress current and future uploads in one group, preserve membership/playback, reject queues, and undo independently of video hiding',async()=>{
 const {box:b,stores:s,sender}=setup(),F=b.FeedLibrary;
 s.local[b.ChannelGroups.key].groups.push({...clone(s.local[b.ChannelGroups.key].groups[0]),id:'music',name:'Music'});
 const groups=clone(s.local[b.ChannelGroups.key]),entries=s.local[b.GroupFeeds.key].channels[A].entries,progress={version:1,videos:{[V]:{manual:'watched'}}};s.local[b.WatchStatus.key]=clone(progress);
 const hidden=await F.handle({type:'feedLibrary:hideChannel',groupId:'podcasts',channelId:A,hidden:true},sender);
 const prefs=()=>s.local[F.key].groups.podcasts;
 assert.equal(F.visible(entries,progress,prefs()).length,0);assert.equal(F.visible(entries,progress,s.local[F.key].groups.music).length,2);
 assert.equal(F.visible([...entries,{...entries[0],videoId:'c'.repeat(11)}],progress,prefs()).length,0);
 assert.equal(F.newCount(entries,{...prefs(),lastVisitedAt:1}),0);
 assert.deepEqual(clone(F.visible(entries,progress,prefs(),{filter:'hidden'}).map(e=>e.videoId)),[V,W]);
 await assert.rejects(b.GroupQueue.handle({type:'groupQueue:create',groupId:'podcasts',videoIds:[V]},sender),/changed/);
 await F.handle({type:'feedLibrary:hide',groupId:'podcasts',videoId:V,hidden:true},sender);
 await b.LedgerUndo.handle({token:hidden.undoToken},sender);
 assert.deepEqual(clone(F.visible(entries,progress,prefs()).map(e=>e.videoId)),[W]);
 assert.deepEqual(s.local[b.ChannelGroups.key],groups);assert.deepEqual(s.local[b.WatchStatus.key],progress);
 await assert.rejects(F.handle({type:'feedLibrary:hideChannel',groupId:'music',channelId:'UC'+'b'.repeat(22),hidden:true},sender),/no longer/);
 await assert.rejects(F.handle({type:'feedLibrary:hideChannel',groupId:'podcasts',channelId:A,hidden:'true'},sender),/Choose a channel/);
});
test('upload and length filters intersect with watch/search/exclusions, keep unknown lengths available for checking, and shuffle a copy of the filtered set',()=>{
 const {box:b}=setup(),F=b.FeedLibrary,now=100*86400000;
 const entries=[590,600,1800,1801,undefined].map((duration,i)=>({videoId:String(i).padStart(11,'0'),channelId:A,channel:'Alpha',title:'Episode '+i,publishedAt:now-i*86400000,details:duration?{duration}:undefined}));
 const ids=(prefs,options={})=>clone(F.visible(entries,{},prefs,{now,...options}).map(e=>Number(e.videoId)));
 assert.deepEqual(ids({lengthFilter:'short'}),[0,4]);assert.deepEqual(ids({lengthFilter:'medium'}),[1,2,4]);assert.deepEqual(ids({lengthFilter:'long'}),[3,4]);
 assert.deepEqual(ids({uploadedFilter:'day'}),[0]);assert.deepEqual(ids({uploadedFilter:'visit'},{visitBoundary:now-2*86400000}),[0,1]);assert.equal(ids({uploadedFilter:'visit'},{visitBoundary:null}).length,5);
 assert.deepEqual(ids({lengthFilter:'medium',hidden:[entries[1].videoId]},{query:'episode 2'}),[2]);
 assert.equal(F.visible([entries[4]],{videos:{[entries[4].videoId]:{duration:900}}},{lengthFilter:'short'}).length,0);
 const selected=F.visible(entries,{}, {lengthFilter:'medium'}),shuffled=F.shuffle(selected,()=>0);
 assert.deepEqual(clone(shuffled.map(e=>Number(e.videoId))),[2,4,1]);assert.deepEqual(clone(selected.map(e=>Number(e.videoId))),[1,2,4]);
});
test('saved header filters validate writes and reset only browsing controls, preserving hidden channels, hidden videos and channel expansion',async()=>{
 const {box:b,stores:s,sender}=setup(),F=b.FeedLibrary;
 await Promise.all([
  F.handle({type:'feedLibrary:filters',groupId:'podcasts',filters:{uploadedFilter:'week'}},sender),
  F.handle({type:'feedLibrary:filters',groupId:'podcasts',filters:{lengthFilter:'long'}},sender),
  F.handle({type:'feedLibrary:hideChannel',groupId:'podcasts',channelId:A,hidden:true},sender),
  F.handle({type:'feedLibrary:channels',groupId:'podcasts',expanded:true},sender),
  F.handle({type:'feedLibrary:hide',groupId:'podcasts',videoId:V,hidden:true},sender)
 ]);
 const prefs=s.local[F.key].groups.podcasts;assert.equal(prefs.uploadedFilter,'week');assert.equal(prefs.lengthFilter,'long');
 const before=clone(s.local[F.key]);for(const filters of [{lengthFilter:'invalid'},{uploadedFilter:'invalid'},{hiddenChannels:[]},[]])await assert.rejects(F.handle({type:'feedLibrary:filters',groupId:'podcasts',filters},sender));assert.deepEqual(s.local[F.key],before);
 const backup=b.LedgerBackup.wrap(s.local);assert.deepEqual(clone(b.LedgerBackup.validate(backup)),s.local);
 for(const fields of [{hiddenChannels:['invalid']},{lengthFilter:'invalid'},{uploadedFilter:'invalid'}]){const bad=clone(backup);Object.assign(bad.data[F.key].groups.podcasts,fields);assert.throws(()=>b.LedgerBackup.validate(bad));}
 s.local[b.ChannelGroups.key].groups[0].watchFilter='watched';s.local[b.ChannelGroups.key].groups[0].hideShorts=true;
 await F.handle({type:'feedLibrary:resetFilters',groupId:'podcasts'},sender);
 assert.deepEqual(s.local[F.key].groups.podcasts,{...prefs,lengthFilter:'all',uploadedFilter:'all',hidePreviouslyPlayed:false});assert.equal(s.local[b.ChannelGroups.key].groups[0].watchFilter,'all');assert.equal(s.local[b.ChannelGroups.key].groups[0].hideShorts,false);
});
test('metadata sorts reverse independently, retain zeroes, put unknowns last, and use upload age at the view-count snapshot',()=>{
 const {box:b}=setup(),F=b.FeedLibrary,at=100*86400000;
 const entries=[
  {videoId:'a',publishedAt:at-3600000,views:{count:100,checkedAt:at},details:{duration:60}},
  {videoId:'b',publishedAt:at-10*3600000,views:{count:500,checkedAt:at},details:{duration:600}},
  {videoId:'c',publishedAt:at-2*3600000,views:{count:0,checkedAt:at},details:{duration:300}},
  {videoId:'d',publishedAt:at-3*3600000},
  {videoId:'e',publishedAt:at-4*3600000,details:{status:'live'}}
 ].map(e=>({...e,channelId:A,channel:'Alpha',title:'Episode'}));
 const ordered=sort=>clone(F.visible(entries,{}, {},{sort,now:at+86400000}).map(e=>e.videoId));
 assert.deepEqual(ordered('views-desc'),['b','a','c','d','e']);assert.deepEqual(ordered('views-asc'),['c','a','b','d','e']);
 assert.deepEqual(ordered('rate-desc'),['a','b','c','d','e']);assert.deepEqual(ordered('rate-asc'),['c','b','a','d','e']);
 assert.deepEqual(ordered('length-asc'),['a','c','b','d','e']);assert.deepEqual(ordered('length-desc'),['b','c','a','d','e']);
 assert.equal(F.metric(entries[0],{},'rate'),100);assert.equal(F.metric({...entries[0],publishedAt:at}, {},'rate'),undefined);
 assert.equal(F.metric(entries[4],{videos:{e:{duration:100}}},'length'),undefined,'Live videos have no final length');
 assert.deepEqual(clone(F.visible(entries,{}, {hiddenChannels:[A]},{sort:'views-desc'})),[]);
 for(const [key,value] of Object.entries(b.Ledger.groupSorts))assert.equal(b.Ledger.groupSortKey(value.metric,value.descending),key);
 assert.equal(b.Ledger.groupSort('oldest').metric,'date');assert.equal(b.Ledger.groupSort('oldest').descending,false);
});
test('each sort direction and cached views survive backups; malformed counts or sort choices are rejected',()=>{
 const {box:b,stores:s}=setup(),group=s.local[b.ChannelGroups.key].groups[0],entry=s.local[b.GroupFeeds.key].channels[A].entries[0];entry.views={count:0,checkedAt:100};
 for(const sort of Object.keys(b.Ledger.groupSorts)){
  const state=b.ChannelGroups.change(s.local[b.ChannelGroups.key],{action:'sort',groupId:group.id,sort});assert.equal(state.groups[0].sort,sort);
  s.local[b.ChannelGroups.key]=clone(state);assert.deepEqual(clone(b.LedgerBackup.validate(b.LedgerBackup.wrap(s.local))),s.local);
 }
 for(const value of ['popular','constructor','__proto__'])assert.throws(()=>b.ChannelGroups.change(s.local[b.ChannelGroups.key],{action:'sort',groupId:group.id,sort:value}));
 for(const views of [{count:-1,checkedAt:100},{count:'100',checkedAt:100},{count:1.5,checkedAt:100},{count:1,checkedAt:-1}]){const bad=b.LedgerBackup.wrap(clone(s.local));bad.data[b.GroupFeeds.key].channels[A].entries[0].views=views;assert.throws(()=>b.LedgerBackup.validate(bad));}
});
test('deleting a group can restore its icon, order, channels, browsing preferences and old cached uploads',async()=>{
 const {box:b,stores:s,sender}=setup();s.local[b.FeedLibrary.key]={version:1,groups:{podcasts:{hidden:[W],lastVisitedAt:123,channelsExpanded:true}}};const groups=clone(s.local[b.ChannelGroups.key]),cache=clone(s.local[b.GroupFeeds.key]);
 const result=await b.ChannelGroups.handle({type:'channelGroups:change',action:'delete',groupId:'podcasts'},sender);assert.equal(s.local[b.ChannelGroups.key].groups.length,0);assert.equal(s.local[b.FeedLibrary.key].groups.podcasts,undefined);assert.deepEqual(s.local[b.GroupFeeds.key].channels,{});
 await b.LedgerUndo.handle({token:result.undoToken},sender);assert.deepEqual(s.local[b.ChannelGroups.key],groups);assert.deepEqual(s.local[b.GroupFeeds.key],cache);assert.equal(s.local[b.FeedLibrary.key].groups.podcasts.lastVisitedAt,123);assert.equal(s.local[b.FeedLibrary.key].groups.podcasts.channelsExpanded,true);
});
test('queues use an explicit filtered snapshot, validate destinations, preserve source after rename and require opt-in for automatic continuation',async()=>{
 const {box:b,stores:s,sender}=setup();const created=await b.GroupQueue.handle({type:'groupQueue:create',groupId:'podcasts',videoIds:[W,V]},sender),hash=new URLSearchParams(new URL(created.url).hash.slice(1)),context={token:hash.get('ledger-queue'),step:hash.get('ledger-step'),videoId:W};
 assert.equal(new URL(created.url).searchParams.get('v'),W);let queue=await b.GroupQueue.handle({type:'groupQueue:get',...context},sender);assert.equal(queue.auto,false);assert.deepEqual(clone(queue.entries.map(e=>e.videoId)),[W,V]);
 const previousVisitId=b.crypto.randomUUID();await assert.rejects(b.GroupQueue.handle({type:'groupQueue:step',...context,index:1,automatic:true,previousVisitId},sender),/off/);
 await b.GroupQueue.handle({type:'groupQueue:auto',...context,auto:true},sender);const next=await b.GroupQueue.handle({type:'groupQueue:step',...context,index:1,automatic:true,previousVisitId},sender),nextHash=new URLSearchParams(new URL(next.url).hash.slice(1));
 s.local[b.ChannelGroups.key].groups[0].name='Renamed';const source=await b.GroupQueue.handle({type:'groupQueue:source',token:context.token,step:nextHash.get('ledger-step'),videoId:V},sender);
 assert.equal(source.groupName,'Podcasts');assert.equal(source.evidence,'group-queue-auto');assert.equal(source.journey.previousVisitId,previousVisitId);assert.equal(source.journey.previousVideoId,W);
 const reopened=await b.GroupQueue.handle({type:'groupQueue:source',token:context.token,step:nextHash.get('ledger-step'),videoId:V},sender);assert.equal(reopened.journey,null);assert.equal(reopened.evidence,'group-queue-link');
 assert.equal(await b.GroupQueue.handle({type:'groupQueue:source',...context,videoId:V},sender),null);
 await assert.rejects(b.GroupQueue.handle({type:'groupQueue:create',groupId:'podcasts',videoIds:['c'.repeat(11)]},sender),/changed/);
 await b.GroupQueue.handle({type:'groupQueue:close',...context},sender);assert.equal(await b.GroupQueue.handle({type:'groupQueue:get',...context},sender),null);
});
test('only a fresh automatic transition requests playback, independently of source attribution',async()=>{
 const {box:b,sender}=setup();
 const context=url=>{const u=new URL(url),hash=new URLSearchParams(u.hash.slice(1));return {token:hash.get('ledger-queue'),step:hash.get('ledger-step'),videoId:u.searchParams.get('v')};};
 const initial=context((await b.GroupQueue.handle({type:'groupQueue:create',groupId:'podcasts',videoIds:[V,W]},sender)).url);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:get',...initial},sender)).startPlayback,false);
 await b.GroupQueue.handle({type:'groupQueue:auto',...initial,auto:true},sender);
 const manual=context((await b.GroupQueue.handle({type:'groupQueue:step',...initial,index:1},sender)).url);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:get',...manual},sender)).startPlayback,false);
 const automatic=context((await b.GroupQueue.handle({type:'groupQueue:step',...initial,index:1,automatic:true},sender)).url);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:source',...automatic},sender)).evidence,'group-queue-auto');
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:get',...automatic},sender)).startPlayback,true);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:get',...automatic},sender)).startPlayback,false,'Reload and reused links do not restart playback');
 const cancelled=context((await b.GroupQueue.handle({type:'groupQueue:step',...initial,index:1,automatic:true},sender)).url);
 await b.GroupQueue.handle({type:'groupQueue:auto',...initial,auto:false},sender);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:get',...cancelled},sender)).startPlayback,false);
});
test('queue card links start at the selected video without rotating the filtered order',async()=>{
 const {box:b,stores:s,sender}=setup(),token=b.crypto.randomUUID(),step=b.crypto.randomUUID();
 const input={type:'groupQueue:create',groupId:'podcasts',videoIds:[W,V],startVideoId:V,token,step};
 const created=await b.GroupQueue.handle(input,sender),u=new URL(created.url),context={token,step,videoId:V};
 assert.equal(u.searchParams.get('v'),V);assert.equal(new URLSearchParams(u.hash.slice(1)).get('ledger-queue'),token);
 const queue=await b.GroupQueue.handle({type:'groupQueue:get',...context},sender);
 assert.equal(queue.index,1);assert.equal(queue.auto,false);assert.deepEqual(clone(queue.entries.map(e=>e.videoId)),[W,V]);
 assert.equal((await b.GroupQueue.handle({type:'groupQueue:source',...context},sender)).evidence,'group-queue-start');
 const previous=await b.GroupQueue.handle({type:'groupQueue:step',...context,index:0},sender);assert.equal(new URL(previous.url).searchParams.get('v'),W);
 await assert.rejects(b.GroupQueue.handle(input,sender),/Invalid queue link/);
 await assert.rejects(b.GroupQueue.handle({...input,token:b.crypto.randomUUID(),startVideoId:'c'.repeat(11)},sender),/Choose a video/);
 await assert.rejects(b.GroupQueue.handle({...input,token:'bad'},sender),/Invalid queue link/);
 s.local[b.FeedLibrary.key]={version:1,groups:{podcasts:{hidden:[V]}}};
 await assert.rejects(b.GroupQueue.handle({...input,token:b.crypto.randomUUID()},sender),/changed/);
});
test('period source totals split repeat videos honestly and journeys never infer predecessors by time',()=>{
 const {box:b}=setup(),L=b.Ledger,day=L.dayKey(Date.now()),rows=[],one=b.crypto.randomUUID(),two=b.crypto.randomUUID();
 for(const [id,source,journey] of [[one,{kind:'group',groupId:'podcasts',groupName:'Podcasts'},null],[two,{kind:'recommendations'},{previousVisitId:one,previousVideoId:V,transition:'click'}]])L.add(rows,{id,videoId:V,title:'Episode',channel:'Alpha',url:'https://www.youtube.com/watch?v='+V,state:'foreground',start:1000,end:5000,source,journey});
 L.add(rows,{id:b.crypto.randomUUID(),videoId:W,title:'Unknown episode',state:'foreground',start:5000,end:6000});
 const report=L.trendReport({['day:'+day]:rows},day,7);assert.equal(report.totals.playback,9);assert.deepEqual(clone(report.sources.map(s=>[s.key,s.seconds])),[['group:podcasts',4],['recommendations',4],['unknown',1]]);
 assert.deepEqual(clone(report.days.at(-1).sources),clone(report.sources));assert.ok(report.days.every(d=>d.sources.reduce((n,s)=>n+s.seconds,0)===d.playback));
 const visits=L.journeys(rows);assert.equal(visits[1].predecessor.previousVisitId,one);assert.equal(visits[1].predecessorRecorded,true);assert.equal(visits[2].predecessor,null);
 const outside=L.journeys([rows[1]])[0];assert.equal(outside.predecessorRecorded,false);
});
test('new portable fields round-trip; invalid positions, sort orders, hidden IDs and predecessor injection are rejected or sanitized',()=>{
 const {box:b,stores:s}=setup();s.local[b.FeedLibrary.key]={version:1,groups:{podcasts:{hidden:[W],lastVisitedAt:100,channelsExpanded:false}}};s.local[b.ChannelGroups.key].groups[0].sort='oldest';s.local[b.ChannelGroups.key].groups[0].watchFilter='hidden';s.local[b.WatchStatus.key]={version:1,videos:{[V]:{observed:true,segments:[[0,10]],duration:100,position:10,lastWatchedAt:100}}};
 const backup=b.LedgerBackup.wrap(s.local);assert.deepEqual(clone(b.LedgerBackup.validate(backup)),s.local);
 for(const edit of [d=>d[b.FeedLibrary.key].groups.podcasts.hidden.push('invalid'),d=>d[b.FeedLibrary.key].groups.podcasts.channelsExpanded='true',d=>d[b.ChannelGroups.key].groups[0].sort='popular',d=>d[b.WatchStatus.key].videos[V].position=200]){const bad=clone(backup);edit(bad.data);assert.throws(()=>b.LedgerBackup.validate(bad));}
 assert.equal(b.Ledger.journey({previousVisitId:'pretend',previousVideoId:V,transition:'click'}),null);
});
test('large undo snapshots compress and retain exact image bytes without accumulating unbounded temporary records',async()=>{
 const {box:b,stores:s,sender}=setup(),value=require('node:crypto').randomBytes(300000).toString('base64');s.local.settings={image:value};
 let latest;for(let i=0;i<9;i++)latest=await b.LedgerUndo.record([{key:'settings',path:['image'],before:value,after:'changed'}]);
 assert.ok(Object.values(s.session['ledgerUndo:v1']).some(e=>e.compressed));assert.ok(JSON.stringify(s.session['ledgerUndo:v1']).length<2550000);assert.ok(Object.keys(s.session['ledgerUndo:v1']).length<9);
 s.local.settings.image='changed';await b.LedgerUndo.handle({token:latest},sender);assert.equal(s.local.settings.image,value);
});

test('first group visits default to seven days and preserve an explicitly chosen date range',async()=>{
 const {box:b,stores:s,sender}=setup(),F=b.FeedLibrary;
 await F.handle({type:'feedLibrary:visit',groupId:'podcasts'},sender);assert.equal(s.local[F.key].groups.podcasts.uploadedFilter,'week');
 for(const choice of ['all','day','month']){
  await F.handle({type:'feedLibrary:filters',groupId:'podcasts',filters:{uploadedFilter:choice}},sender);
  await F.handle({type:'feedLibrary:visit',groupId:'podcasts'},sender);assert.equal(s.local[F.key].groups.podcasts.uploadedFilter,choice);
 }
});
