const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,turn}=require('./request-test-helpers.cjs');
const files=['request-log.js','youtube-requests.js'];
const total=log=>Object.values(log.days).flatMap(Object.values).reduce((out,v)=>{for(const key of ['started','failed','background','cache','cooldown','reused','cancelled'])out[key]=(out[key]||0)+(v[key]||0);return out;},{});
const sender={url:'chrome-extension://test/dashboard.html#settings'};
test('slow diagnostic writes do not shorten the gap between actual requests',async()=>{
 const s=harness(files),calls=[],set=s.box.browser.storage.local.set;let delayed=false;
 s.box.browser.storage.local.set=async value=>{if(value['youtubeRequestLog:v1']?.recent.some(e=>e.result==='pending')&&!delayed){delayed=true;s.clock.now+=500;}return set(value);};
 s.box.fetch=async url=>{calls.push(s.clock.now);return s.response(url);};
 for(let i=0;i<2;i++)await s.finish(s.box.YouTubeRequests.run(get=>get('https://www.youtube.com/channel/test'),{kind:'feed',id:String(i),priority:2,minSpacing:10000}));
 assert.equal(calls[1]-calls[0],10000);
});
test('counts actual fetch attempts and HTTP/network results, without counting queued or cancelled work',async()=>{
 const s=harness(files);let calls=0;
 s.box.fetch=async url=>{calls++;if(url.endsWith('timeout'))throw Object.assign(Error('private message'),{name:'TimeoutError'});return s.response(url,url.endsWith('missing')?404:200);};
 const send=(url,opts)=>s.box.YouTubeRequests.run(async get=>{const response=await get('https://www.youtube.com/'+url);s.box.YouTubeRequests.checkResponse(response);return response;},opts);
 await s.finish(send('ok',{kind:'feed',priority:0,reason:'background-refresh'}));
 await assert.rejects(s.finish(send('missing',{kind:'feed',id:'a',priority:2})));
 await assert.rejects(s.finish(send('timeout',{kind:'video',priority:2})));
 await s.finish(send('cancel',{kind:'video',cancelled:()=>true}));
 const log=await s.box.YouTubeRequestLog.snapshot();assert.equal(calls,3);assert.equal(total(log).started,3);assert.equal(total(log).background,1);assert.equal(total(log).failed,2);assert.equal(total(log).cancelled,1);
 assert.deepEqual(Array.from(log.recent,v=>v.result),['ok','http-error','timeout']);assert.equal(log.recent[1].status,404);assert.ok(!JSON.stringify(log).includes('private message'));
});
test('global cooldown and local cache skips do not inflate requests; clearing preserves scheduler cooldown',async()=>{
 const s=harness(files);let calls=0;s.box.fetch=async url=>{calls++;return s.response(url,429);};
 await assert.rejects(s.finish(s.box.YouTubeRequests.run(async get=>s.box.YouTubeRequests.checkResponse(await get('https://www.youtube.com/watch?v=abcdefghijk')),{kind:'video',priority:2})));
 for(let i=0;i<3;i++)await assert.rejects(s.finish(s.box.YouTubeRequests.run(()=>{throw Error('must not run');},{kind:'feed',priority:2})),{name:'YouTubeCooldownError'});
 s.box.YouTubeRequestLog.skip({kind:'feed'},'cache');s.box.YouTubeRequestLog.skip({kind:'feed'},'reused');
 const log=await s.box.YouTubeRequestLog.snapshot();assert.equal(calls,1);assert.equal(total(log).started,1);assert.equal(total(log).cooldown,3);assert.equal(total(log).cache,1);assert.equal(total(log).reused,1);
 const before=await s.box.YouTubeRequests.status();await s.box.YouTubeRequestLog.handle({type:'requestLog:clear'},sender);const after=await s.box.YouTubeRequests.status();assert.equal(after.pausedUntil,before.pausedUntil);assert.equal((await s.box.YouTubeRequestLog.snapshot()).recent.length,0);
});
test('retains complete daily totals beyond the bounded recent list, persists restarts and expires old days',async()=>{
 const s=harness(files);s.box.fetch=async url=>s.response(url);
 for(let i=0;i<1005;i++)await s.box.YouTubeRequestLog.run(get=>get('https://www.youtube.com/watch?v=abcdefghijk&private=drop'),{kind:'video',priority:2});
 s.load('request-log.js');let log=await s.box.YouTubeRequestLog.snapshot();assert.equal(log.recent.length,1000);assert.equal(total(log).started,1005);assert.equal(total(log).failed,0);assert.ok(log.recent.every(e=>e.url==='https://www.youtube.com/watch?v=abcdefghijk'));
 s.clock.now+=8*86400000;log=await s.box.YouTubeRequestLog.snapshot();assert.equal(log.recent.length,0);assert.equal(Object.keys(log.days).length,0);assert.equal(s.data['youtubeRequestLog:v1'].recent.length,0,'Expired records are also removed from disk');
});
test('unfinished requests remain explicit after restart; clear during an active fetch does not bring old rows back',async()=>{
 const s=harness(files);let release;s.box.fetch=url=>new Promise(resolve=>{release=()=>resolve(s.response(url));});
 const operation=s.box.YouTubeRequestLog.run(get=>get('https://www.youtube.com/channel/UC'+'a'.repeat(22)),{kind:'channel',priority:3});await turn();assert.equal((await s.box.YouTubeRequestLog.snapshot()).recent[0].result,'pending');
 const restarted=harness(files);Object.assign(restarted.data,structuredClone(s.data));const restored=await restarted.box.YouTubeRequestLog.snapshot();assert.equal(restored.recent[0].result,'unfinished');assert.equal(total(restored).failed,0);
 await s.box.YouTubeRequestLog.handle({type:'requestLog:clear'},sender);release();await operation;assert.equal((await s.box.YouTubeRequestLog.snapshot()).recent.length,0);
});
test('HTTP 200 with unreadable metadata is distinguished from a failed HTTP response',async()=>{
 const s=harness(files);s.box.fetch=async url=>s.response(url);
 await assert.rejects(s.box.YouTubeRequestLog.run(async get=>{await get('https://www.youtube.com/feeds/videos.xml?channel_id=UC'+'a'.repeat(22));throw Error('Bad feed');},{kind:'feed',priority:2}));
 const log=await s.box.YouTubeRequestLog.snapshot();assert.equal(log.recent[0].status,200);assert.equal(log.recent[0].result,'unusable');assert.equal(total(log).failed,1);
});
test('diagnostic persistence errors do not prevent requests or hide their original failures',async()=>{
 const s=harness(files);let calls=0;s.box.fetch=async url=>{calls++;return s.response(url);};s.box.browser.storage.local.set=async()=>{throw Error('Quota exceeded');};
 await s.box.YouTubeRequestLog.run(get=>get('https://www.youtube.com/channel/example'),{kind:'channel'});
 assert.equal(calls,1);const log=await s.box.YouTubeRequestLog.snapshot();assert.equal(total(log).started,1);assert.match(log.storageWarning,/could not be saved/);
});
test('only the extension dashboard can read or clear the log',async()=>{
 const s=harness(files);
 for(const other of [{url:'https://www.youtube.com/'},{url:'chrome-extension://test/dashboard.html.evil'},{...sender,tab:{incognito:true}}])await assert.rejects(s.box.YouTubeRequestLog.handle({type:'requestLog:get'},other),/Open Ledger Settings/);
 assert.equal((await s.box.YouTubeRequestLog.handle({type:'requestLog:get'},sender)).version,1);
});
