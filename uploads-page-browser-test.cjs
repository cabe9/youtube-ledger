// Shared packaged-browser scenario; all YouTube responses below are synthetic.
module.exports=async function checkUploadsFallback(fixture){
 const verify=(value,message)=>{if(!value)throw Error(message);};
 const id='UClZbO3wehSIsPUKLx_X5caw',now=Date.now(),calls=[];
 let mode='fallback';
 globalThis.fetch=async url=>{
  const u=new URL(url),rss=u.pathname==='/feeds/videos.xml';calls.push({url,at:Date.now()});
  const body=rss?'<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+id+'</yt:channelId><title>Test</title></feed>':'<script>var ytInitialData = '+JSON.stringify(fixture)+';</script>';
  const response=new Response(body,{status:mode==='refusal'?429:rss?404:200});Object.defineProperty(response,'url',{value:String(url)});return response;
 };
 await browser.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'fallback',name:'Fallback test',channelIds:[id]}],channels:{[id]:{id,name:'CarlSagan42',url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:now}}},'channelUploads:v1':{version:1,channels:{}}});
 const sender={tab:{id:999},url:'https://www.youtube.com/feed/subscriptions'};
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);
 const result=await GroupFeeds.handle({type:'groupFeed:get',groupId:'fallback'},sender);
 verify(result.entries.length===3&&!result.channels[0].error&&result.channels[0].feedSource==='uploads-page','Fallback must populate a real group feed');
 verify(calls.length===2&&calls[1].at-calls[0].at>=9950,'Page fallback must wait at least ten seconds');
 verify(result.entries[0].details.duration===2302&&result.entries[0].views.approximate,'Page metadata must survive storage and the feed response');
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);verify(calls.length===2,'Opening the group again must reuse its cache');
 const cacheKey='channelUploads:v1',cache=(await browser.storage.local.get(cacheKey))[cacheKey];cache.channels[id].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({[cacheKey]:cache});
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);verify(calls.length===3&&!calls[2].url.includes('feeds/videos.xml'),'Subsequent refresh must reuse the successful source');
 mode='refusal';const latest=(await browser.storage.local.get(cacheKey))[cacheKey];latest.channels[id].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({[cacheKey]:latest});
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback'},sender);
 const paused=await GroupFeeds.handle({type:'groupFeed:get',groupId:'fallback'},sender);verify(paused.pauseScope==='all'&&paused.pauseReason==='http-429'&&paused.entries.length===3,'A page refusal must stop requests and retain recovered uploads');
 await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'fallback',force:true},sender);verify(calls.length===4,'Manual refresh must respect the server cooldown');
 const log=await YouTubeRequestLog.snapshot();verify(log.recent.length===4&&log.recent.filter(r=>r.reason==='uploads-page-fallback').length===3,'Fallback attempts must be identifiable in the request log');
 const report={ok:true,requests:calls.length,entries:paused.entries.length};await browser.storage.local.set({'test:result':report});return report;
};
