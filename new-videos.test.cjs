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
test('combined arrivals deduplicate memberships, exclude old/future/ungrouped uploads and honor group-local hiding',()=>{
 const {box:b,stores:s}=setup(),groups=s.local[b.ChannelGroups.key],cache=s.local[b.GroupFeeds.key],F=b.FeedLibrary,now=Date.now();
 groups.groups.push({...clone(groups.groups[0]),id:'other',name:'Other'});
 cache.channels[A].entries.push(...[[-8*86400000,'old00000001'],[86400000,'future00001']].map(([delta,videoId])=>({...cache.channels[A].entries[0],videoId,publishedAt:now+delta})));
 cache.channels['UC'+'z'.repeat(22)]={entries:[{...cache.channels[A].entries[0],channelId:'UC'+'z'.repeat(22),videoId:'foreign0001'}]};
 const library={groups:{podcasts:{hidden:[V]},other:{hiddenChannels:[A]}}};
 assert.deepEqual(clone(F.newEntries(groups,cache,{},now).map(e=>[e.videoId,e.groups.map(g=>g.id)])),[[V,['podcasts','other']],[W,['podcasts','other']]]);
 assert.deepEqual(clone(F.newEntries(groups,cache,library,now).map(e=>[e.videoId,e.groups.map(g=>g.id)])),[[W,['podcasts']]]);
 assert.deepEqual(clone(F.newEntries({groups:[]},cache,{},now)),[]);
});
test('caught up is an explicit bounded snapshot, survives concurrent tabs and never changes playback or group visit state',async()=>{
 const {box:b,stores:s,sender}=setup(),F=b.FeedLibrary;
 const progress={version:1,videos:{[V]:{observed:true,segments:[[0,10]],duration:100,position:10}}};s.local[b.WatchStatus.key]=clone(progress);
 s.local[F.key]={version:1,groups:{podcasts:{hidden:[],lastVisitedAt:1000}}};
 const first=await b.GroupFeeds.handle({type:'groupFeed:new'},sender);assert.equal(first.entries.length,2);assert.equal(first.group.name,'New videos');
 const source=await b.GroupFeeds.handle({type:'groupFeed:source',token:first.launchToken,videoId:V},sender);assert.equal(source.groupName,'New videos');
 assert.deepEqual(s.local[F.key].groups.podcasts,{hidden:[],lastVisitedAt:1000});
 const late={...s.local[b.GroupFeeds.key].channels[A].entries[0],videoId:'late0000001',publishedAt:Date.now()-86400000};s.local[b.GroupFeeds.key].channels[A].entries.push(late);
 await Promise.all([F.handle({type:'feedLibrary:caughtUp',videoIds:[V,'unknown0001']},sender),F.handle({type:'feedLibrary:caughtUp',videoIds:[W]},sender),F.handle({type:'feedLibrary:arrivalFilters',hideShorts:true},sender)]);
 const prefs=s.local[F.key];assert.equal(prefs.newVideos.hideShorts,true);assert.equal(F.isArrival(first.entries[0],prefs),false);assert.equal(F.isArrival(late,prefs),true);assert.equal(prefs.newVideos.reviewed.unknown0001,undefined);
 assert.deepEqual(s.local[b.WatchStatus.key],progress);assert.deepEqual(prefs.groups.podcasts,{hidden:[],lastVisitedAt:1000});
 assert.deepEqual(clone((await b.GroupFeeds.handle({type:'groupFeed:new'},sender)).entries.filter(e=>F.isArrival(e,prefs)).map(e=>e.videoId)),['late0000001']);
 await assert.rejects(F.handle({type:'feedLibrary:caughtUp',videoIds:['bad']},sender));await assert.rejects(F.handle({type:'feedLibrary:caughtUp',videoIds:[V]},{url:'https://example.com/',tab:{id:4}}));
 const exported=await b.LedgerBackup.handle({type:'backup:export'},{url:'chrome-extension://test/dashboard.html'});assert.deepEqual(clone(b.LedgerBackup.validate(exported)),clone(exported.data));
 for(const reviewed of [null,[],{'bad':1},{[V]:0},{[V]:'yesterday'}]){const bad=clone(exported);bad.data[F.key].newVideos.reviewed=reviewed;assert.throws(()=>b.LedgerBackup.validate(bad));}
});
test('returning creators require an observed 90-day quiet period and annotate only the first recent upload',()=>{
 const {box:b}=setup(),G=b.GroupFeeds,F=b.FeedLibrary,now=Date.now(),day=86400000;
 const entry=(videoId,publishedAt,extra={})=>({videoId,channelId:A,channel:'Alpha',title:videoId,publishedAt,...extra}),old=entry('old00000001',now-240*day),first=entry(V,now-3600000),second=entry(W,now-1800000);
 const cache=G.merge(null,A,[old],now-day),merged=G.merge(cache,A,[second,first,old],now),entries=merged.channels[A].entries;
 assert.equal(entries.find(e=>e.videoId===V).creatorReturn.previousUploadAt,old.publishedAt);assert.equal(entries.find(e=>e.videoId===W).creatorReturn,undefined);assert.equal(F.returnLabel(entries.find(e=>e.videoId===V)),'Back after 8 months');
 const repeated=G.merge(G.merge(merged,A,[],now+1000,'Timeout'),A,[first,second],now+2000);assert.deepEqual(clone(repeated.channels[A].entries[1].creatorReturn),clone(entries[1].creatorReturn));
 for(const previous of [undefined,G.merge(null,A,[old],now-200*day),G.merge(null,A,[entry(old.videoId,now-80*day)],now-day)]){
   assert.equal(G.merge(previous,A,[first,second,old],now).channels[A].entries.some(e=>e.creatorReturn),false);
 }
 const intervening=entry('between0001',now-50*day);
 assert.equal(G.merge(cache,A,[first,intervening],now).channels[A].entries.some(e=>e.creatorReturn),false,'A recovered intermediate upload disproves the old quiet period');
 assert.equal(G.merge(merged,A,[first,intervening],now+1000).channels[A].entries.some(e=>e.creatorReturn),false,'Later evidence also corrects an existing return badge');
 const missed=G.merge(cache,A,[entry(V,now-10*day)],now);assert.equal(missed.channels[A].entries.some(e=>e.creatorReturn),false,'late archive recovery is not a fresh comeback');
 const estimated=G.merge(G.merge(null,A,[{...old,publishedAtEstimated:true}],now-day),A,[{...first,publishedAtEstimated:true}],now);assert.equal(F.returnLabel(estimated.channels[A].entries[0]),'Back after ~8 months');
 // An exact correction can invalidate a previously approximate gap.
 const corrected=G.merge(estimated,A,[entry(V,old.publishedAt+60*day)],now+3000);assert.equal(corrected.channels[A].entries[0].creatorReturn,undefined);
});
test('return evidence travels in profile backups and rejects invalid notices',async()=>{
 const {box:b,stores:s}=setup(),now=Date.now(),entry=s.local[b.GroupFeeds.key].channels[A].entries[0];entry.creatorReturn={previousUploadAt:now-180*86400000,detectedAt:now,estimated:false};
 const exported=await b.LedgerBackup.handle({type:'backup:export'},{url:'chrome-extension://test/dashboard.html'});assert.deepEqual(clone(b.LedgerBackup.validate(exported)),clone(exported.data));
 for(const value of [null,{}, {...entry.creatorReturn,previousUploadAt:entry.publishedAt}, {...entry.creatorReturn,estimated:'yes'}, {...entry.creatorReturn,detectedAt:1}]){const bad=clone(exported);bad.data[b.GroupFeeds.key].channels[A].entries[0].creatorReturn=value;assert.throws(()=>b.LedgerBackup.validate(bad));}
});
