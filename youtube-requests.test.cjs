const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,turn}=require('./request-test-helpers.cjs');
test('one shared queue prioritizes visible work and spaces background work without overlapping requests',async()=>{
 const s=harness(),calls=[];let active=0,peak=0,release;
 const job=(name,priority)=>s.box.YouTubeRequests.run(async()=>{active++;peak=Math.max(peak,active);calls.push({name,at:s.clock.now});if(name==='first')await new Promise(resolve=>release=resolve);active--;},{priority});
 const first=job('first',0);await turn();
 const background=job('background',0),visible=job('visible',2),manual=job('manual',3);release();
 await s.finish(Promise.all([first,background,visible,manual]));
 assert.deepEqual(calls.map(v=>v.name),['first','manual','visible','background']);assert.equal(peak,1);
 assert.deepEqual(calls.slice(1).map((v,i)=>v.at-calls[i].at),[2000,2000,10000]);
});
test('a visible request interrupts a background wait, and promoted queued work moves forward',async()=>{
 const s=harness(),calls=[];const options={priority:0};
 const job=(name,opts)=>s.box.YouTubeRequests.run(async()=>calls.push({name,at:s.clock.now}),opts);
 await s.finish(job('first',{priority:2}));const start=s.clock.now;
 const pending=job('promoted',options);await turn();s.clock.now+=500;options.priority=2;s.box.YouTubeRequests.wake();
 await s.finish(pending);assert.equal(calls[1].at-start,2000);
});
test('widespread feed failures pause automatic lookups but allow paced manual channel additions after restart',async()=>{
 const s=harness(),calls=[];
 const request=id=>s.box.YouTubeRequests.run(async()=>{calls.push(id);s.box.YouTubeRequests.checkResponse(s.response('https://www.youtube.com/',404));},{priority:2,kind:'feed',id});
 await s.finish(Promise.allSettled(['a','b','c','d','e'].map(request)));
 assert.deepEqual(calls,['a','b','c']);const until=(await s.box.YouTubeRequests.status()).pausedUntil;assert.equal(until-s.clock.now,900000);
 s.load('youtube-requests.js');
 for(const kind of ['feed','video','channel'])await assert.rejects(s.finish(s.box.YouTubeRequests.run(()=>{throw Error('Must not contact YouTube');},{kind})),{name:'YouTubeCooldownError'});
 const status=await s.box.YouTubeRequests.status();assert.equal(status.pauseScope,'automatic');assert.equal(status.pauseReason,'feed-failures');assert.match(status.pauseMessage,/paused until .*Several channel upload feeds failed.*add channels manually/);
 const times=[];await s.finish(Promise.all(['manual-a','manual-b'].map(id=>s.box.YouTubeRequests.run(()=>{times.push(s.clock.now);return id;},{kind:'channel',priority:3,id}))));
 assert.equal(times[1]-times[0],2000);assert.equal((await s.box.YouTubeRequests.status()).pausedUntil,until);
 s.clock.now=until;await s.finish(Promise.allSettled(['a','b','c'].map(request)));
 assert.equal((await s.box.YouTubeRequests.status()).pausedUntil-s.clock.now,1800000);
});
test('queued manual additions survive a feed pause while automatic work stays unattempted',async()=>{
 const s=harness();let release,calls=[];
 const feed=id=>s.box.YouTubeRequests.run(async()=>{calls.push(id);if(id==='c')await new Promise(resolve=>release=resolve);s.box.YouTubeRequests.checkResponse(s.response('',404));},{kind:'feed',id,priority:2});
 await s.finish(Promise.allSettled([feed('a'),feed('b')]));
 const third=feed('c').catch(error=>error);await s.tick();
 const auto=s.box.YouTubeRequests.run(()=>calls.push('video'),{kind:'video',priority:2}).catch(error=>error);
 const manual=s.box.YouTubeRequests.run(()=>calls.push('manual'),{kind:'channel',priority:3});release();
 const results=await s.finish(Promise.all([third,auto,manual]));assert.equal(results[1].name,'YouTubeCooldownError');assert.deepEqual(calls,['a','b','c','manual']);
});
test('server refusals upgrade an automatic pause and block manual additions across restarts',async()=>{
 for(const [code,retry,reason] of [[403,undefined,'http-403'],[429,undefined,'http-429'],[503,'3600','retry-after']]){
  const s=harness();s.data['youtubeRequests:v1']={pausedUntil:s.clock.now+900000,pauseScope:'automatic',pauseReason:'feed-failures'};let calls=0;
  await assert.rejects(s.finish(s.box.YouTubeRequests.run(()=>{calls++;s.box.YouTubeRequests.checkResponse(s.response('',code,'',retry));},{kind:'channel',priority:3})));
  const status=await s.box.YouTubeRequests.status();assert.equal(status.pauseScope,'all');assert.equal(status.pauseReason,reason);assert.ok(status.pausedUntil>=s.clock.now+900000);
  s.load('youtube-requests.js');
  await assert.rejects(s.finish(s.box.YouTubeRequests.run(()=>calls++,{kind:'channel',priority:3})),error=>error.name==='YouTubeCooldownError'&&error.message.includes(status.pauseMessage));assert.equal(calls,1);
 }
});
test('legacy cooldowns retain their global scope until they expire',async()=>{
 const s=harness(),until=s.clock.now+900000;s.data['youtubeRequests:v1']={pausedUntil:until};let calls=0;
 const request=()=>s.box.YouTubeRequests.run(()=>calls++,{kind:'channel',priority:3});
 await assert.rejects(s.finish(request()),/previous cooldown is still active/);assert.equal(calls,0);
 s.clock.now=until;await s.finish(request());assert.equal(calls,1);assert.equal((await s.box.YouTubeRequests.status()).pauseMessage,'');
});
test('server cooldowns are respected across metadata and feed calls, without falsely treating one 404 as a ban',async()=>{
 const s=harness();let calls=0;
 const request=(status,kind='feed',retry)=>s.box.YouTubeRequests.run(async()=>{calls++;s.box.YouTubeRequests.checkResponse(s.response('https://www.youtube.com/',status,'',retry));},{kind,id:'one',priority:2});
 await assert.rejects(s.finish(request(404)));assert.equal((await s.box.YouTubeRequests.status()).pausedUntil,0);
 await assert.rejects(s.finish(request(429,'video','3600')));assert.equal((await s.box.YouTubeRequests.status()).pausedUntil-s.clock.now,3600000);
 await assert.rejects(s.finish(request(200)),{name:'YouTubeCooldownError'});assert.equal(calls,2);
});
test('cancelled queued work never sends a request and does not lose its promise',async()=>{
 const s=harness();let cancelled=false,calls=0;
 await s.finish(s.box.YouTubeRequests.run(async()=>{},{}));
 const task=s.box.YouTubeRequests.run(()=>calls++,{cancelled:()=>cancelled});await turn();cancelled=true;await s.finish(task);assert.equal(calls,0);
});
