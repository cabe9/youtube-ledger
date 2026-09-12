// Packaged background continuation scenario. Browser presence and fetches are controlled.
module.exports=async function checkBackgroundFeeds(){
 const verify=(value,message)=>{if(!value)throw Error(message);},ids=['a','b'].map(c=>'UC'+c.repeat(22)),calls=[];
 const query=browser.tabs.query;let open=true,hold=true,release,started,returning=false;
 const first=new Promise(resolve=>started=resolve);
 browser.tabs.query=async()=>open?[{id:999,active:false,incognito:false,url:'https://www.youtube.com/watch?v=abcdefghijk'}]:[];
 globalThis.fetch=async url=>{
  const id=new URL(url).searchParams.get('channel_id');calls.push({url,at:Date.now()});
  if(hold){hold=false;started();await new Promise(resolve=>release=resolve);}
  const entry=returning&&id===ids[0]?'<entry><yt:videoId>aaaaaaaaaaa</yt:videoId><yt:channelId>'+id+'</yt:channelId><title>New upload after a break</title><published>'+new Date(Date.now()-3600000).toISOString()+'</published></entry>':'';
  const response=new Response('<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>'+id+'</yt:channelId><title>Fixture</title>'+entry+'</feed>');Object.defineProperty(response,'url',{value:String(url)});return response;
 };
 try{
  await browser.storage.local.set({paused:true,'channelGroups:v1':{version:1,groups:[{id:'background',name:'Background test',channelIds:ids}],channels:Object.fromEntries(ids.map(id=>[id,{id,name:'Fixture',url:'https://www.youtube.com/channel/'+id}]))},'channelUploads:v1':{version:1,channels:{}}});
  const sender={tab:{id:999},url:'https://www.youtube.com/feed/subscriptions'};
  const pending=GroupFeeds.handle({type:'groupFeed:refresh',groupId:'background'},sender);await first;
  await GroupFeeds.handle({type:'groupFeed:leave'},sender);release();await pending;
  verify(calls.length===2&&calls[1].at-calls[0].at>=9950,'Unfinished group must continue at background pace');
  const progress=(await GroupFeeds.handle({type:'groupFeed:get',groupId:'background',visible:false},sender)).refresh;
  verify(progress.total===2&&progress.checked===2&&progress.refreshed===2&&!progress.running,'Progress must finish after background continuation');
  await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===2,'Background sweep must reuse warm channels');
  const log=await YouTubeRequestLog.snapshot();verify(log.recent.length===2&&log.recent[1].mode==='background','Continuation must be logged at background priority');
  const warm=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1'];for(const c of Object.values(warm.channels))c.attemptedAt=Date.now()-30*60000;await browser.storage.local.set({'channelUploads:v1':warm});
  const before=JSON.stringify((await browser.storage.local.get('groupRefreshProgress:v1'))['groupRefreshProgress:v1']);
  for(let i=0;i<4;i++){await GroupFeeds.handle({type:'groupFeed:get',groupId:'background'},sender);await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'background',automatic:true},sender);}
  verify(calls.length===2&&JSON.stringify((await browser.storage.local.get('groupRefreshProgress:v1'))['groupRefreshProgress:v1'])===before,'Warm visible visits must not request uploads or restart progress');
  const inactive=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1'];
  Object.assign(inactive.channels[ids[0]],{latestUploadAt:Date.now()-100*86400000,fetchedAt:Date.now()-3*3600000,attemptedAt:Date.now()-3*3600000});
  await browser.storage.local.set({'channelUploads:v1':inactive});
  await GroupFeeds.handle({type:'groupFeed:refresh',groupId:'background',automatic:true},sender);
  await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===2,'Inactive channels must skip both automatic entry points before their daily check');
  verify((await GroupFeeds.handle({type:'groupFeed:get',groupId:'background'},sender)).channels[0].dailyChecks,'The feed must explain daily checks for inactive channels');
  await GroupFeeds.getChannelUploads(ids[0],true);verify(calls.length===3,'Manual refresh must work before the daily interval');
  const due=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1'];due.channels[ids[0]].attemptedAt=Date.now()-25*3600000;await browser.storage.local.set({'channelUploads:v1':due});
  returning=true;await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===4,'A due daily check must discover a returning creator');
  verify(!(await GroupFeeds.handle({type:'groupFeed:get',groupId:'background'},sender)).channels[0].dailyChecks,'A new upload must remove the daily-check state');
  const active=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1'];active.channels[ids[0]].attemptedAt=Date.now()-3*3600000;await browser.storage.local.set({'channelUploads:v1':active});
  await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===5,'The returning creator must resume the two-hour cadence');
  const key='channelUploads:v1',cache=(await browser.storage.local.get(key))[key];for(const c of Object.values(cache.channels))c.attemptedAt=1;await browser.storage.local.set({[key]:cache,settings:{backgroundGroupChecks:false}});
  await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===5,'Opt-out must stop background requests');
  await browser.storage.local.set({settings:{backgroundGroupChecks:true}});open=false;
  await GroupFeeds.handle({type:'groupFeed:checkAll'},sender);verify(calls.length===5,'No YouTube tabs means no background requests');
  const report={ok:true,requests:calls.length};await browser.storage.local.set({'test:result':report});return report;
 }finally{browser.tabs.query=query;}
};
