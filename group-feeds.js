/* Local recent-upload cache. No account, API key, or remote Ledger service. */
globalThis.GroupFeeds = (() => {
  const key='channelUploads:v1', launchKey='groupLaunches:v1', ttl=15*60*1000, backgroundTTL=2*3600000;
  const channelPattern=/^UC[A-Za-z0-9_-]{22}$/, videoPattern=/^[A-Za-z0-9_-]{11}$/;
  let writes=Promise.resolve(), launchWrites=Promise.resolve();
  const inFlight=new Map(),activeGroups=new Map();let epoch=0,checkingAll=null;
  const network=(run,options)=>globalThis.YouTubeRequests?YouTubeRequests.run(run,options):run(fetch);
  const detailJobs=new Map(),detailQueue=[];let detailActive=0;
  function decode(text){
    return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,(_,value)=>value).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,entity)=>{
      if(entity[0]!=='#')return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[entity.toLowerCase()];
      const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
    });
  }
  // Extract the small, known Atom schema as text only; never execute XML or render markup.
  function parse(xml,channelId,checkedAt=Date.now()){
    if(!channelPattern.test(channelId)||typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<feed\s[^>]*xmlns=["']http:\/\/www.w3.org\/2005\/Atom["']/.test(xml)||!/<\/feed>\s*$/.test(xml))throw new Error('YouTube returned an unreadable upload feed.');
    const clean=xml.replace(/<!--[\s\S]*?-->/g,''), blocks=[...clean.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)];
    if(blocks.length!==(clean.match(/<entry\b/g)||[]).length)throw new Error('YouTube returned an incomplete upload feed.');
    const field=(body,tag)=>decode(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>').exec(body)?.[1]||'').trim();
    const header=clean.split('<entry')[0], identity=field(header,'yt:channelId');
    if(identity!==channelId&&'UC'+identity!==channelId)throw new Error('YouTube returned a different channel’s feed.');
    const channel=field(header,'title').slice(0,200);
    const entries=blocks.map(([,body])=>{
      const videoId=field(body,'yt:videoId'), publishedAt=Date.parse(field(body,'published')), title=field(body,'title').slice(0,500);
      if(!videoPattern.test(videoId)||field(body,'yt:channelId')!==channelId||!Number.isFinite(publishedAt)||!title)throw new Error('An upload was missing its channel or release date.');
      const viewsText=/<media:statistics\b[^>]*\bviews\s*=\s*["'](\d+)["']/.exec(body)?.[1],count=viewsText===undefined?undefined:Number(viewsText);
      return {videoId,channelId,channel,title,publishedAt,...(Number.isSafeInteger(count)&&count>=0?{views:{count,checkedAt}}:{})};
    });
    return [...new Map(entries.map(v=>[v.videoId,v])).values()];
  }
  function merge(previous,channelId,entries,at,error='',retryAfter=0){
    const cache=structuredClone(previous||{version:1,channels:{}}), old=cache.channels[channelId]||{};
    cache.channels[channelId]={...old,attemptedAt:at,viewsAttemptedAt:at,error};
    if(error){
      const failures=Math.min(8,(Number.isInteger(old.failures)?old.failures:0)+1);
      Object.assign(cache.channels[channelId],{failures,retryAfter,retryAt:Math.max(retryAfter,at+Math.min(backgroundTTL,15*60000*2**(failures-1)))});
    }else for(const field of ['failures','retryAfter','retryAt'])delete cache.channels[channelId][field];
    if(!error){
      const combined=new Map((old.entries||[]).map(v=>[v.videoId,v]));
      for(const entry of entries){
        const previous=combined.get(entry.videoId);
        const classificationUpgrade=typeof entry.details?.shorts==='boolean'&&previous?.details?.shorts==='unknown';
        let details=previous?.details&&!classificationUpgrade&&!globalThis.Ledger?.videoDetailsDue(previous.details,at)?previous.details:entry.details||previous?.details;
        if(details&&typeof previous?.details?.shorts==='boolean'&&details.shorts==='unknown')details={...details,shorts:previous.details.shorts};
        const views=entry.views?.approximate&&previous?.views&&!previous.views.approximate&&!globalThis.Ledger?.videoViewsDue(previous,at)?previous.views:entry.views||previous?.views;
        const next={...entry,...(views?{views}:{}),...(details?{details}:{})};
        // Never replace exact RSS dates with rounded ages, or let repeated
        // "3 days ago" labels move an already discovered upload forward in time.
        if(entry.publishedAtEstimated&&previous){next.publishedAt=previous.publishedAtEstimated?Math.min(previous.publishedAt,entry.publishedAt):previous.publishedAt;next.publishedAtEstimated=previous.publishedAtEstimated===true;}
        combined.set(entry.videoId,next);
      }
      cache.channels[channelId].entries=[...combined.values()].sort((a,b)=>b.publishedAt-a.publishedAt||a.videoId.localeCompare(b.videoId)).slice(0,250);
      cache.channels[channelId].fetchedAt=at;
    }
    // Bound metadata storage, with no age cutoff. Preserve the newest 5,000 discovered uploads.
    const keep=new Set(Object.values(cache.channels).flatMap(c=>c.entries||[]).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,5000).map(v=>v.videoId));
    for(const c of Object.values(cache.channels))c.entries=(c.entries||[]).filter(v=>keep.has(v.videoId));
    return cache;
  }
  function changeCache(update){const task=(globalThis.LedgerStorage?.write.bind(LedgerStorage)||((fn)=>writes.then(fn)))(async()=>{
    const data=await browser.storage.local.get([key,ChannelGroups.key]),cache=update(data[key]),used=new Set((data[ChannelGroups.key]?.groups||[]).flatMap(g=>g.channelIds));
    cache.channels=Object.fromEntries(Object.entries(cache.channels).filter(([id])=>used.has(id)));
    await browser.storage.local.set({[key]:globalThis.LedgerStorage?.limitCache?await LedgerStorage.limitCache(cache):cache});
  });writes=task.catch(()=>{});return task;}
  const prune=()=>changeCache(cache=>cache||{version:1,channels:{}});
  function parseVideoDetails(player,videoId,channelId,checkedAt=Date.now()){
    const details=player?.videoDetails;
    if(details?.videoId!==videoId||details.channelId!==channelId)throw new Error('Video identity unavailable.');
    const microformat=player.microformat?.playerMicroformatRenderer,broadcast=microformat?.liveBroadcastDetails;
    // Use YouTube's classification for this video, never its duration, title or recommendations.
    const shorts=(!microformat?.externalVideoId||microformat.externalVideoId===videoId)&&typeof microformat?.isShortsEligible==='boolean'?microformat.isShortsEligible:'unknown';
    const count=/^\d+$/.test(String(details.viewCount))?Number(details.viewCount):undefined,views=Number.isSafeInteger(count)&&count>=0?{viewCount:count}:{};
    if(details.isLive===true||broadcast?.isLiveNow===true)return {status:'live',checkedAt,shorts,...views};
    if(details.isUpcoming===true)return {status:'upcoming',checkedAt,shorts,...views};
    const duration=/^\d+$/.test(String(details.lengthSeconds))?Number(details.lengthSeconds):0;
    return Number.isInteger(duration)&&duration>0&&duration<=604800?{status:'available',duration,checkedAt,shorts,...views}:{status:'unavailable',checkedAt,shorts,...views};
  }
  async function readPlayer(response){
    // Stop once the player's JSON is complete; no page assets or media are loaded.
    if(!response.body?.getReader){const html=await response.text();if(html.length>8000000)throw new Error('Video page too large.');return ChannelGroups.assignedJSON(html,'ytInitialPlayerResponse');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let html='',bytes=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8000000)throw new Error('Video page too large.');html+=decoder.decode(value,{stream:true});const player=ChannelGroups.assignedJSON(html,'ytInitialPlayerResponse');if(player)return player;}}
    finally{await reader.cancel().catch(()=>{});}
    return null;
  }
  function pumpDetails(){
    while(detailActive<4&&detailQueue.length){detailQueue.sort((a,b)=>Number(b.shortsFirst)-Number(a.shortsFirst));const job=detailQueue.shift();detailActive++;job.run().then(job.resolve,job.reject).finally(()=>{detailActive--;pumpDetails();});}
  }
  function getVideoDetails(videoId,channelId,checkViews=false,shortsFirst=false,foreground=true){
    const version=epoch,identity=version+'|'+videoId;
    if(detailJobs.has(identity)){const job=detailJobs.get(identity);job.shortsFirst||=shortsFirst;if(foreground){job.options.priority=2;globalThis.YouTubeRequests?.wake();}return job.promise;}
    // Multiple tabs share this bounded queue, in addition to their visible-card limit.
    if(detailQueue.length>=48)return Promise.reject(new Error('Video metadata is busy.'));
    const job={shortsFirst,options:{priority:foreground?2:0,kind:'video',reason:shortsFirst?'shorts':checkViews?'views-and-details':'video-details',id:videoId,cancelled:()=>version!==epoch}};const task=new Promise((resolve,reject)=>{Object.assign(job,{resolve,reject,run:async()=>{
      if(version!==epoch)return;
      let stored=await browser.storage.local.get([key,ChannelGroups.key]);
      // One upload-feed request can fill fifteen counts. Reuse an ongoing refresh
      // or upgrade a pre-count cache before downloading individual watch pages.
      if(!job.shortsFirst&&checkViews&&(inFlight.has(channelId)||needsViewUpgrade(stored[key]?.channels?.[channelId]))){
        await getChannelUploads(channelId);if(version!==epoch)return;
        stored=await browser.storage.local.get([key,ChannelGroups.key]);
      }
      const entry=stored[key]?.channels?.[channelId]?.entries?.find(v=>v.videoId===videoId);
      const groups=stored[ChannelGroups.key]?.groups?.filter(g=>g.channelIds.includes(channelId))||[];
      if(!entry||!groups.length||!Ledger.videoDetailsDue(entry.details,Date.now(),groups.some(g=>g.hideShorts===true))&&!(checkViews&&Ledger.videoViewsDue(entry)))return;
      let details={status:'unavailable',checkedAt:Date.now(),shorts:'unknown'},views;
      try{
        const result=await network(async(fetchRequest)=>{
          const response=await fetchRequest('https://www.youtube.com/watch?v='+videoId,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
          globalThis.YouTubeRequests?.checkResponse(response);
          const final=new URL(response.url);
          if(!response.ok||final.origin!=='https://www.youtube.com'||final.pathname!=='/watch'||final.searchParams.get('v')!==videoId)throw new Error('Video page unavailable.');
          return parseVideoDetails(await readPlayer(response),videoId,channelId);
        },job.options);
        if(!result)return;
        const {viewCount,...parsed}=result;details=parsed;
        if(viewCount!==undefined)views={count:viewCount,checkedAt:details.checkedAt};
      }catch(error){if(error.name==='YouTubeCooldownError'||error.retryAfter>Date.now())return;}
      details.viewsAttemptedAt=Date.now();
      await changeCache(cache=>{
        if(version!==epoch)return cache||{version:1,channels:{}};
        const current=cache?.channels?.[channelId]?.entries?.find(v=>v.videoId===videoId);
        if(current&&current.channelId===channelId){
          if(details.status==='unavailable'&&current.details?.status==='available'&&!Ledger.videoDetailsDue(current.details)){
            details={...details,status:'available',duration:current.details.duration};
          }
          // A transient lookup failure must not make a previously identified Short reappear.
          if(details.shorts==='unknown'&&typeof current.details?.shorts==='boolean')details.shorts=current.details.shorts;
          current.details=details;
          if(views&&(!current.views||views.checkedAt>=current.views.checkedAt))current.views=views;
        }
        return cache||{version:1,channels:{}};
      });
    }});detailQueue.push(job);});
    job.promise=task;detailJobs.set(identity,job);pumpDetails();task.then(()=>detailJobs.delete(identity),()=>detailJobs.delete(identity));return task;
  }
  function needsViewUpgrade(channel){
    return !!channel&&channel.viewsAttemptedAt===undefined&&(channel.entries||[]).slice(0,15).some(entry=>!Ledger.validVideoViews(entry.views));
  }
  async function getChannelUploads(channelId,force=false,background=false){
    if(!channelPattern.test(channelId))throw new Error('Choose a valid channel.');
    if(inFlight.has(channelId)){
      globalThis.YouTubeRequestLog?.skip({kind:'feed'},'reused');
      const job=inFlight.get(channelId);
      if(!background){job.options.priority=2;globalThis.YouTubeRequests?.wake();}
      return job.promise;
    }
    const version=epoch,options={priority:background?0:2,kind:'feed',reason:background?'background-refresh':force?'manual-refresh':'group-refresh',id:channelId,deferFeedFailure:!!globalThis.UploadsPage,cancelled:()=>version!==epoch};
    const task=(async()=>{
      const stored=(await browser.storage.local.get(key))[key]?.channels[channelId];
      if(version!==epoch)return;
      const now=Date.now(),due=stored?.error?Math.max(stored.retryAt||0,(stored.attemptedAt||0)+(options.priority>=2?15*60000:backgroundTTL)):(stored?.attemptedAt||0)+(options.priority>=2&&stored?.feedSource!=='uploads-page'?ttl:backgroundTTL);
      // Manual refresh may update healthy feeds sooner, but never bypass failure cooldowns.
      if(stored&&(stored.error?now<Math.max(due,stored.retryAfter||0):force?now<(stored.attemptedAt||0)+60000:!needsViewUpgrade(stored)&&now<due)){globalThis.YouTubeRequestLog?.skip(options,stored.error?'cooldown':'cache');return;}
      let entries,error='',retryAfter=0,feedSource='rss';
      const page=async()=>{
        feedSource='uploads-page';
        Object.assign(options,{reason:'uploads-page-fallback',minSpacing:10000,deferFeedFailure:false});
        return network(async fetchRequest=>{
          const response=await fetchRequest(UploadsPage.url(channelId),{credentials:'omit',signal:AbortSignal.timeout(15000)});
          globalThis.YouTubeRequests?.checkResponse(response);
          const final=new URL(response.url);
          if(!response.ok||final.origin!=='https://www.youtube.com'||final.pathname!=='/playlist'||final.searchParams.get('list')!=='UU'+channelId.slice(2))throw Error('YouTube could not load this channel’s uploads page.');
          return UploadsPage.parse(await UploadsPage.read(response),channelId);
        },options);
      };
      try{
        if(globalThis.UploadsPage&&stored?.feedSource==='uploads-page'&&stored.rssRetryAt>now)entries=await page();
        else try{entries=await network(async(fetchRequest)=>{
          const response=await fetchRequest('https://www.youtube.com/feeds/videos.xml?channel_id='+channelId,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
          try{globalThis.YouTubeRequests?.checkResponse(response);}catch(e){
            const message=response.status===429?'YouTube is limiting upload checks':response.status>=500?'YouTube’s upload feed is temporarily unavailable':response.status===404?'YouTube could not find this upload feed':response.status===403?'YouTube refused this upload feed':'YouTube could not refresh this channel';
            e.message=message+' (HTTP '+response.status+').';throw e;
          }
          if(!response.ok)throw Object.assign(new Error('YouTube could not refresh this channel (HTTP '+response.status+').'),{youtubeStatus:response.status});
          if(new URL(response.url).origin!=='https://www.youtube.com')throw new Error('YouTube redirected this upload feed.');
          return parse(await response.text(),channelId);
        },options);}
        catch(failure){if(!globalThis.UploadsPage?.eligible(failure)||version!==epoch)throw failure;entries=await page();}
      }catch(e){
        // A queued channel was not contacted. Do not mark it as a failed channel.
        if(e.name==='YouTubeCooldownError')return;
        retryAfter=e.retryAfter||0;
        error=e.name==='TimeoutError'||e.name==='AbortError'?'This channel took too long to respond.':e.name==='TypeError'?'Could not connect to YouTube’s upload feed.':String(e.message||'Could not refresh this channel.');
      }
      if(version!==epoch||!entries&&!error)return;
      await changeCache(cache=>{
        if(version!==epoch)return cache||{version:1,channels:{}};
        const next=merge(cache,channelId,entries,Date.now(),error,retryAfter),channel=next.channels[channelId];
        if(!error){channel.feedSource=feedSource;if(feedSource==='uploads-page')channel.rssRetryAt=stored?.rssRetryAt>now?stored.rssRetryAt:Date.now()+86400000;else delete channel.rssRetryAt;}
        return next;
      });
    })();
    inFlight.set(channelId,{promise:task,options});try{return await task;}finally{if(inFlight.get(channelId)?.promise===task)inFlight.delete(channelId);}
  }
  async function launchContext(group,entries){
    const token=crypto.randomUUID(), at=Date.now();
    const task=launchWrites.then(async()=>{
      const stored=(await browser.storage.session.get(launchKey))[launchKey]||{};
      const active=Object.entries(stored).filter(([,v])=>at-v.at<2*60*60*1000).sort((a,b)=>b[1].at-a[1].at).slice(0,31);
      await browser.storage.session.set({[launchKey]:{...Object.fromEntries(active),[token]:{at,groupId:group.id,groupName:group.name,videoIds:entries.map(v=>v.videoId)}}});
    });launchWrites=task.catch(()=>{});await task;return token;
  }
  async function handle(message,sender){
    if(!sender.tab||sender.tab.incognito||!/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||''))throw new Error('This page cannot open Ledger feeds.');
    if(message.type==='groupFeed:leave'){activeGroups.delete(sender.tab.id);return {ok:true};}
    if(message.type==='groupFeed:get'||message.type==='groupFeed:refresh')activeGroups.set(sender.tab.id,message.groupId);
    if(message.type==='groupFeed:source'){
      const context=(await browser.storage.session.get(launchKey))[launchKey]?.[message.token];
      if(!context||Date.now()-context.at>2*60*60*1000||!context.videoIds.includes(message.videoId))return {kind:'unknown',evidence:'unverified-link'};
      return {kind:'group',groupId:context.groupId,groupName:context.groupName,evidence:'group-feed-link'};
    }
    if(message.type==='groupFeed:checkAll'){
      if(checkingAll)return checkingAll;
      const version=epoch;checkingAll=(async()=>{
        const local=await browser.storage.local.get([ChannelGroups.key,key]),cache=local[key]?.channels||{};
        const ids=[...new Set((local[ChannelGroups.key]?.groups||[]).flatMap(g=>g.channelIds))].filter(id=>channelPattern.test(id)).sort((a,b)=>(cache[a]?.attemptedAt||0)-(cache[b]?.attemptedAt||0)).slice(0,200);
        for(const id of ids){if(version!==epoch)break;await getChannelUploads(id,false,true);if((await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now())break;}return {ok:true};
      })();try{return await checkingAll;}finally{checkingAll=null;}
    }
    const data=await browser.storage.local.get([ChannelGroups.key,key]), groups=data[ChannelGroups.key]||{groups:[],channels:{}};
    const group=groups.groups.find(g=>g.id===message.groupId);
    if(!group)throw new Error('This group no longer exists.');
    const ids=group.channelIds.filter(id=>channelPattern.test(id));
    if(message.type==='groupFeed:details'){
      if(!Array.isArray(message.videoIds)||message.videoIds.length>12||message.videoIds.some(id=>typeof id!=='string'||!videoPattern.test(id)))throw new Error('Choose valid videos.');
      const entries=new Map(ids.flatMap(id=>data[key]?.channels?.[id]?.entries||[]).map(v=>[v.videoId,v]));
      if(message.videoIds.some(id=>!entries.has(id)))throw new Error('These videos are no longer in the group feed.');
      const shortsFirst=message.shortsFirst===true&&group.hideShorts===true;
      const checkViews=!shortsFirst&&(message.checkViews===true||['views','rate'].includes(Ledger.groupSort(group.sort).metric));
      await Promise.all([...new Set(message.videoIds)].map(id=>getVideoDetails(id,entries.get(id).channelId,checkViews,shortsFirst,shortsFirst||!Array.isArray(message.visibleVideoIds)||message.visibleVideoIds.includes(id))));
      const latest=(await browser.storage.local.get(key))[key]?.channels||{};
      const values=message.videoIds.map(id=>[id,latest[entries.get(id).channelId]?.entries?.find(v=>v.videoId===id)]);
      return {details:Object.fromEntries(values.map(([id,e])=>[id,e?.details]).filter(([,value])=>Ledger.validVideoDetails(value))),views:Object.fromEntries(values.map(([id,e])=>[id,e?.views]).filter(([,value])=>Ledger.validVideoViews(value)))};
    }
    if(message.type==='groupFeed:refresh'){
      const version=epoch,targets=message.failedOnly===true?ids.filter(id=>data[key]?.channels?.[id]?.error):ids;
      let index=0;await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{while(index<targets.length&&version===epoch&&activeGroups.get(sender.tab.id)===group.id)await getChannelUploads(targets[index++],message.force===true);}));return {ok:true};
    }
    if(message.type!=='groupFeed:get')throw new Error('Unknown feed request.');
    const cache=data[key]?.channels||{}, entries=[...new Map(ids.flatMap(id=>cache[id]?.entries||[]).map(v=>[v.videoId,v])).values()].sort((a,b)=>b.publishedAt-a.publishedAt||a.videoId.localeCompare(b.videoId));
    return {...(await globalThis.YouTubeRequests?.status()),progress:globalThis.WatchStatus?await WatchStatus.read():{version:1,videos:{}},group,channels:ids.map(id=>({...groups.channels[id],id,fetchedAt:cache[id]?.fetchedAt||null,error:cache[id]?.error||'',retryAt:cache[id]?.retryAt||0,feedSource:cache[id]?.feedSource||'rss'})),entries,launchToken:entries.length?await launchContext(group,entries):null};
  }
  return {invalidate(){epoch++;inFlight.clear();},key,parse,parseVideoDetails,readPlayer,merge,getChannelUploads,handle,prune};
})();
