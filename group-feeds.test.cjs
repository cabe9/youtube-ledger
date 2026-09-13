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
test('background sweeps reuse channels for two hours; opening a group prioritizes its due channels',async()=>{
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
test('three scattered missing feeds back off individually while the remaining group channels finish refreshing',async()=>{
 const s=refreshHarness(15),calls=[];
 s.box.fetch=async url=>{const id=new URL(url).searchParams.get('channel_id');calls.push(id);return s.response(url,s.ids.indexOf(id)%5===0?404:200);};
 for(const id of s.ids)s.data['channelUploads:v1'].channels[id]={entries:[{videoId:'a'.repeat(11),channelId:id,title:'Cached video',publishedAt:1}],fetchedAt:1};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender));
 assert.equal(calls.length,15);assert.equal(new Set(calls).size,15);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.pausedUntil,0);
 for(const id of s.ids.filter((_,i)=>i%5===0)){assert.match(s.cache(id).error,/HTTP 404/);assert.equal(s.cache(id).entries.length,1);assert.equal(s.cache(id).fetchedAt,1);assert.ok(s.cache(id).retryAt>s.clock.now);}
 for(const id of s.ids.filter((_,i)=>i%5!==0)){assert.equal(s.cache(id).error,'');assert.ok(s.cache(id).fetchedAt>1);}
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',failedOnly:true,force:true},s.sender));assert.equal(calls.length,15);
});
test('three initial missing feeds stop a background sweep before checking every channel',async()=>{
 const s=refreshHarness(25),calls=[];s.box.fetch=async url=>{calls.push(url);return s.response(url,404);};
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,3);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.pauseReason,'feed-not-found');assert.equal(data.pauseScope,'automatic');
 assert.equal(Object.keys(s.data['channelUploads:v1'].channels).length,3);
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
test('explicit cooldown retry checks only its group despite saved error backoffs, retains cache, and deduplicates clicks',async()=>{
 const s=refreshHarness(5),until=s.clock.now+7200000,calls=[];
 s.data['youtubeRequests:v1']={pausedUntil:until,pauseScope:'automatic',pauseReason:'feed-failures'};
 for(const id of s.ids)s.data['channelUploads:v1'].channels[id]={attemptedAt:s.clock.now,error:'HTTP 404',retryAt:until,retryAfter:until,entries:[{videoId:'a'.repeat(11),channelId:id,title:'Saved',publishedAt:1}]};
 const outside=structuredClone(s.cache(s.ids[0]));s.box.fetch=async url=>{calls.push({id:new URL(url).searchParams.get('channel_id'),at:s.clock.now});return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'other',force:true},s.sender));assert.equal(calls.length,0);
 const message={type:'groupFeed:retryCooldown',groupId:'other',pausedUntil:until};
 const results=await s.finish(Promise.all([s.feeds.handle(message,s.sender),s.feeds.handle(message,s.sender)]));assert.equal(results.filter(r=>r.retried).length,1);
 assert.deepEqual(calls.map(c=>c.id),s.ids.slice(2));assert.deepEqual(calls.slice(1).map((c,i)=>c.at-calls[i].at),[10000,10000]);
 assert.deepEqual(s.cache(s.ids[0]),outside);for(const id of s.ids.slice(2)){assert.equal(s.cache(id).error,'');assert.equal(s.cache(id).entries.length,1);}
 await s.finish(s.feeds.handle(message,s.sender));assert.equal(calls.length,3);
});
test('a retry stops on the next server refusal or after three more failed channel checks',async()=>{
 for(const status of [429,500]){
  const s=refreshHarness(25),until=s.clock.now+900000;let calls=0;
  s.data['youtubeRequests:v1']={pausedUntil:until,pauseScope:'automatic',pauseReason:'feed-failures'};
  s.box.fetch=async url=>{calls++;return s.response(url,status);};
  await s.finish(s.feeds.handle({type:'groupFeed:retryCooldown',groupId:'all',pausedUntil:until},s.sender));
  assert.equal(calls,status===429?1:3);assert.ok((await s.box.YouTubeRequests.status()).pausedUntil>s.clock.now);
 }
});
test('retry validates the sender and group before clearing the cooldown',async()=>{
 const s=refreshHarness(),until=s.clock.now+900000;s.data['youtubeRequests:v1']={pausedUntil:until,pauseScope:'automatic',pauseReason:'feed-failures'};
 const message={type:'groupFeed:retryCooldown',groupId:'all',pausedUntil:until};
 await assert.rejects(s.feeds.handle(message,{url:'https://evil.test/',tab:{id:1}}),/cannot open/);
 await assert.rejects(s.feeds.handle({...message,groupId:'missing'},s.sender),/no longer exists/);
 assert.equal((await s.box.YouTubeRequests.status()).pausedUntil,until);
});
test('leaving a group lets unfinished checks finish at background pace without restarting completed channels',async()=>{
 const s=refreshHarness(7),calls=[];let release;
 s.box.fetch=async url=>{calls.push({url,at:s.clock.now});if(calls.length===1)await new Promise(resolve=>release=resolve);return s.response(url);};
 const pending=s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender);await refreshTurn();
 await s.feeds.handle({type:'groupFeed:leave'},s.sender);release();await s.finish(pending);
 assert.equal(calls.length,7);assert.equal(new Set(calls.map(c=>c.url)).size,7);assert.ok(calls.slice(1).every((c,i)=>c.at-calls[i].at>=10000));
});
test('hidden-tab refreshes are background work, and disabling the setting still allows visible group checks',async()=>{
 const s=refreshHarness(3),calls=[];s.box.fetch=async url=>{calls.push(s.clock.now);return s.response(url);};
 s.data.settings={backgroundGroupChecks:false};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',visible:false},s.sender));assert.equal(calls.length,0);
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,0);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',visible:true},s.sender));assert.equal(calls.length,3);assert.equal(calls[1]-calls[0],2000);
 s.clock.now+=3*3600000;s.data.settings.backgroundGroupChecks=true;
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',visible:false},s.sender));assert.equal(calls.length,6);assert.equal(calls[4]-calls[3],10000);
});
test('queued background checks stop when disabled, the last YouTube tab closes, or the channel is removed',async()=>{
 for(const stop of ['setting','closed','removed']){
  const s=refreshHarness(7),calls=[];let release;
  s.box.fetch=async url=>{calls.push(url);if(calls.length===1)await new Promise(resolve=>release=resolve);return s.response(url);};
  const pending=s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender);await refreshTurn();
  await s.feeds.handle({type:'groupFeed:leave'},s.sender);
  if(stop==='setting')s.data.settings={backgroundGroupChecks:false};
  if(stop==='closed')s.box.browser.tabs.query=async()=>[];
  if(stop==='removed')s.data['channelGroups:v1'].groups=[];
  release();await s.finish(pending);assert.equal(calls.length,1,stop);
 }
});
test('background sweeps ignore warm channels before applying the sweep limit, and do nothing during a cooldown',async()=>{
 const s=refreshHarness(205),calls=[];s.load('request-log.js');
 for(const id of s.ids.slice(0,200))s.data['channelUploads:v1'].channels[id]={attemptedAt:s.clock.now,entries:[]};
 s.box.fetch=async url=>{calls.push(url);return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,5);
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,5);
 const before=JSON.stringify((await s.box.YouTubeRequestLog.snapshot()).days);
 s.data['youtubeRequests:v1']={pausedUntil:s.clock.now+900000,pauseScope:'automatic',pauseReason:'feed-failures'};s.load('youtube-requests.js');
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(JSON.stringify((await s.box.YouTubeRequestLog.snapshot()).days),before);
});
test('progress includes cached channels, counts a refreshed channel once, and is shared across tabs',async()=>{
 const s=refreshHarness(3);let release;const calls=[];
 s.data['channelUploads:v1'].channels[s.ids[0]]={attemptedAt:s.clock.now,entries:[]};
 s.box.fetch=async url=>{calls.push(url);if(calls.length===1)await new Promise(resolve=>release=resolve);return s.response(url);};
 const pending=s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender);await refreshTurn();
 const other={...s.sender,tab:{id:2}},shared=s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},other);await refreshTurn();
 let refresh=(await s.feeds.handle({type:'groupFeed:get',groupId:'all'},other)).refresh;
 assert.equal(refresh.total,3);assert.equal(refresh.checked,1);assert.equal(refresh.cached,1);assert.equal(refresh.running,true);
 release();await s.finish(Promise.all([pending,shared]));
 refresh=s.data['groupRefreshProgress:v1'].all;assert.equal(refresh.checked,3);assert.equal(refresh.cached,1);assert.equal(refresh.refreshed,2);assert.equal(refresh.running,false);assert.equal(calls.length,2);
});
test('progress stops at the actual count when server cooldown leaves channels unattempted',async()=>{
 const s=refreshHarness(7);s.box.fetch=async url=>s.response(url,429);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all'},s.sender));
 const state=s.data['groupRefreshProgress:v1'].all;assert.equal(state.total,7);assert.equal(state.checked,1);assert.equal(state.failed,1);assert.equal(state.paused,true);assert.equal(state.running,false);
});
test('automatic group visits reuse two-hour caches without progress runs or diagnostic cache attempts',async()=>{
 const s=refreshHarness(3);s.load('request-log.js');let calls=0;s.box.fetch=async url=>{calls++;return s.response(url);};
 for(const id of s.ids)s.data['channelUploads:v1'].channels[id]={attemptedAt:s.clock.now-30*60000,fetchedAt:s.clock.now-30*60000,entries:[{videoId:'a'.repeat(11),channelId:id,title:'Cached',publishedAt:1}]};
 for(let i=0;i<5;i++){
  await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));
  assert.equal((await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender)).refresh,null);
 }
 assert.equal(calls,0);assert.equal(s.data['groupRefreshProgress:v1'],undefined);assert.deepEqual(Object.keys((await s.box.YouTubeRequestLog.snapshot()).days),[]);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls,3,'Manual Refresh can update before the two-hour interval');
});
test('automatic uploads stay at background pace while visible, including after cache reads and repeated visits',async()=>{
 const s=refreshHarness(3),calls=[];s.load('request-log.js');let release;
 const videoId='a'.repeat(11);s.data['channelUploads:v1'].channels[s.ids[0]]={attemptedAt:1,entries:[{videoId,channelId:s.ids[0],title:'Visible',publishedAt:s.clock.now,views:{count:10,checkedAt:s.clock.now},details:{status:'available',duration:100,shorts:false,checkedAt:s.clock.now}}]};
 s.box.fetch=async url=>{calls.push({url,at:s.clock.now});if(calls.length===1)await new Promise(resolve=>release=resolve);return s.response(url);};
 const pending=s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender);await refreshTurn();
 await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);
 const details=s.feeds.handle({type:'groupFeed:details',groupId:'all',videoIds:[videoId],checkViews:true},s.sender);
 const same=s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender);await refreshTurn();
 release();await s.finish(Promise.all([pending,same,details]));
 assert.equal(calls.length,3);assert.ok(calls.slice(1).every((call,i)=>call.at-calls[i].at>=10000));assert.ok((await s.box.YouTubeRequestLog.snapshot()).recent.every(e=>e.mode==='background'));
 const progress=JSON.stringify(s.data['groupRefreshProgress:v1']);s.clock.now+=30*60000;
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls.length,3);assert.equal(JSON.stringify(s.data['groupRefreshProgress:v1']),progress);
 s.clock.now+=2*3600000;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls.length,6);
});
test('automatic group refresh honors opt-out and error cooldowns without starting a progress run',async()=>{
 const s=refreshHarness(2);let calls=0;s.box.fetch=async url=>{calls++;return s.response(url);};
 s.data.settings={backgroundGroupChecks:false};await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls,0);assert.equal(s.data['groupRefreshProgress:v1'],undefined);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls,2);
 s.data.settings.backgroundGroupChecks=true;
 for(const id of s.ids)Object.assign(s.cache(id),{error:'Timed out',attemptedAt:s.clock.now-30*60000,retryAt:s.clock.now-15*60000});
 const before=JSON.stringify(s.data['groupRefreshProgress:v1']);await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls,2);assert.equal(JSON.stringify(s.data['groupRefreshProgress:v1']),before);
});

const DAY=86400000;
test('daily checks require a successful check confirming 90 days of inactivity, including legacy caches',()=>{
 const now=200*DAY,old={fetchedAt:now,latestUploadAt:now-90*DAY,entries:[]};
 assert.equal(GroupFeeds.automaticInterval(old,now),DAY);
 assert.equal(GroupFeeds.automaticInterval({...old,latestUploadAt:old.latestUploadAt+1},now),2*3600000);
 assert.equal(GroupFeeds.automaticInterval({fetchedAt:now,entries:[{publishedAt:now-100*DAY}]},now),DAY);
 assert.equal(GroupFeeds.automaticInterval({fetchedAt:now,entries:[]},now),2*3600000,'An empty feed has unknown activity');
 assert.equal(GroupFeeds.automaticInterval({entries:[{publishedAt:1}],error:'Unreadable',attemptedAt:now},now),2*3600000,'Failed or unverified old data cannot establish inactivity');
 assert.equal(GroupFeeds.automaticInterval({fetchedAt:now-120*DAY,latestUploadAt:now-121*DAY,error:'Offline'},now),2*3600000,'A once-active channel does not become inactive merely because later checks failed');
 assert.equal(GroupFeeds.automaticInterval({...old,entries:[{publishedAt:now-DAY}]},now),2*3600000,'Newer known uploads take precedence');
});
test('latest upload evidence survives cache eviction and failed checks, and a recent upload restores frequent checks',()=>{
 const now=Date.now(),entry={videoId:'a'.repeat(11),channelId:A,title:'Old upload',publishedAt:now-100*DAY};
 let cache=GroupFeeds.merge(null,A,[entry],now);
 assert.equal(cache.channels[A].latestUploadAt,entry.publishedAt);
 // Other channels fill the global video budget, evicting this channel's videos.
 for(let c=0;c<20;c++)cache=GroupFeeds.merge(cache,'channel'+c,Array.from({length:250},(_,i)=>({videoId:String(c*250+i).padStart(11,'0'),channelId:'channel'+c,title:'Newer',publishedAt:now-DAY})),now);
 assert.equal(cache.channels[A].entries.length,0);assert.equal(GroupFeeds.automaticInterval(cache.channels[A],now),DAY);
 cache=GroupFeeds.merge(cache,A,undefined,now+DAY,'Offline');assert.equal(cache.channels[A].latestUploadAt,entry.publishedAt);assert.equal(GroupFeeds.automaticInterval(cache.channels[A],now+DAY),DAY);
 cache=GroupFeeds.merge(cache,A,[{...entry,videoId:'b'.repeat(11),publishedAt:now+DAY-3600000,publishedAtEstimated:true}],now+DAY);
 assert.equal(GroupFeeds.automaticInterval(cache.channels[A],now+DAY),2*3600000);
});
test('approximate fallback ages cannot move a known latest-upload date forward',()=>{
 const now=Date.now(),entry={videoId:'a'.repeat(11),channelId:A,title:'Known upload',publishedAt:now-100*DAY};
 const saved=GroupFeeds.merge(null,A,[entry],now);
 const exact=GroupFeeds.merge(saved,A,[{...entry,publishedAt:now-89*DAY,publishedAtEstimated:true}],now+DAY);
 assert.equal(exact.channels[A].latestUploadAt,entry.publishedAt);assert.equal(GroupFeeds.automaticInterval(exact.channels[A],now+DAY),DAY);
 const estimated=GroupFeeds.merge(null,A,[{...entry,publishedAtEstimated:true}],now);
 const repeated=GroupFeeds.merge(estimated,A,[{...entry,publishedAt:entry.publishedAt+DAY,publishedAtEstimated:true}],now+DAY);
 assert.equal(repeated.channels[A].latestUploadAt,entry.publishedAt);
});
test('inactive channels skip automatic group visits and sweeps until daily due time, then resume two-hour checks after a new upload',async()=>{
 const s=refreshHarness(2),[old,active]=s.ids,start=s.clock.now,calls=[];
 s.data['channelUploads:v1'].channels={
  [old]:{fetchedAt:start-3*3600000,attemptedAt:start-3*3600000,entries:[],latestUploadAt:start-100*DAY},
  [active]:{fetchedAt:start-3*3600000,attemptedAt:start-3*3600000,entries:[],latestUploadAt:start-DAY}
 };
 s.box.fetch=async url=>{const id=new URL(url).searchParams.get('channel_id');calls.push(id);return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.deepEqual(calls,[active]);
 let data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.channels[0].dailyChecks,true);assert.equal(data.channels[1].dailyChecks,false);
 assert.equal(data.refresh.total,1);assert.equal(data.refresh.cached,0);assert.equal(data.refresh.refreshed,1);
 // Worker reloads must not lose the saved inactivity evidence or reset its timer.
 s.load('group-feeds.js');await s.finish(s.box.GroupFeeds.handle({type:'groupFeed:checkAll'},s.sender));assert.deepEqual(calls,[active]);
 s.clock.now=start+21*3600000-1;await s.finish(s.feeds.getChannelUploads(old,false,true));assert.deepEqual(calls,[active]);
 s.clock.now++;
 s.box.fetch=async url=>{const id=new URL(url).searchParams.get('channel_id');calls.push(id);const body=`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${id}</yt:channelId><title>Returned creator</title><entry><yt:videoId>aaaaaaaaaaa</yt:videoId><yt:channelId>${id}</yt:channelId><title>New upload</title><published>${new Date(s.clock.now-3600000).toISOString()}</published></entry></feed>`;return {...s.response(url),text:async()=>body};};
 await s.finish(s.feeds.getChannelUploads(old,false,true));assert.deepEqual(calls,[active,old]);
 data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.channels[0].dailyChecks,false);assert.ok(data.entries.some(e=>e.title==='New upload'));
 s.clock.now+=2*3600000;await s.finish(s.feeds.getChannelUploads(old,false,true));assert.deepEqual(calls,[active,old,old]);
});
test('manual Refresh can check an inactive channel early but still respects server pauses',async()=>{
 const s=refreshHarness(),id=s.ids[0],now=s.clock.now;let calls=0;
 s.data['channelUploads:v1'].channels[id]={fetchedAt:now-3*3600000,attemptedAt:now-3*3600000,entries:[],latestUploadAt:now-100*DAY};
 s.box.fetch=async url=>{calls++;return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls,0);
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls,1);
 s.clock.now+=60000;s.box.fetch=async url=>{calls++;return s.response(url,429);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls,2);
 s.clock.now+=60000;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls,2);
});

test('automatic group visits and sweeps share predictions, late retries and persisted evidence across reloads',async()=>{
 const s=refreshHarness(),id=s.ids[0],H=3600000,M=60000,expected=s.clock.now+H,last=expected-7*DAY,calls=[];
 const entries=Array.from({length:8},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:id,title:'Weekly',publishedAt:last-i*7*DAY}));
 s.data['channelUploads:v1']=s.feeds.merge(null,id,entries,s.clock.now-3*H);
 s.box.fetch=async url=>{calls.push(s.clock.now);return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,0);
 let data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.channels[0].checkSchedule.expectedAt,expected);assert.equal(data.channels[0].checkSchedule.label,'Adaptive checks');
 s.clock.now=expected+15*M;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,1);
 s.load('group-feeds.js');s.feeds=s.box.GroupFeeds;
 s.clock.now=expected+74*M;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls.length,1);
 s.clock.now=expected+75*M;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls.length,2,'Late retry must not wait for the regular two-hour cache');
 data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.channels[0].checkSchedule.mode,'late');
 assert.equal(s.cache(id).uploadHistory.length,8);
 s.clock.now+=M;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender));assert.equal(calls.length,3,'Manual refresh stays available');
});

test('confirmed late checks recover from a failed follow-up across worker reloads while respecting server pauses',async()=>{
 const s=refreshHarness(),id=s.ids[0],H=3600000,M=60000,expected=s.clock.now,last=expected-7*DAY,calls=[];
 const entries=Array.from({length:8},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:id,title:'Weekly',publishedAt:last-i*7*DAY}));
 s.data['channelUploads:v1']=s.feeds.merge(null,id,entries,expected-2*H);
 s.box.fetch=async url=>{
  calls.push(s.clock.now);
  if(calls.length===2)throw Object.assign(Error('Timeout'),{name:'TimeoutError'});
  return calls.length===4?s.response(url,429,String(4*3600)):s.response(url);
 };
 const sweep=()=>s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));
 const visit=()=>s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));
 s.clock.now=expected+15*M;await sweep();assert.equal(calls.length,1);
 s.clock.now=expected+75*M;await visit();assert.equal(calls.length,2);assert.ok(s.cache(id).error);
 assert.equal(s.cache(id).fetchedAt,expected+15*M);
 s.load('youtube-requests.js');s.load('group-feeds.js');s.feeds=s.box.GroupFeeds;
 s.clock.now=expected+194*M;await visit();await sweep();assert.equal(calls.length,2,'Visits cannot bypass the late retry delay');
 s.clock.now=expected+195*M;await sweep();assert.equal(calls.length,3,'A timeout must not skip the +195-minute check');
 assert.equal(s.cache(id).fetchedAt,s.clock.now);assert.equal(s.cache(id).error,'');
 s.clock.now=expected+315*M;await visit();assert.equal(calls.length,4);assert.match(s.cache(id).error,/429/);
 const retryAt=s.cache(id).retryAfter;assert.equal(retryAt,expected+555*M);
 s.clock.now=expected+435*M;await sweep();await visit();assert.equal(calls.length,4,'Late monitoring cannot bypass Retry-After or the global pause');
 s.clock.now=retryAt;await visit();assert.equal(calls.length,5);assert.equal(s.cache(id).error,'');
 assert.equal(s.feeds.automaticSchedule(s.cache(id),s.clock.now).nextCheckAt,s.clock.now+2*H);
});

test('a predicted check respects a server pause and opt-out, then a new approximate upload cancels its old clock schedule',async()=>{
 const s=refreshHarness(),id=s.ids[0],expected=s.clock.now,last=expected-7*DAY,H=3600000,calls=[];
 const entries=Array.from({length:8},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:id,title:'Weekly',publishedAt:last-i*7*DAY}));
 s.data['channelUploads:v1']=s.feeds.merge(null,id,entries,s.clock.now-3*H);
 s.box.fetch=async url=>{calls.push(url);return s.response(url,429);};
 s.clock.now=expected+H/4;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,1);
 s.clock.now+=H;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,1);
 s.data.settings={backgroundGroupChecks:false};s.clock.now+=2*DAY;await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,1);
 s.data['channelUploads:v1']=s.feeds.merge(s.data['channelUploads:v1'],id,[{videoId:'aaaaaaaaaaa',channelId:id,title:'Unexpected new upload',publishedAt:s.clock.now-H,publishedAtEstimated:true}],s.clock.now);
 const plan=s.feeds.automaticSchedule(s.cache(id),s.clock.now);assert.equal(plan.expectedAt,null);assert.equal(plan.interval,2*H);
});

test('a large group opens with five due priority checks, leaving inactive, fresh and retry-protected channels alone',async()=>{
 const s=refreshHarness(14),now=s.clock.now,H=3600000,calls=[],cache=s.data['channelUploads:v1'].channels;
 const seed=(index,age=DAY,attempt=3*H)=>cache[s.ids[index]]={entries:[],fetchedAt:now-attempt,attemptedAt:now-attempt,latestUploadAt:now-age};
 seed(0,100*DAY,26*H);seed(1,DAY,H);Object.assign(seed(2),{error:'Timeout',retryAfter:now+H});
 seed(3,45*DAY);seed(4, -DAY);
 for(const i of [5,6,7,8,9])seed(i);
 cache[s.ids[9]].uploadHistory=Array.from({length:4},(_,i)=>({videoId:String(i).padStart(11,'0'),publishedAt:now-DAY-i*6*H}));
 // A weekly upload was expected 20 minutes ago, even though the baseline daily check is not due.
 const id=s.ids[13],latest=now-20*60000-7*DAY;
 cache[id]=s.feeds.merge(null,id,Array.from({length:8},(_,i)=>({videoId:String(i).padStart(11,'0'),channelId:id,title:'Weekly',publishedAt:latest-i*7*DAY})),now-3*H).channels[id];
 s.box.fetch=async url=>{calls.push(new URL(url).searchParams.get('channel_id'));return s.response(url);};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));
 assert.deepEqual(calls,[id,s.ids[9],...s.ids.slice(5,8)]);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.refresh.total,5);assert.equal(data.refresh.refreshed,5);
 assert.equal(s.cache(s.ids[0]).attemptedAt,now-26*H,'An overdue inactive channel belongs in background work');
});

test('visit allowances survive overlapping groups, tabs and worker reloads, and unused room is filled only by due channels',async()=>{
 const s=refreshHarness(20),calls=[];s.data['channelGroups:v1'].groups[0].channelIds=s.ids.slice(0,2);
 s.box.fetch=async url=>{calls.push(new URL(url).searchParams.get('channel_id'));return s.response(url);};
 const visit=(groupId,tabId=1)=>s.feeds.handle({type:'groupFeed:refresh',groupId,automatic:true},{...s.sender,tab:{id:tabId}});
 await s.finish(visit('all'));assert.deepEqual(calls,s.ids.slice(0,2));
 await s.finish(Promise.all([visit('other',2),visit('other',3)]));assert.equal(calls.length,5);assert.equal(new Set(calls).size,5);
 s.load('group-feeds.js');s.feeds=s.box.GroupFeeds;
 await s.finish(visit('other',4));assert.equal(calls.length,5,'Reloading cannot reset the shared allowance');
 s.clock.now+=30*60000;await s.finish(visit('other'));assert.equal(calls.length,10);assert.equal(new Set(calls).size,10);
});

test('background batches reserve independent capacity and rotate through the oldest quiet channels',async()=>{
 const s=refreshHarness(24),now=s.clock.now,H=3600000,calls=[],cache=s.data['channelUploads:v1'].channels;
 for(const [i,id] of s.ids.entries())cache[id]={entries:[],fetchedAt:now-(i<6?100*H:3*H),attemptedAt:now-(i<6?100*H:3*H),latestUploadAt:now-(i<6?120:1)*DAY};
 s.box.fetch=async url=>{calls.push(new URL(url).searchParams.get('channel_id'));return s.response(url);};
 const visit=()=>s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender),sweep=()=>s.feeds.handle({type:'groupFeed:checkAll'},s.sender);
 await s.finish(Promise.all([visit(),sweep()]));assert.equal(calls.length,10);assert.equal(new Set(calls).size,10);
 assert.ok(s.ids.slice(0,2).every(id=>calls.includes(id)),'Two background slots must reach overdue quiet creators');
 await s.finish(Promise.all([visit(),sweep()]));assert.equal(calls.length,10);
 s.clock.now+=30*60000;await s.finish(sweep());assert.equal(calls.length,15);assert.ok(s.ids.slice(2,4).every(id=>calls.includes(id)));
 s.clock.now+=30*60000;await s.finish(sweep());assert.equal(calls.length,20);assert.ok(s.ids.slice(4,6).every(id=>calls.includes(id)));
});

test('manual refresh during a priority batch checks the whole group and retains the recent-attempt floor',async()=>{
 const s=refreshHarness(12),calls=[];let release;
 s.box.fetch=async url=>{calls.push(new URL(url).searchParams.get('channel_id'));if(calls.length===1)await new Promise(resolve=>release=resolve);return s.response(url);};
 const automatic=s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender);await refreshTurn();assert.equal(calls.length,1);
 const manual=s.feeds.handle({type:'groupFeed:refresh',groupId:'all',force:true},s.sender);release();await s.finish(Promise.all([automatic,manual]));
 assert.deepEqual(new Set(calls),new Set(s.ids));assert.equal(calls.length,12);
 const data=await s.feeds.handle({type:'groupFeed:get',groupId:'all'},s.sender);assert.equal(data.refresh.total,12);assert.equal(data.refresh.checked,12);assert.equal(data.refresh.cached,5);
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,12,'Manual results also satisfy background checks');
});

test('automatic reservations stop at server pauses and cannot be replenished by repeated visits',async()=>{
 const s=refreshHarness(12),calls=[];
 s.box.fetch=async url=>{calls.push(url);return s.response(url,429,'60');};
 await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'all',automatic:true},s.sender));assert.equal(calls.length,1);
 s.clock.now+=2*60000;await s.finish(s.feeds.handle({type:'groupFeed:refresh',groupId:'other',automatic:true},s.sender));assert.equal(calls.length,1);
 assert.equal(s.data['groupAutomaticChecks:v1'].checks.length,5,'Cancelled reservations remain bounded until the window expires');
 s.data.settings={backgroundGroupChecks:false};s.clock.now+=30*60000;
 await s.finish(s.feeds.handle({type:'groupFeed:checkAll'},s.sender));assert.equal(calls.length,1);
});
