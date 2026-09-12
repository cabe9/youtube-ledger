const {test}=require('node:test'),assert=require('node:assert/strict');
require('./group-feeds.js');
const H=3600000,D=24*H,M=60000,A='UC'+'a'.repeat(22),last=Date.parse('2026-09-11T22:00:00Z');
const dates=(period=7*D,count=8,end=last)=>Array.from({length:count},(_,i)=>end-i*period);
const entry=at=>({videoId:String(Math.floor(at/1000)).padStart(11,'0'),channelId:A,channel:'Fixture',title:'Upload',publishedAt:at});
const state=(uploads=dates(),at=last+H)=>GroupFeeds.merge(null,A,uploads.map(entry),at).channels[A];
const schedule=(c,at)=>GroupFeeds.automaticSchedule(c,at);
const update=(c,uploads,at,error='')=>GroupFeeds.merge({version:1,channels:{[A]:c}},A,error?undefined:uploads.map(entry),at,error).channels[A];

test('weekly and daily patterns reduce routine checks; sparse and approximate histories do not predict',()=>{
 const weekly=schedule(state(),last+H);assert.equal(weekly.mode,'predicted');assert.equal(weekly.interval,D);assert.equal(weekly.expectedAt,last+7*D);
 const daily=schedule(state(dates(D)),last+H);assert.equal(daily.interval,6*H);assert.equal(daily.expectedAt,last+D);
 assert.equal(schedule(state(dates(30*D)),last+H).interval,D);assert.equal(schedule(state(dates(30*D)),last+H).expectedAt,null,'No monthly calendar prediction');
 assert.equal(schedule(state(dates(7*D,5)),last+H).interval,2*H);
 const rounded=state();rounded.uploadHistory.forEach(v=>v.publishedAtEstimated=true);rounded.entries.forEach(v=>v.publishedAtEstimated=true);
 assert.equal(schedule(rounded,last+H).mode,'regular');
 const future=state(dates(7*D,8,last+D),last+H);assert.equal(schedule(future,last+H).mode,'regular');
 const unconfirmed={...state(),fetchedAt:undefined};assert.equal(schedule(unconfirmed,last+H).mode,'regular');
 const duplicate=state(Array(12).fill(last));assert.equal(schedule(duplicate,last+H).mode,'regular');
});

test('a predicted release gets bounded late follow-ups, then daily fallback until the next window',()=>{
 const expected=last+7*D;let c=state(dates(),expected-2*H);
 assert.equal(schedule(c,expected).nextCheckAt,expected+15*M);
 c=update(c,[],expected+15*M);
 let plan=schedule(c,expected+15*M);assert.equal(plan.mode,'late');assert.equal(plan.nextCheckAt,expected+75*M);
 c=update(c,[],expected+75*M);assert.equal(schedule(c,expected+75*M).nextCheckAt,expected+195*M);
 c=update(c,[],expected+195*M);assert.equal(schedule(c,expected+195*M).nextCheckAt,expected+315*M);
 c=update(c,[],expected+23*H);plan=schedule(c,expected+D);assert.equal(plan.mode,'predicted');assert.equal(plan.interval,D);assert.equal(plan.expectedAt,expected+7*D);
 assert.equal(plan.nextCheckAt,expected+47*H,'The late window must not turn into indefinite two-hour checks');
});

test('late arrivals end extra checks without moving the learned clock for a single exception',()=>{
 const expected=last+7*D;
 for(const delay of [H,3*H,20*H]){
  let c=state(dates(),expected+15*M);c=update(c,[expected+delay],expected+delay+M);
  const plan=schedule(c,expected+delay+M);assert.equal(plan.mode,'predicted');assert.equal(plan.interval,D);
  assert.equal(plan.expectedAt,expected+7*D,'One late upload does not rewrite the weekly phase');
 }
});

test('sleeping past several late targets results in one check, with no catch-up burst',()=>{
 const expected=last+7*D,awake=expected+12*H;let c=state(dates(),expected-D);
 assert.ok(schedule(c,awake).nextCheckAt<=awake);
 c=update(c,[],awake);assert.equal(schedule(c,awake).nextCheckAt,awake+2*H);
 const skipped=expected+4*D;assert.equal(schedule(c,skipped).mode,'predicted');
 c=update(c,[],skipped);assert.equal(schedule(c,skipped).nextCheckAt,skipped+D);
});

test('network errors cannot trigger a late-upload retry and existing error deadlines are retained',()=>{
 const expected=last+7*D;let c=state(dates(),expected-D);
 c=update(c,[],expected+15*M,'HTTP 503');
 const plan=schedule(c,expected+15*M);assert.notEqual(plan.mode,'late');assert.equal(plan.nextCheckAt,expected+15*M+D);
 c.retryAfter=expected+3*D;assert.equal(schedule(c,expected+H).nextCheckAt,c.retryAfter);
 assert.equal(c.fetchedAt,expected-D);
});

test('failed follow-ups preserve the confirmed late window and apply retry deadlines',()=>{
 const expected=last+7*D;let c=state(dates(),expected-2*H);
 c=update(c,[],expected+15*M);
 c=update(c,[],expected+75*M,'Timeout');
 let plan=schedule(c,expected+75*M);
 assert.equal(plan.mode,'late');assert.equal(plan.expectedAt,expected);assert.equal(plan.interval,2*H);
 assert.equal(plan.nextCheckAt,expected+195*M,'A failed follow-up must not defer checking by a day');
 assert.equal(c.fetchedAt,expected+15*M,'A failure is not evidence of another missing upload');
 c=JSON.parse(JSON.stringify(c));assert.equal(schedule(c,expected+194*M).nextCheckAt,plan.nextCheckAt,'Reloads and visits do not advance the window');
 c.retryAt=expected+240*M;assert.equal(schedule(c,expected+195*M).nextCheckAt,c.retryAt);
 c.retryAfter=expected+300*M;assert.equal(schedule(c,expected+195*M).nextCheckAt,c.retryAfter);
 c=update(c,[],expected+300*M,'Timeout');plan=schedule(c,expected+300*M);
 assert.equal(plan.mode,'late');assert.equal(plan.expectedAt,expected);assert.equal(plan.nextCheckAt,expected+420*M);
 assert.equal(c.fetchedAt,expected+15*M);
 c=update(c,[],expected+420*M);assert.equal(schedule(c,expected+420*M).nextCheckAt,expected+540*M,'Recovery does not replay missed targets');
 c=update(c,[expected+500*M],expected+540*M);assert.equal(schedule(c,expected+540*M).mode,'predicted','A late upload ends follow-ups after recovery');
});

test('failures and long retry deadlines cannot extend a confirmed late window',()=>{
 const expected=last+7*D;let c=state(dates(),expected+15*M);
 c=update(c,[],expected+23*H,'Timeout');
 const end=schedule(c,expected+D);assert.equal(end.mode,'predicted');assert.equal(end.interval,D);assert.equal(end.nextCheckAt,expected+47*H);
 c.retryAfter=expected+3*D;assert.equal(schedule(c,expected+23*H).nextCheckAt,c.retryAfter);
 assert.equal(schedule(c,expected+2*D).nextCheckAt,c.retryAfter);
 assert.equal(c.fetchedAt,expected+15*M);
});

test('unexpected early releases speed checks up promptly; a repeated new weekly time replaces the old phase',()=>{
 let c=state();const early=last+2*D;
 c=update(c,[early],early+M);assert.equal(schedule(c,early+M).mode,'activity');assert.equal(schedule(c,early+M).interval,2*H);
 const replacement=last+5*D;
 for(let i=0;i<8;i++){const at=replacement+i*7*D;c=update(c,[at],at+M);}
 const at=replacement+7*7*D,plan=schedule(c,at+M);
 assert.equal(plan.mode,'predicted');assert.equal(plan.expectedAt,at+7*D);assert.equal(plan.interval,D);
});

test('a daily event is learned, fades when activity stops, and a later return to weekly uploads is recognized',()=>{
 let c=state();
 for(let i=1;i<=9;i++){const at=last+i*D;c=update(c,[at],at+M);if(i===1)assert.equal(schedule(c,at+M).interval,2*H);}
 const end=last+9*D;assert.equal(schedule(c,end+M).interval,6*H);assert.equal(schedule(c,end+M).expectedAt,end+D);
 c=update(c,[],end+8*D);assert.equal(schedule(c,end+8*D).interval,12*H);assert.equal(schedule(c,end+8*D).expectedAt,null);
 c=update(c,[],end+31*D);assert.equal(schedule(c,end+31*D).interval,D);
 for(let i=1;i<=8;i++){const at=end+35*D+i*7*D;c=update(c,[at],at+M);}
 const at=end+91*D;assert.equal(schedule(c,at+M).expectedAt,at+7*D);assert.equal(schedule(c,at+M).interval,D);
});

test('old predictions expire and failed checks alone do not establish a quiet period',()=>{
 let c=state();assert.equal(schedule(c,last+22*D).expectedAt,null);
 const daily=state(dates(D));
 c=update(daily,[],last+8*D,'Offline');assert.equal(schedule(c,last+8*D).interval,2*H);
 c=update(daily,[],last+8*D);assert.equal(schedule(c,last+8*D).interval,12*H);
});

test('a return after a long break cannot resurrect an old weekly pattern even at the same clock time',()=>{
 let c=state(),returned=last+15*7*D;
 c=update(c,[],returned-D);assert.equal(schedule(c,returned-D).interval,D);
 c=update(c,[returned],returned+M);assert.equal(schedule(c,returned+M).interval,2*H);assert.equal(schedule(c,returned+M).expectedAt,null);
 c=update(c,[],returned+4*D);assert.equal(schedule(c,returned+4*D).interval,2*H);assert.equal(schedule(c,returned+4*D).expectedAt,null);
});

test('clock clustering crosses midnight and accommodates a repeated one-hour seasonal shift',()=>{
 const midnight=Date.parse('2026-12-30T00:05:00Z'),uploads=dates(D,8,midnight).map((at,i)=>at+(i%2?-10*M:0));
 let c=state(uploads,midnight+H),plan=schedule(c,midnight+H);assert.equal(plan.mode,'predicted');assert.ok(Math.abs(plan.expectedAt-(midnight+D-5*M))<=M);
 c=state(dates(7*D,8,midnight),midnight+H);
 for(let i=1;i<=8;i++){const at=midnight+i*7*D+H;c=update(c,[at],at+M);}
 const at=midnight+56*D+H;assert.equal(schedule(c,at+M).expectedAt,at+7*D);
});

test('upload evidence survives trimming, deduplicates, and can upgrade estimates to exact dates',()=>{
 let c=state(dates(7*D,40));assert.equal(c.uploadHistory.length,32);
 const expected=schedule(c,last+H).expectedAt;c.entries=[];
 c=update(c,[],last+2*H);assert.equal(c.uploadHistory.length,32);assert.equal(schedule(c,last+2*H).expectedAt,expected);
 const before=JSON.stringify(c.uploadHistory);c=update(c,[],last+3*H,'Timeout');assert.equal(JSON.stringify(c.uploadHistory),before);
 const old=c.uploadHistory[0];
 let cache=GroupFeeds.merge({version:1,channels:{[A]:c}},A,[{...entry(old.publishedAt),publishedAt:old.publishedAt+H,publishedAtEstimated:true}],last+4*H);
 assert.equal(cache.channels[A].uploadHistory[0].publishedAt,old.publishedAt);assert.equal(cache.channels[A].uploadHistory[0].publishedAtEstimated,undefined);
 const approximate=GroupFeeds.merge(null,A,[{...entry(last),publishedAtEstimated:true}],last+H);
 cache=GroupFeeds.merge(approximate,A,[entry(last)],last+2*H);assert.equal(cache.channels[A].uploadHistory[0].publishedAtEstimated,undefined);
 // A new rounded upload cannot leave a stale, precise schedule in charge.
 cache=GroupFeeds.merge({version:1,channels:{[A]:state()}},A,[{...entry(last+D),publishedAtEstimated:true}],last+D+H);
 assert.equal(schedule(cache.channels[A],last+D+H).mode,'regular');
});

test('an exact correction of a rounded latest date enables prediction without retaining the old estimate',()=>{
 const exact=dates().map(entry),approximate=exact.map((v,i)=>i===0?{...v,publishedAt:v.publishedAt+H,publishedAtEstimated:true}:v);
 let cache=GroupFeeds.merge(null,A,approximate,last+2*H);assert.equal(schedule(cache.channels[A],last+2*H).mode,'regular');
 cache.channels[A].entries=[]; // Only bounded evidence remains after trimming.
 cache=GroupFeeds.merge(cache,A,exact,last+3*H);
 assert.equal(cache.channels[A].latestUploadAt,last);assert.equal(schedule(cache.channels[A],last+3*H).expectedAt,last+7*D);
});

function simulate(period,delay=0,missing=false){
 let c=state(dates(period),last+15*M);const calls=[],uploads=dates(period);
 for(let at=last+30*M;at<=last+14*D+H;at+=30*M){
   if(at<schedule(c,at).nextCheckAt)continue;
   for(let release=last+period;release<=at;release+=period)if(!missing&&release+delay<=at&&!uploads.includes(release+delay))uploads.push(release+delay);
   calls.push(at);c=update(c,uploads,at);
 }
 return calls;
}
test('two-week simulations save requests on weekly/daily releases and bound skipped-release checking',t=>{
 const baseline=14*12,weekly=simulate(7*D),daily=simulate(D),skipped=simulate(7*D,0,true),late=simulate(7*D,H);
 t.diagnostic(JSON.stringify({baseline,weekly:weekly.length,daily:daily.length,skipped:skipped.length,late:late.length}));
 assert.ok(weekly.length<=18,weekly.length);assert.ok(late.length<=22,late.length);assert.ok(daily.length<baseline*.65,daily.length);assert.ok(skipped.length<baseline*.4,skipped.length);
 for(const calls of [weekly,daily,skipped,late])assert.ok(calls.slice(1).every((at,i)=>at-calls[i]>=H),'No catch-up bursts');
 for(const expected of [last+7*D,last+14*D])assert.ok(weekly.some(at=>at>=expected&&at<=expected+45*M),'Discovery near the scheduled time');
});
