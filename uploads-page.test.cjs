const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./request-test-helpers.cjs');
require('./core.js');require('./channel-groups.js');require('./uploads-page.js');require('./group-feeds.js');
const A='UClZbO3wehSIsPUKLx_X5caw',B='UCgG7oz-Oq-7Etn0_bz0WimQ',C='UCbk8eZJU-lrSV3v7R1Gim2A';
const at=Date.parse('2026-09-10T07:00:00Z');
const fixture=()=>JSON.parse(fs.readFileSync('tests/fixtures/uploads-page-playlist.json'));
const blocks=d=>d.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents;
const parts=item=>item.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].metadataParts;
function pageFor(id=A){return JSON.stringify(fixture()).replaceAll(A,id).replaceAll('UU'+A.slice(2),'UU'+id.slice(2));}
test('three public uploads-page excerpts provide verified recent videos, dates, counts and durations',()=>{
 for(const [name,id] of [['playlist',A],['iroiro-uploads',B],['yuri-uploads',C]]){
  const data=JSON.parse(fs.readFileSync('tests/fixtures/uploads-page-'+name+'.json'));
  const entries=UploadsPage.parse(data,id,at);assert.equal(entries.length,3);assert.ok(entries.every(v=>v.channelId===id&&v.publishedAtEstimated&&Ledger.validVideoDetails(v.details)&&Ledger.validVideoViews(v.views)));
 }
 const [video]=UploadsPage.parse(fixture(),A,at);assert.equal(video.videoId,'K3M4Mel84sE');assert.equal(video.details.duration,2302);assert.equal(video.views.count,113000);assert.equal(video.views.approximate,true);assert.equal(video.publishedAt,at-3*86400000);assert.equal(video.details.shorts,'unknown');
});
test('identity, wrong playlist, foreign videos and unreadable content fail closed',()=>{
 for(const mutate of [d=>d.header.playlistHeaderRenderer.playlistId='other',d=>d.sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer.navigationEndpoint.browseEndpoint.browseId=B,d=>blocks(d)[0].lockupViewModel.rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId='wrong',d=>blocks(d)[0].lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId=B,d=>d.contents={}]){
  const d=fixture();mutate(d);assert.throws(()=>UploadsPage.parse(d,A,at));
 }
 assert.throws(()=>UploadsPage.parse(null,A,at));
});
test('bounded list parsing ignores unrelated recommendations and never invents missing dates or counts',()=>{
 const d=fixture(),item=blocks(d)[0].lockupViewModel;
 parts(item)[0].text.content='No views';parts(item)[1].text.content='Streamed 2 hours ago';
 let [entry]=UploadsPage.parse(d,A,at);assert.equal(entry.views.count,0);assert.equal(entry.views.approximate,undefined);assert.equal(entry.publishedAt,at-7200000);
 parts(item)[0].text.content='4,123 views';assert.equal(UploadsPage.parse(d,A,at)[0].views.count,4123);
 parts(item)[0].text.content='1,234 watching';assert.equal(UploadsPage.parse(d,A,at)[0].views,undefined);
 parts(item)[1].text.content='Scheduled for tomorrow';assert.equal(UploadsPage.parse(d,A,at).length,2);
 d.recommendations={lockupViewModel:item};assert.equal(UploadsPage.parse(d,A,at).length,2);
 const copy=structuredClone(blocks(d)[1]);blocks(d).splice(0,blocks(d).length,...Array.from({length:50},(_,i)=>{const v=structuredClone(copy),id=String(i).padStart(11,'0');v.lockupViewModel.contentId=id;v.lockupViewModel.rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId=id;return v;}));assert.equal(UploadsPage.parse(d,A,at).length,30);
});
test('legacy uploads renderers use explicit bylines and combined age/count labels',()=>{
 const d=fixture();blocks(d).splice(0,3,{playlistVideoRenderer:{videoId:'a'.repeat(11),title:{runs:[{text:'Legacy upload'}]},shortBylineText:{runs:[{text:'CarlSagan42',navigationEndpoint:{browseEndpoint:{browseId:A}}}]},navigationEndpoint:{watchEndpoint:{videoId:'a'.repeat(11),playlistId:'UU'+A.slice(2)}},videoInfo:{runs:[{text:'15,102 views • Premiered 2 weeks ago'}]},lengthText:{simpleText:'1:02:03'}}});
 const [entry]=UploadsPage.parse(d,A,at);assert.equal(entry.details.duration,3723);assert.equal(entry.views.count,15102);assert.equal(entry.publishedAt,at-14*86400000);
});
test('approximate metadata preserves exact cached dates and fresh counts, Shorts classification, and stable ages',()=>{
 const entry=UploadsPage.parse(fixture(),A,at)[0];
 let cache=GroupFeeds.merge(null,A,[entry],at);
 cache=GroupFeeds.merge(cache,A,[{...entry,publishedAt:entry.publishedAt+3600000}],at+3600000);assert.equal(cache.channels[A].entries[0].publishedAt,entry.publishedAt);
 const exact={...entry,publishedAt:entry.publishedAt-12345,publishedAtEstimated:false,views:{count:113123,checkedAt:at},details:{...entry.details,shorts:true}};
 cache=GroupFeeds.merge(cache,A,[exact],at);
 cache=GroupFeeds.merge(cache,A,[entry],at+1000);let kept=cache.channels[A].entries[0];assert.equal(kept.publishedAt,exact.publishedAt);assert.equal(kept.publishedAtEstimated,false);assert.equal(kept.views.count,113123);assert.equal(kept.details.shorts,true);
 cache=GroupFeeds.merge(cache,A,[{...entry,views:{count:120000,checkedAt:at+7200000,approximate:true}}],at+7200000);assert.equal(cache.channels[A].entries[0].views.count,120000);
});
function setup(count=1){
 const s=harness(['core.js','request-log.js','uploads-page.js','youtube-requests.js','channel-groups.js','group-feeds.js']);
 const ids=Array.from({length:count},(_,i)=>i===0?A:'UC'+String(i).padStart(22,'0'));
 s.data['channelGroups:v1']={version:1,groups:[{id:'g',name:'Test',channelIds:ids}],channels:Object.fromEntries(ids.map(id=>[id,{id,name:id}]))};
 s.data['channelUploads:v1']={version:1,channels:{}};
 const calls=[];let rss=404,page=200;
 s.box.fetch=async url=>{const u=new URL(url),isRSS=u.pathname==='/feeds/videos.xml',id=isRSS?u.searchParams.get('channel_id'):'UC'+u.searchParams.get('list').slice(2);calls.push({url,at:s.clock.now,isRSS});return s.response(url,isRSS?rss:page,isRSS?`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${id}</yt:channelId><title>Test</title></feed>`:'<script>var ytInitialData = '+pageFor(id)+';</script>');};
 return {...s,ids,calls,feeds:s.box.GroupFeeds,setStatus:(a,b)=>{rss=a;page=b;},cache:()=>s.data['channelUploads:v1'].channels[A],sender:{tab:{id:1},url:'https://www.youtube.com/feed/subscriptions'}};
}
test('RSS fallback is paced and logged, then cached for two hours and reuses the page for 24 hours',async()=>{
 const s=setup();await s.finish(s.feeds.getChannelUploads(A));assert.equal(s.calls.length,2);assert.ok(s.calls[1].at-s.calls[0].at>=10000);assert.equal(s.cache().entries.length,3);assert.equal(s.cache().feedSource,'uploads-page');assert.equal(s.cache().error,'');
 const log=await s.box.YouTubeRequestLog.snapshot();assert.equal(log.recent.length,2);assert.equal(log.recent[0].status,404);assert.equal(log.recent[1].reason,'uploads-page-fallback');assert.equal(log.recent[1].url,'https://www.youtube.com/playlist?list=UU'+A.slice(2));
 s.clock.now+=16*60000;await s.finish(s.feeds.getChannelUploads(A));assert.equal(s.calls.length,2);
 s.clock.now+=2*3600000;await s.finish(s.feeds.getChannelUploads(A));assert.equal(s.calls.length,3);assert.equal(s.calls[2].isRSS,false);
 s.clock.now=s.cache().rssRetryAt+1;s.setStatus(200,200);await s.finish(s.feeds.getChannelUploads(A));assert.equal(s.calls.length,4);assert.equal(s.cache().feedSource,'rss');assert.equal(s.cache().rssRetryAt,undefined);
});
test('successful fallbacks keep a group working; failure of both sources stops large sweeps',async()=>{
 const good=setup(5);good.data['youtubeRequests:v1']={level:4};await good.finish(good.feeds.handle({type:'groupFeed:refresh',groupId:'g'},good.sender));assert.equal(good.calls.length,10);assert.equal((await good.box.YouTubeRequests.status()).pausedUntil,0);assert.equal(good.data['youtubeRequests:v1'].level,0,'Successful fallback checks must clear escalation from earlier failures');
 assert.ok(Object.values(good.data['channelUploads:v1'].channels).every(c=>c.entries.length===3&&!c.error));
 const bad=setup(25);bad.setStatus(404,500);await bad.finish(bad.feeds.handle({type:'groupFeed:checkAll'},bad.sender));assert.equal(bad.calls.length,6);assert.equal((await bad.box.YouTubeRequests.status()).pauseScope,'automatic');
 const before=bad.calls.length;await bad.finish(bad.feeds.handle({type:'groupFeed:refresh',groupId:'g',force:true},bad.sender));assert.equal(bad.calls.length,before);
});
test('403, 429, Retry-After and existing cooldowns never trigger fallback requests',async()=>{
 for(const status of [403,429]){const s=setup();s.setStatus(status,200);await s.finish(s.feeds.getChannelUploads(A));assert.equal(s.calls.length,1);assert.equal((await s.box.YouTubeRequests.status()).pauseScope,'all');}
 const retry=setup();retry.box.fetch=async url=>{retry.calls.push({url});return retry.response(url,503,'','120');};await retry.finish(retry.feeds.getChannelUploads(A));assert.equal(retry.calls.length,1);
 const paused=setup();paused.data['youtubeRequests:v1']={pausedUntil:paused.clock.now+60000,pauseReason:'feed-not-found',pauseScope:'automatic'};await paused.finish(paused.feeds.getChannelUploads(A));assert.equal(paused.calls.length,0);
});
test('fallback failures retain cached uploads; cancellation stops a queued fallback',async()=>{
 const s=setup();await s.finish(s.feeds.getChannelUploads(A));const before=structuredClone(s.cache().entries);s.clock.now+=2*3600000;s.setStatus(404,404);await s.finish(s.feeds.getChannelUploads(A));assert.deepEqual(s.cache().entries,before);assert.ok(s.cache().retryAt>s.clock.now);
 const cancelled=setup();const task=cancelled.feeds.getChannelUploads(A);await cancelled.turn();cancelled.feeds.invalidate();await cancelled.finish(task);assert.ok(cancelled.calls.length<=1);assert.equal(cancelled.cache(),undefined);
});
test('stream reader stops at complete JSON, rejects oversized input, and never executes scripts',async()=>{
 const body='<script>var ytInitialData = '+pageFor()+';</script><script>throw Error("do not run")</script>',encoded=new TextEncoder().encode(body);let cancelled=false,reads=0;
 const data=await UploadsPage.read({body:{getReader:()=>({read:async()=>{reads++;return {value:encoded,done:false};},cancel:async()=>{cancelled=true;}})}});assert.equal(UploadsPage.parse(data,A).length,3);assert.equal(reads,1);assert.equal(cancelled,true);
 await assert.rejects(UploadsPage.read({text:async()=>'x'.repeat(8000001)}),/too large/);
});
