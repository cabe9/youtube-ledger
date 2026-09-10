// Shared packaged-browser scenario; all YouTube responses below are synthetic.
module.exports=async function checkUploadsFallback(fixture){
 const verify=(value,message)=>{if(!value)throw Error(message);};
 const id='UClZbO3wehSIsPUKLx_X5caw',now=Date.now(),calls=[];
 let mode='fallback';
 globalThis.fetch=async (url,init)=>{
  const u=new URL(url),rss=u.pathname==='/feeds/videos.xml';calls.push({url,at:Date.now()});
  const body=rss?'<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+id+'</yt:channelId><title>Test</title></feed>':'<script>var ytInitialData = '+JSON.stringify(fixture)+';</script>';
  // Headers arrive immediately, but the first fallback body takes longer than
  // the old 15-second deadline. Honor the real browser AbortSignal while reading.
  let content=body;
  if(!rss&&calls.length===2){
   let timer,abort;
   content=new ReadableStream({start(controller){
    abort=()=>{clearTimeout(timer);controller.error(init.signal.reason);};
    if(init.signal.aborted){abort();return;}
    init.signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{init.signal.removeEventListener('abort',abort);controller.enqueue(new TextEncoder().encode(body));controller.close();},16500);
   },cancel(){clearTimeout(timer);init.signal.removeEventListener('abort',abort);}});
  }
  const response=new Response(content,{status:mode==='refusal'?429:rss?404:200});Object.defineProperty(response,'url',{value:String(url)});return response;
 };
 const until=now+7200000;
 await browser.storage.local.set({paused:true,settings:{theme:'retrowave'},'youtubeRequests:v1':{pausedUntil:until,pauseScope:'automatic',pauseReason:'feed-failures'},'channelGroups:v1':{version:1,groups:[{id:'fallback',name:'Fallback test',channelIds:[id]}],channels:{[id]:{id,name:'CarlSagan42',url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{[id]:{entries:[],attemptedAt:now,error:'HTTP 404',retryAt:until,retryAfter:until}}}});
 const sender={tab:{id:999},url:'https://www.youtube.com/feed/subscriptions'};
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);
 verify(calls.length===0,'Reloaded cooldown and individual backoffs must block ordinary refresh');
 await GroupFeeds.handle({type:'groupFeed:retryCooldown',groupId:'fallback',pausedUntil:until},sender);
 verify((await YouTubeRequests.status()).pausedUntil===0,'Explicit retry must clear the saved local pause');
 const result=await GroupFeeds.handle({type:'groupFeed:get',groupId:'fallback'},sender);
 verify(result.entries.length===3&&!result.channels[0].error&&result.channels[0].feedSource==='uploads-page','Fallback must populate a real group feed');
 verify(calls.length===2&&calls[1].at-calls[0].at>=9950,'Page fallback must wait at least ten seconds');
 verify((await YouTubeRequestLog.snapshot()).recent[1].ms>=16000,'Slow fallback bodies must finish beyond the old 15-second deadline');
 verify(result.entries[0].details.duration===2302&&result.entries[0].views.approximate,'Page metadata must survive storage and the feed response');
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);verify(calls.length===2,'Opening the group again must reuse its cache');
 const cacheKey='channelUploads:v1',cache=(await browser.storage.local.get(cacheKey))[cacheKey];cache.channels[id].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({[cacheKey]:cache});
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);verify(calls.length===3&&!calls[2].url.includes('feeds/videos.xml'),'Subsequent refresh must reuse the successful source');
 mode='refusal';const latest=(await browser.storage.local.get(cacheKey))[cacheKey];latest.channels[id].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({[cacheKey]:latest});
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);
 const paused=await GroupFeeds.handle({type:'groupFeed:get',groupId:'fallback'},sender);verify(paused.pauseScope==='all'&&paused.pauseReason==='http-429'&&paused.entries.length===3,'A page refusal must stop requests and retain recovered uploads');
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback',force:true},sender);verify(calls.length===4,'Manual refresh must respect the server cooldown');
 try{await GroupFeeds.handle({type:'groupFeed:retryCooldown',groupId:'fallback',pausedUntil:paused.pausedUntil},sender);throw Error('Expected cooldown');}catch(error){verify(error.name==='YouTubeCooldownError','Explicit retry must also respect the server cooldown');}
 verify(calls.length===4,'Rejected override must not send requests');
 const log=await YouTubeRequestLog.snapshot();verify(log.recent.length===4&&log.recent.filter(r=>r.reason==='uploads-page-fallback').length===3,'Fallback attempts must be identifiable in the request log');
 const report={ok:true,requests:calls.length,entries:paused.entries.length};await browser.storage.local.set({'test:result':report});return report;
};
