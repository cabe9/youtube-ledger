const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../../core.js');require('./account-history.js');require('./account-history-sync.js');require('./account-history-parser.js');require('./account-history-rpc.js');require('./account-history-source.js');
const A=AccountHistory,K=A.keys,M=60000,base=+new Date(2025,5,10,12);
const event=(id='aaaaaaaaaaa',at=base,extra={})=>A.normalize({videoId:id,title:'A Short',mediaType:'short',watchedAt:at,videoDurationSeconds:30,sourceOrder:1,...extra},'account');
const direct=(id='aaaaaaaaaaa',start=base,end=base+20000)=>({id:'local:'+start,videoId:id,title:'Direct title',start,end,seconds:{foreground:20,backgroundAudio:5,backgroundSilent:0,paused:0,browsing:0,ad:0}});
function storage(initial={}) {
  const data=structuredClone(initial);
  return {data,get:async keys=>structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]]))),set:async value=>Object.assign(data,structuredClone(value)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys]) delete data[key];}};
}
function setup(read,initial={}) {
  const local=storage({[K.config]:{enabled:true,revision:1},...initial}),session=storage();
  const api={storage:{local,session},permissions:{contains:async()=>true},tabs:{get:async()=>({url:'https://myactivity.google.com/product/youtube'}),remove:async()=>{}}};
  let clock=base+24*60*M;
  const service=AccountHistorySync.create(api,{read},()=>clock);
  return {service,api,data:local.data,advance:ms=>clock+=ms,now:()=>clock};
}
const result=(events=[event()])=>({accountKey:'account',events,coverage:{sinceDay:'2025-06-04'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('normalize validates IDs, rebuilds safe URLs, preserves minute precision and unknown duration',()=>{
  const e=event(undefined,base+59999,{url:'javascript:alert(1)',device:'iOS',videoDurationSeconds:null,channelId:'bad'});
  assert.equal(e.watchedAt,base);assert.equal(e.timestampPrecision,'minute');assert.equal(e.device,'iOS');
  assert.equal(e.videoDurationSeconds,null);assert.equal(e.watchedSeconds,null);assert.equal(e.channelId,null);
  assert.equal(e.url,'https://www.youtube.com/shorts/aaaaaaaaaaa');assert.equal(e.trackingMethod,'account-history');
  assert.equal(A.normalize({videoId:'bad'}),null);assert.equal(event(undefined,base,{mediaType:'ad'}),null);
  assert.equal(A.parseDuration('1:02:03'),3723);assert.equal(A.parseDuration('0:19'),19);
  for (const text of ['LIVE','','3:99','1 minute',null]) assert.equal(A.parseDuration(text),null);
  assert.equal(A.parseWatchTime('2025-06-10','12:00 AM'),+new Date(2025,5,10,0));
  assert.equal(A.parseWatchTime('2025-06-10','12:00 PM • Details'),base);
  assert.equal(A.parseWatchTime('2025-02-31','12:00 PM'),null);
});
test('repeat imports are idempotent, preserving device metadata; later rewatches survive',()=>{
  const first=event(undefined,base,{device:'iOS'}),second=event(undefined,base+10*M);
  const all=A.merge([first],[event(),second]);
  assert.equal(all.length,2);assert.equal(all[0].device,'iOS');
  assert.equal(A.merge(all,[first,second]).length,2);
  assert.notEqual(first.id,event(undefined,base,{occurrence:1}).id,'same-minute duplicate source occurrences have separate IDs');
});
test('minute-overlap reconciliation preserves direct data and does not dedupe by video/day',()=>{
  const row=direct(),original=JSON.stringify(row),later=event(undefined,base+10*M);
  const p=A.project({observations:[event(),later]},[row]);
  assert.equal(p.events.length,1);assert.equal(p.events[0].id,later.id);assert.equal(p.matchedDirectCount,1);
  assert.equal(JSON.stringify(row),original);
  assert.equal(A.directMatch(event(),[direct(undefined,base+45000,base+65000)]),true);
  assert.equal(A.directMatch(event(),[direct(undefined,base+M,base+2*M)]),false);
  const parked=direct();parked.seconds.foreground=parked.seconds.backgroundAudio=0;
  assert.equal(A.directMatch(event(),[parked]),false);
  assert.equal(A.project({observations:[event()]},[]).events.length,1);
  assert.equal(A.project({observations:[event()]},[row]).events.length,0,'newly recorded direct playback supersedes cached import without another network sync');
});
test('Shorts threshold is inclusive and active time unions overlaps, excluding idle gaps',()=>{
  const first=event(undefined,base,{videoDurationSeconds:30});
  const next={...event('bbbbbbbbbbb'),watchedAt:base+90000};
  const joined=A.estimateSessions([first,next]);
  assert.equal(joined.length,1);assert.equal(joined[0].eventCount,2);
  assert.equal(joined[0].endTime,base+120000);assert.equal(joined[0].estimatedActiveMinutes,1);
  assert.equal(A.estimateSessions([first,{...next,watchedAt:next.watchedAt+1}]).length,2);
  const tied=A.estimateSessions([first,event('bbbbbbbbbbb',base,{videoDurationSeconds:50})]);
  assert.equal(tied[0].estimatedActiveMinutes,50/60,'same-minute events do not multiply duration');
});
test('normal videos and direct matches interrupt Shorts runs; unknown lengths are not invented',()=>{
  const list=[event(),event('vvvvvvvvvvv',base+M,{mediaType:'video',videoDurationSeconds:1800}),event('bbbbbbbbbbb',base+2*M)];
  const p=A.project({observations:list},[]);
  assert.equal(p.sessions.length,2);assert.equal(p.recoveredVideoCount,1);assert.equal(p.estimatedShortsMinutes,1);
  assert.equal(p.events.find(e=>e.mediaType==='video').watchedSeconds,null);
  list[1]={...list[1],mediaType:'short'};
  assert.equal(A.estimateSessions(list,new Set([list[1].id])).length,2);
  const missing=A.estimateSessions([event(undefined,base,{videoDurationSeconds:null})])[0];
  assert.equal(missing.estimatedActiveMinutes,null);assert.equal(missing.eventCount,1);
  const partial=A.project({observations:[event(),event('bbbbbbbbbbb',base+M,{videoDurationSeconds:null})]});
  assert.equal(partial.sessions.length,1,'joining needs the previous Short length, not the next one');
  assert.equal(partial.sessions[0].estimatedActiveMinutes,null);assert.equal(partial.unestimatedShortCount,2);
});
test('session device is populated only for consistently observed devices, and days split',()=>{
  const a=event(undefined,base,{device:'iOS'}),b=event('bbbbbbbbbbb',base+M,{device:'iOS'});
  assert.equal(A.estimateSessions([a,b])[0].device,'iOS');
  for (const device of [null,'Android']) assert.equal(A.estimateSessions([a,{...b,device}])[0].device,null);
  const late=+new Date(2025,5,10,23,59);
  assert.equal(A.estimateSessions([event(undefined,late),event('bbbbbbbbbbb',late+M)]).length,2);
});
test('freshness uses exact daily/review boundaries and accepts missing/future cache timestamps',()=>{
  assert.equal(A.stale(base,A.minimumSyncInterval,base+A.minimumSyncInterval-1),false);assert.equal(A.stale(base,A.minimumSyncInterval,base+A.minimumSyncInterval),true);
  assert.equal(A.stale(base,5*M,base+5*M),true);assert.equal(A.stale(null,A.minimumSyncInterval,base),true);assert.equal(A.stale(base+1,A.minimumSyncInterval,base),true);
});
test('single flight across clients; late direct writes win without delaying direct storage',async()=>{
  const gate=deferred();let reads=0;
  const {service,data}=setup(async()=>{reads++;return gate.promise;});
  const first=service.sync(),second=service.sync({force:true,maxAgeMs:5*M});
  assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);data['day:'+Ledger.dayKey(base)]=[direct()];
  gate.resolve(result());const done=await first;
  assert.equal(done.cache.lastRecoveredCount,0);assert.equal(A.project(done.cache,[direct()]).events.length,0);assert.equal(done.cache.observations.length,1);
  assert.equal(data[K.status].syncing,false);
});
test('daily automatic checks allow one manual retry per 20-minute window; imports stay idempotent',async()=>{
  let reads=0;const {service,data,advance}=setup(async()=>{reads++;return result();});
  await service.sync();assert.equal(data[K.cache].lastRecoveredCount,1);assert.equal(data[K.cache].sessions.length,1);
  await service.sync();assert.equal(reads,1);
  await service.sync({force:true});assert.equal(reads,2,'one manual check bypasses the daily wait');
  await service.sync({force:true});assert.equal(reads,2);
  advance(20*M);await service.sync();assert.equal(reads,2,'no automatic polling after 20 minutes');
  await service.sync({force:true});assert.equal(reads,3);assert.equal(A.project(data[K.cache]).events.length,1);assert.equal(data[K.cache].lastRecoveredCount,0);
  advance(24*60*M);await service.sync();assert.equal(reads,4);
});
test('a concurrent review cannot bypass the daily automatic budget even with a six-minute-old cache',async()=>{
  let reads=0;const {service}=setup(async()=>{reads++;return result();},{[K.cache]:{observations:[event()],lastSuccessfulSync:base+24*60*M-6*M}});
  const overview=service.sync();const review=service.sync({maxAgeMs:5*M});
  assert.equal(overview,review);await review;assert.equal(reads,0);
});
test('disabling aborts the network signal; re-enabling and worker restart cannot reset the budget',async()=>{
  const gate=deferred();let signal,reads=0;
  const read=async options=>{signal=options.signal;reads++;return gate.promise;};
  const {service,api,now}=setup(read);
  const pending=service.sync({force:true});await new Promise(resolve=>setImmediate(resolve));
  await service.configure(false);assert.equal(signal.aborted,true);
  gate.resolve(result());assert.equal((await pending).cancelled,true);
  await service.configure(true);await service.sync({force:true});assert.equal(reads,1);
  await AccountHistorySync.create(api,{read},now).sync({force:true});assert.equal(reads,1);
});
test('sync failure retains successful timestamp and cached events, with opportunistic failure backoff',async()=>{
  let reads=0;const prior={observations:[event()],lastSuccessfulSync:base};
  const {service,data,advance}=setup(async()=>{reads++;throw new Error('Offline');},{[K.cache]:prior});
  const failed=await service.sync({maxAgeMs:5*M});
  assert.equal(failed.error,'Offline');assert.deepEqual(data[K.cache],prior);assert.equal(data[K.status].syncing,false);
  await service.sync();assert.equal(reads,1);
  await service.sync({force:true});assert.equal(reads,1);
  advance(60*M);await service.sync({force:true});assert.equal(reads,2);
  advance(60*M);await service.sync({force:true});assert.equal(reads,2,'second failure backs off for two hours');
});
test('account imports leave a storage reserve for direct tracking and preserve cache on quota pressure',async()=>{
  const prior={observations:[event()],lastSuccessfulSync:base};
  const {service,api,data}=setup(async()=>result([event('bbbbbbbbbbb')]),{[K.cache]:prior});
  api.storage.local.QUOTA_BYTES=10000000;
  api.storage.local.getBytesInUse=async key=>key===null?9500000:1000;
  assert.match((await service.sync()).error,/space is reserved for direct tracking/);
  assert.deepEqual(data[K.cache],prior);
});
test('disabled mode performs no retrieval; permission denial and account switching do not lose cache',async()=>{
  let reads=0;const {service,api,data}=setup(async()=>{reads++;return {...result(),accountKey:'other'};},{[K.config]:{enabled:false,revision:1},[K.cache]:{accountKey:'account',observations:[event()]}});
  await service.sync({force:true});assert.equal(reads,0);
  api.permissions.contains=async()=>false;await assert.rejects(service.configure(true),/permission/);
  api.permissions.contains=async()=>true;await service.configure(true);
  assert.match((await service.sync()).error,/account changed/);assert.equal(data[K.cache].accountKey,'account');
});
test('disabling during a sync prevents commit; clearing a day during sync prevents reimport',async()=>{
  const gate=deferred();const {service,data}=setup(async()=>gate.promise,{[K.cache]:{observations:[event()]}});
  const pending=service.sync();await new Promise(resolve=>setImmediate(resolve));
  await service.configure(false);gate.resolve(result());assert.equal((await pending).cancelled,true);
  assert.equal(data[K.cache].lastSuccessfulSync,undefined);
  const other=setup(async()=>result(),{[K.cache]:{observations:[event()],events:[event()],sessions:[]}});
  await other.service.clearDay(Ledger.dayKey(base));await other.service.sync();
  assert.equal(other.data[K.cache].observations.length,0);assert.equal(other.data[K.cache].lastRecoveredCount,0);
});

test('refusals pause for 48 hours, then seven days on recurrence, surviving restarts without cache loss',async()=>{
  let reads=0;const prior={observations:[event()],lastSuccessfulSync:base};
  const read=async()=>{reads++;throw Object.assign(new Error('Refused'),{code:'blocked',manualRetry:true,httpStatus:403});};
  const {service,data,api,advance,now}=setup(read,{[K.cache]:prior});
  await service.sync();assert.equal(data[K.status].httpStatus,403);assert.equal(data[K.status].blockedCount,1);
  advance(47*60*M);await service.configure(false);await service.configure(true);
  const restarted=AccountHistorySync.create(api,{read},now);
  await restarted.sync({force:true});assert.equal(reads,1);
  advance(60*M);await service.sync();assert.equal(reads,1,'automatic remains paused');
  await restarted.sync({force:true});assert.equal(reads,2);assert.equal(data[K.status].blockedCount,2);
  assert.equal(data[K.status].nextAllowedAt,now()+7*24*60*M);
  advance(6*24*60*M);await restarted.sync({force:true});assert.equal(reads,2);
  advance(24*60*M);await restarted.sync();assert.equal(reads,2,'no automatic resume after a week');
  await restarted.sync({force:true});assert.equal(reads,3);assert.deepEqual(data[K.cache],prior);
});

test('longer server waits are honored, and only success clears refusal escalation',async()=>{
  let reads=0,retryAfterAt;
  const {service,data,advance,now}=setup(async()=>{
    reads++;
    if(reads===1)throw Object.assign(new Error('Limited'),{code:'blocked',httpStatus:429,retryAfterAt});
    if(reads===2)throw new Error('Offline');
    return result();
  });
  retryAfterAt=now()+10*24*60*M;
  await service.sync();assert.equal(data[K.status].nextAllowedAt,retryAfterAt);
  advance(9*24*60*M);await service.sync({force:true});assert.equal(reads,1);
  advance(24*60*M);await service.sync({force:true});assert.equal(reads,2);
  assert.equal(data[K.status].blockedCount,1);assert.equal(data[K.status].manualRetry,true);
  advance(24*60*M);await service.sync();assert.equal(reads,2);
  await service.sync({force:true});assert.equal(reads,3);assert.equal(data[K.status].blockedCount,0);assert.equal(data[K.status].manualRetry,false);
});

test('an interrupted manual retry cannot clear a prior refusal or enable automatic reads after restart',async()=>{
  let reads=0;const gate=deferred(),read=async()=>{reads++;return gate.promise;};
  const {service,api,data,advance,now}=setup(read,{[K.status]:{error:'HTTP 403',errorCode:'blocked',httpStatus:403,blockedCount:1,manualRetry:true,nextAllowedAt:base}});
  const pending=service.sync({force:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(data[K.status].manualRetry,true);assert.equal(data[K.status].error,'HTTP 403');
  await service.configure(false);gate.resolve(result());assert.equal((await pending).cancelled,true);
  await service.configure(true);advance(3*24*60*M);
  await AccountHistorySync.create(api,{read},now).sync();assert.equal(reads,1);
  assert.equal(data[K.status].httpStatus,403);assert.equal(data[K.status].blockedCount,1);
});

test('Retry-After parses seconds and HTTP dates while invalid or past values are ignored',()=>{
  const parse=AccountHistorySource.retryAfter;
  assert.equal(parse('259200',base),base+3*24*60*M);
  assert.equal(parse(new Date(base+10*24*60*M).toUTCString(),base),base+10*24*60*M);
  for(const value of [null,'','-1','1.5','bogus','Infinity','1e6','0',new Date(base-M).toUTCString()])assert.equal(parse(value,base),0,String(value));
});

test('HTTP failures retain their status and the server Retry-After without another request',async()=>{
  for(const status of [403,429,503]) {
    let calls=0;const before=Date.now();
    await assert.rejects(AccountHistorySource.snapshot('https://myactivity.google.com/product/youtube',null,async()=>{
      calls++;return new Response('',{status,headers:{'retry-after':'259200'}});
    }),error=>error.httpStatus===status && error.retryAfterAt>=before+3*24*60*M && error.retryAfterAt<=Date.now()+3*24*60*M);
    assert.equal(calls,1);
  }
});
const ytHTML=(contents)=>'<script>var ytInitialData = '+JSON.stringify({contents:{twoColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{selected:true,content:{sectionListRenderer:{contents}}}}]}}})+';</script>';
test('initial shelf parser reads offscreen Shorts models, normal lockups and escaped JSON without executing scripts',()=>{
  const contents=[{reelShelfRenderer:{items:Array.from({length:187},(_,i)=>({shortsLockupViewModel:{title:'A } \" title',onTap:{innertubeCommand:{reelWatchEndpoint:{videoId:'s'+String(i).padStart(10,'0')}}}}}))}},
    {lockupViewModel:{contentId:'vvvvvvvvvvv',contentType:'LOCKUP_CONTENT_TYPE_VIDEO'}}];
  const parsed=AccountHistoryParser.youtube(ytHTML(contents));
  assert.equal(Object.values(parsed.classifications).filter(x=>x==='short').length,187);
  assert.equal(parsed.classifications.vvvvvvvvvvv,'video');
  assert.throws(()=>AccountHistoryParser.youtube('<html>Sign in</html>'),/format or sign-in/);
  assert.throws(()=>AccountHistoryParser.youtube('<script>var ytInitialData = {bad};</script>'),/could not be parsed/);
});
test('source makes only sequential first-page GETs with browser-managed credentials and no redirect following',async()=>{
  const calls=[];let active=0;
  const source=AccountHistorySource.create({request:async(url,options)=>{
    assert.equal(active,0);active++;calls.push({url,options});await new Promise(resolve=>setImmediate(resolve));active--;
    const body=url.includes('myactivity') ? '<html>Fixture</html>' : ytHTML([{videoRenderer:{videoId:'aaaaaaaaaaa'}}]);
    return new Response(body,{headers:{'content-type':'text/html'}});
  },parse:async()=>({account:'Google Account: Fixture (fixture@example.test)',cardCount:1,records:[{videoId:'aaaaaaaaaaa',title:'Fixture',watchedAt:base,durationText:'1:20'}]})});
  const read=await source.read({sinceDay:'2025-06-04',knownDevices:{}});
  assert.equal(calls.length,2);assert.equal(read.events.length,1);assert.equal(read.events[0].videoDurationSeconds,80);
  assert.equal(read.events[0].watchedSeconds,null);assert.equal(read.coverage.limited,true);
  for (const {options} of calls) {assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');}
});
test('source stops without retrying after denial, oversized or unexpected responses',async()=>{
  for (const [status,headers,body,code] of [[429,{},'', 'blocked'],[403,{},'', 'blocked'],[200,{'content-type':'text/html','content-length':String(7*1024*1024)},'', 'schema'],[200,{'content-type':'application/json'},'{}','schema']]) {
    let calls=0;const source=AccountHistorySource.create({request:async()=>{calls++;return new Response(body,{status,headers});},parse:async()=>{throw new Error('Parser should not run');}});
    await assert.rejects(source.read({}),error=>error.code===code);assert.equal(calls,1);
  }
});

test('overlap inputs include only recovered imports, never directly tracked browser watches',async()=>{
  const saved=[event(),event('bbbbbbbbbbb',base+10*M)];let options;
  const {service}=setup(async value=>{options=value;return result(saved);},{[K.cache]:{observations:saved},['day:'+Ledger.dayKey(base)]:[direct()]});
  await service.sync();assert.deepEqual(options.knownRecoveredKeys,['bbbbbbbbbbb:'+(base+10*M)]);
});

function rpcRow(id,at=base,extra={}) {
  const row=Array(33).fill(null);row[4]=at*1000;row[7]=['YouTube'];row[9]=['Synthetic title',null,'Watched','https://www.youtube.com/watch?v='+id];
  row[19]=[['iOS']];row[23]=[null,'0:30'];row[32]=[[null,'Fixture Channel',null,'https://www.youtube.com/channel/UC'+'A'.repeat(22)]];
  for(const [key,value] of Object.entries(extra))row[key]=value;
  return row;
}
function bootstrapHTML(data) {
  return '<script>var WIZ_global_data={"SNlM0e":"fixture-csrf","FdrFJe":"fixture-session","cfb2h":"fixture-build"};var AF_dataServiceRequests = {\'ds:5\' : {id:\'y3VFHd\',request:[[null,["youtube"]],null,100,null,[]]}};AF_initDataCallback({key: \'ds:5\',data:'+JSON.stringify(data)+',sideChannel:{}});</script>';
}
const rpcResponse=data=>")]}'\n\n100\n"+JSON.stringify([['wrb.fr','y3VFHd',JSON.stringify(data),null,null,null,'generic']])+'\n';
test('manual RPC codec validates the known YouTube request and decodes only watch metadata',()=>{
  const data=[[rpcRow('aaaaaaaaaaa')],'cursor-one'];
  const context=AccountHistoryRPC.bootstrap(bootstrapHTML(data));
  assert.deepEqual(context.initial,data);
  const next=AccountHistoryRPC.request(context,'cursor-one');
  const url=new URL(next.url),body=new URLSearchParams(next.init.body);
  assert.equal(url.origin,'https://myactivity.google.com');assert.equal(url.searchParams.get('rpcids'),'y3VFHd');
  assert.deepEqual(JSON.parse(JSON.parse(body.get('f.req'))[0][0][1]),[[null,['youtube']],'cursor-one',100,null,[]]);
  const page=AccountHistoryRPC.page(AccountHistoryRPC.response(rpcResponse(data)),{sinceDay:'2025-06-01'},100);
  assert.equal(page.records[0].sourceOrder,100);assert.equal(page.records[0].device,'iOS');assert.equal(page.records[0].channelName,'Fixture Channel');
  assert.equal(page.records[0].durationText,'0:30');assert.equal(page.records[0].watchedAt,base);
  assert.equal(AccountHistoryRPC.page([[rpcRow('aaaaaaaaaaa',base,{9:['Search',null,'Searched for','https://www.youtube.com/results?search_query=x']})],null]).records.length,0);
  assert.throws(()=>AccountHistoryRPC.bootstrap(bootstrapHTML(data).replace('["youtube"]','["other-product"]')),/format changed/);
  assert.throws(()=>AccountHistoryRPC.response('<html>Verification required</html>'),/format changed/);
  assert.throws(()=>AccountHistoryRPC.page([Array(101).fill(rpcRow('aaaaaaaaaaa')),null]),/format changed/);
});
test('manual catch-up is capped at three batches even when cursors and sparse overlap continue',async()=>{
  const batches=[0,1,2,3].map(i=>[[rpcRow(String.fromCharCode(97+i).repeat(11),base-i*M)],'cursor-'+i]);
  let posts=0;const progress=[],calls=[];
  const source=AccountHistorySource.create({request:async(url,options)=>{
    calls.push({url,method:options.method});
    if(options.method==='POST') {const body=new URLSearchParams(options.body);const payload=JSON.parse(JSON.parse(body.get('f.req'))[0][0][1]);assert.equal(payload[1],'cursor-'+posts);posts++;return new Response(rpcResponse(batches[posts]),{headers:{'content-type':'application/json'}});}
    if(url.includes('myactivity'))return new Response(bootstrapHTML(batches[0]),{headers:{'content-type':'text/html'}});
    return new Response(ytHTML(batches.map(data=>({videoRenderer:{videoId:new URL(data[0][0][9][3]).searchParams.get('v')}}))),{headers:{'content-type':'text/html'}});
  },parse:async()=>({account:'Google Account: Fixture (fixture@example.test)',cardCount:1,records:AccountHistoryRPC.page(batches[0]).records})});
  const result=await source.read({sinceDay:'2025-06-01',expanded:true,knownRecoveredKeys:[],onProgress:async phase=>progress.push(phase)});
  assert.equal(posts,2);assert.equal(calls.length,4);assert.equal(result.events.length,3);assert.equal(result.coverage.batchesRead,3);
  assert.equal(result.coverage.stopReason,'batch-limit');assert.equal(result.coverage.completeness,'unknown');
  assert.ok(progress.some(value=>value.includes('batch 3')));assert.equal(JSON.stringify(result).includes('fixture-csrf'),false);
});

test('manual pagination stops at the source end or date boundary without treating either as complete',async()=>{
  for (const scenario of ['source-ended','date-limit']) {
    const first=[[rpcRow('aaaaaaaaaaa')],'cursor-one'];
    const next=scenario==='source-ended' ? [[rpcRow('bbbbbbbbbbb',base-M)],null] : [[rpcRow('bbbbbbbbbbb',base-8*24*60*M)],'cursor-two'];
    let posts=0;
    const source=AccountHistorySource.create({request:async(url,options)=>{
      if(options.method==='POST') {posts++;assert.equal(posts,1);return new Response(rpcResponse(next),{headers:{'content-type':'application/json'}});}
      return new Response(url.includes('myactivity') ? bootstrapHTML(first) : ytHTML([{videoRenderer:{videoId:'aaaaaaaaaaa'}},{videoRenderer:{videoId:'bbbbbbbbbbb'}}]),{headers:{'content-type':'text/html'}});
    },parse:async()=>({account:'Fixture',cardCount:1,records:AccountHistoryRPC.page(first).records})});
    const read=await source.read({sinceDay:'2025-06-04',expanded:true});
    assert.equal(read.coverage.stopReason,scenario);assert.equal(read.coverage.batchesRead,2);assert.equal(read.coverage.completeness,'unknown');
    assert.equal(read.events.length,scenario==='source-ended'?2:1);
  }
});

test('invalid or refused older batches stop the attempt and preserve the successful cache',async()=>{
  for (const scenario of ['repeated-cursor','out-of-order','changed-format','refused']) {
    const first=[[rpcRow('aaaaaaaaaaa')],'cursor-one'];
    const prior={observations:[event()],lastSuccessfulSync:base};let calls=0;
    const source=AccountHistorySource.create({request:async(url,options)=>{
      calls++;
      if(options.method==='GET')return new Response(bootstrapHTML(first),{headers:{'content-type':'text/html'}});
      if(scenario==='refused')return new Response('Refused',{status:429});
      const next=scenario==='changed-format' ? [null,'cursor-two'] : [[rpcRow('bbbbbbbbbbb',base+(scenario==='out-of-order'?M:-M))],scenario==='repeated-cursor'?'cursor-one':'cursor-two'];
      return new Response(rpcResponse(next),{headers:{'content-type':'application/json'}});
    },parse:async()=>({account:'Fixture',cardCount:1,records:AccountHistoryRPC.page(first).records})});
    const {service,data}=setup(options=>source.read(options),{[K.cache]:prior});
    assert.ok((await service.sync({force:true})).error,scenario);
    assert.equal(calls,2,'no retries or classification request after invalid older batch');
    assert.deepEqual(data[K.cache],prior);assert.equal(data[K.status].manualRetry,true);
  }
});


test('reconciliation requires playback evidence, including legacy rows with long pauses',()=>{
 const morning=+new Date(2025,5,10,8),noon=+new Date(2025,5,10,11),evening=+new Date(2025,5,10,17),rows=[];
 for(const start of [morning,evening])Ledger.add(rows,{id:'same-visit',videoId:'aaaaaaaaaaa',title:'Same video',channel:'Channel',url:'https://www.youtube.com/watch?v=aaaaaaaaaaa',start,end:start+4000,state:'foreground'});
 assert.deepEqual(rows[0].playbackIntervals,[[morning,morning+4000],[evening,evening+4000]]);
 assert.equal(A.directMatch(event(undefined,noon),rows),false,'A phone watch during a desktop pause survives');
 assert.equal(A.directMatch(event(undefined,morning),rows),true);assert.equal(A.directMatch(event(undefined,evening),rows),true);
 const legacy=structuredClone(rows);delete legacy[0].playbackIntervals;assert.equal(A.directMatch(event(undefined,noon),legacy),false,'A legacy bounding span cannot prove playback');
 assert.equal(A.directMatch(event(undefined,morning),legacy),false,'Ambiguous old evidence stays conservative');
 const p=A.project({observations:[event(undefined,morning),event(undefined,noon),event(undefined,evening)]},rows);assert.equal(p.matchedDirectCount,2);assert.equal(p.events.length,1);assert.equal(p.events[0].watchedAt,noon);
});
