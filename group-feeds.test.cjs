const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('./group-feeds.js');require('./core.js');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22);
test('real YouTube Atom feed parses exact publication dates and retains videos older than three months',()=>{
  const entries=GroupFeeds.parse(fs.readFileSync('tests/fixtures/youtube-uploads.xml','utf8'),'UCvryaJCRHcTVjOC_DcuYxGg');
  assert.equal(entries.length,15);assert.equal(entries[0].videoId,'26TR58pNuu0');
  assert.equal(entries[0].publishedAt,Date.parse('2026-09-05T10:00:40Z'));
  assert.equal(entries[0].views.count,109);assert.ok(entries[0].views.checkedAt>0);
  assert.ok(entries.some(v=>v.publishedAt<Date.parse('2026-06-05')));
  assert.throws(()=>GroupFeeds.parse('<html>Sign in</html>',A),/unreadable/);
  assert.throws(()=>GroupFeeds.parse(fs.readFileSync('tests/fixtures/youtube-uploads.xml','utf8'),A),/different channel/);
});
test('RSS counts include zero, ignore malformed statistics, and survive a refresh with missing statistics',()=>{
 const source=fs.readFileSync('tests/fixtures/youtube-uploads.xml','utf8'),id='UCvryaJCRHcTVjOC_DcuYxGg';
 const parse=value=>GroupFeeds.parse(source.replace('views="109"','views="'+value+'"'),id,100)[0];
 assert.deepEqual(parse('0').views,{count:0,checkedAt:100});
 for(const value of ['-1','1.5','1,000','999999999999999999999'])assert.equal(parse(value).views,undefined);
 const entry=parse('123'),cache=GroupFeeds.merge(null,id,[entry],100),{views,...withoutViews}=entry;
 assert.deepEqual(GroupFeeds.merge(cache,id,[withoutViews],200).channels[id].entries[0].views,views);
 assert.deepEqual(GroupFeeds.merge(cache,id,[{...entry,views:{count:250,checkedAt:200}}],200).channels[id].entries[0].views,{count:250,checkedAt:200});
});
test('cache merges and deduplicates, preserves old discoveries on refresh and failure, and bounds size without a time cutoff',()=>{
  const entry=(n,channelId=A)=>({videoId:String(n).padStart(11,'0'),channelId,title:'Video '+n,publishedAt:n});
  const initial=GroupFeeds.merge(null,A,[entry(1),entry(2)],10);
  const updated=GroupFeeds.merge(initial,A,[{...entry(2),title:'Updated'},entry(3)],20);
  assert.deepEqual(updated.channels[A].entries.map(v=>v.videoId),[3,2,1].map(n=>String(n).padStart(11,'0')));
  assert.equal(updated.channels[A].entries[1].title,'Updated');assert.equal(initial.channels[A].entries.length,2);
  const failed=GroupFeeds.merge(updated,A,undefined,30,'Offline');assert.equal(failed.channels[A].fetchedAt,20);assert.deepEqual(failed.channels[A].entries,updated.channels[A].entries);
  const limited=GroupFeeds.merge(null,A,Array.from({length:300},(_,i)=>entry(i)),40);assert.equal(limited.channels[A].entries.length,250);
  let all;for(let c=0;c<22;c++)all=GroupFeeds.merge(all,'channel'+c,Array.from({length:250},(_,i)=>entry(c*250+i,'channel'+c)),50);
  assert.equal(Object.values(all.channels).flatMap(c=>c.entries).length,5000);
});
test('repeat visits keep group and recommendation playback separate in combined exports',()=>{
  const rows=[];
  const add=(id,source,start)=>Ledger.add(rows,{id,videoId:'same',title:'Episode',channel:'Creator',source,start,end:start+1000,state:'foreground'});
  add('from-group',{kind:'group',groupId:'g1',groupName:'Podcasts',evidence:'group-feed-link'},1000);
  add('from-home',{kind:'recommendations',evidence:'observed-click'},3000);
  add('old-record',undefined,5000);
  const grouped=Ledger.group(rows);assert.equal(grouped.length,1);assert.equal(grouped[0].seconds.foreground,3);assert.equal(grouped[0].source,undefined);
  assert.deepEqual(grouped[0].sources.map(s=>s.source.kind),['group','recommendations','unknown']);
  assert.equal(grouped[0].sources[0].source.groupName,'Podcasts');assert.equal(grouped[0].sources[0].seconds.foreground,1);
  assert.equal(rows[1].source.kind,'recommendations');
  assert.equal(Ledger.source({kind:'group'}).kind,'unknown');
});
test('launch context verifies listed videos, expires, rejects outsiders and preserves the launch-time group name',async()=>{
  const V='a'.repeat(11),local={'channelGroups:v1':{groups:[{id:'g',name:'Podcasts',channelIds:[A]}],channels:{[A]:{id:A,name:'Alpha'}}},'channelUploads:v1':{channels:{[A]:{entries:[{videoId:V,channelId:A,title:'Episode',publishedAt:1000}]}}}},session={};
  const storage=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async value=>Object.assign(data,value)});
  const sandbox={URL,Date,Map,Set,Promise,structuredClone,crypto:require('node:crypto').webcrypto,ChannelGroups:{key:'channelGroups:v1'},browser:{storage:{local:storage(local),session:storage(session)}}};
  vm.runInNewContext(fs.readFileSync('group-feeds.js','utf8'),sandbox);const feeds=sandbox.GroupFeeds,sender={tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'};
  const data=await feeds.handle({type:'groupFeed:get',groupId:'g'},sender);
  local['channelGroups:v1'].groups[0].name='Renamed';
  const valid=await feeds.handle({type:'groupFeed:source',token:data.launchToken,videoId:V},sender);assert.equal(valid.groupName,'Podcasts');assert.equal(valid.kind,'group');
  assert.equal((await feeds.handle({type:'groupFeed:source',token:data.launchToken,videoId:'b'.repeat(11)},sender)).kind,'unknown');
  session['groupLaunches:v1'][data.launchToken].at=0;
  assert.equal((await feeds.handle({type:'groupFeed:source',token:data.launchToken,videoId:V},sender)).kind,'unknown');
  await assert.rejects(feeds.handle({type:'groupFeed:get',groupId:'g'},{tab:{id:1},url:'https://evil.test/'}),/cannot open/);
  await assert.rejects(feeds.handle({type:'groupFeed:get',groupId:'g'},{...sender,tab:{id:1,incognito:true}}),/cannot open/);
});

const {harness,turn:refreshTurn}=require('./request-test-helpers.cjs');
function refreshHarness(count=1){
 const s=harness(['core.js','youtube-requests.js']);
 const ids=Array.from({length:count},(_,i)=>'UC'+String(i).padStart(22,'0'));
 s.data['channelGroups:v1']={version:1,groups:[{id:'all',name:'All',channelIds:ids},{id:'other',name:'Other',channelIds:ids.slice(2)}],channels:Object.fromEntries(ids.map(id=>[id,{id,name:id}]))};
 s.data['channelUploads:v1']={version:1,channels:{}};s.box.ChannelGroups={key:'channelGroups:v1'};s.load('group-feeds.js');
 const response=(url,status=200,retryAfter)=>s.response(url,status,`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${new URL(url).searchParams.get('channel_id')}</yt:channelId><title>Test channel</title></feed>`,retryAfter);
 return {...s,feeds:s.box.GroupFeeds,ids,response,sender:{tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'},cache:id=>s.data['channelUploads:v1'].channels[id]};
}
test('feed errors make one attempt, keep cached videos, and manual refresh respects the fifteen-minute backoff',async()=>{
 for(const failure of [404,500,'TimeoutError','TypeError']){
  const s=refreshHarness(),id=s.ids[0],entry={videoId:'a'.repeat(11),channelId:id,title:'Saved video',publishedAt:1};let calls=0;
  s.data['channelUploads:v1'].channels[id]={entries:[entry],fetchedAt:1};
  s.box.fetch=async url=>{calls++;if(typeof failure==='string')throw Object.assign(Error('Network'),{name:failure});return s.response(url,failure);};
  await s.finish(Promise.all([s.feeds.getChannelUploads(id),s.feeds.getChannelUploads(id)]));
  assert.equal(calls,1);assert.deepEqual(s.cache(id).entries,[entry]);assert.equal(s.cache(id).fetchedAt,1);assert.equal(s.cache(id).retryAt-s.clock.now,900000);
  s.clock.now+=61000;await s.finish(s.feeds.getChannelUploads(id,true));assert.equal(calls,1);
  s.clock.now=s.cache(id).retryAt;s.box.fetch=async url=>{calls++;return s.response(url);};await s.finish(s.feeds.getChannelUploads(id));assert.equal(calls,2);assert.equal(s.cache(id).error,'');
 }
});
test('background sweeps check inactive channels at most every two hours; opening a group prioritizes its due channels',async()=>{
 const s=refreshHarness(4),calls=[];s.box.fetch=async url=>{calls.push(new URL(url).searchParams.get('channel_id'));return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,4);
 s.clock.now+=16*60000;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,4);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'other'},s.sender));assert.deepEqual(calls.slice(4),s.ids.slice(2));
 s.clock.now+=2*3600000;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,10);
});
test('overlapping groups share paced requests and cooldown stops a large sweep after three server errors',async()=>{
 const s=refreshHarness(25),calls=[];s.box.fetch=async url=>{calls.push(url);return s.response(url,503);};
 await s.finish(Promise.all([s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender),s.feeds.handle({type:'groupFeed:checkAll'},s.sender)]));
 assert.equal(calls.length,3);assert.equal(new Set(calls).size,3);assert.equal(Object.keys(s.data['channelUploads:v1'].channels).length,3);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.ok(data.pausedUntil>s.clock.now);
 const before=calls.length;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls.length,before);
});
test('three missing feeds back off individually while the remaining group channels finish refreshing',async()=>{
 const s=refreshHarness(15),calls=[];
 s.box.fetch=async url=>{const id=new URL(url).searchParams.get('channel_id');calls.push(id);return s.response(url,s.ids.indexOf(id)<3?404:200);};
 for(const id of s.ids)s.data['channelUploads:v1'].channels[id]={entries:[{videoId:'a'.repeat(11),channelId:id,title:'Cached video',publishedAt:1}],fetchedAt:1};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender));
 assert.equal(calls.length,15);assert.equal(new Set(calls).size,15);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.pausedUntil,0);
 for(const id of s.ids.slice(0,3)){assert.match(s.cache(id).error,/HTTP 404/);assert.equal(s.cache(id).entries.length,1);assert.equal(s.cache(id).fetchedAt,1);assert.ok(s.cache(id).retryAt>s.clock.now);}
 for(const id of s.ids.slice(3)){assert.equal(s.cache(id).error,'');assert.ok(s.cache(id).fetchedAt>1);}
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',failedOnly:true,force:true},s.sender));assert.equal(calls.length,15);
});
test('a large run of missing feeds stops a background sweep before checking every channel',async()=>{
 const s=refreshHarness(25),calls=[];s.box.fetch=async url=>{calls.push(url);return s.response(url,404);};
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,10);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.pauseReason,'feed-not-found');assert.equal(data.pauseScope,'automatic');
 assert.equal(Object.keys(s.data['channelUploads:v1'].channels).length,10);
});
test('a background channel already queued is promoted when its group opens',async()=>{
 const s=refreshHarness(2),calls=[];s.box.fetch=async url=>{calls.push({url,at:s.clock.now});return s.response(url);};
 await s.finish(s.feeds.getChannelUploads(s.ids[0]));const at=s.clock.now;
 const background=s.feeds.getChannelUploads(s.ids[1],false,true);await refreshTurn();
 const foreground=s.feeds.getChannelUploads(s.ids[1]);await s.finish(Promise.all([background,foreground]));assert.equal(calls.length,2);assert.equal(calls[1].at-at,2000);
});
test('failed-only retry excludes healthy channels and invalidation cancels pending network work',async()=>{
 const s=refreshHarness(6),calls=[];s.box.fetch=async url=>{calls.push(url);return s.response(url);};
 for(const id of s.ids)s.data['channelUploads:v1'].channels[id]={entries:[],attemptedAt:1,fetchedAt:1,error:id===s.ids[1]?'Offline':''};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',failedOnly:true,force:true},s.sender));assert.equal(calls.length,1);
 const before=structuredClone(s.data['channelUploads:v1']),tasks=s.ids.map(id=>s.feeds.getChannelUploads(id));await refreshTurn();s.feeds.invalidate();await s.finish(Promise.all(tasks));assert.equal(calls.length,1);assert.deepEqual(s.data['channelUploads:v1'],before);
});
