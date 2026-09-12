/* Local recent-upload cache. No account, API key, or remote Ledger service. */
globalThis.GroupFeeds = (() => {
  const key='channelUploads:v1', launchKey='groupLaunches:v1', ttl=15*60*1000, backgroundTTL=2*3600000;
  const inactiveAfter=90*86400000,inactiveTTL=86400000;
  const hour=3600000,day=86400000;
  const channelPattern=/^UC[A-Za-z0-9_-]{22}$/, videoPattern=/^[A-Za-z0-9_-]{11}$/;
  let writes=Promise.resolve(), launchWrites=Promise.resolve();
  const inFlight=new Map(),activeGroups=new Map();let epoch=0,checkingAll=null;
  const refreshRuns=new Map(),progressKey='groupRefreshProgress:v1';let progressWrites=Promise.resolve();
  function publishProgress(){
    // This small operational snapshot must reach content-script storage events;
    // Chrome's session storage is private to trusted extension contexts.
    const task=progressWrites.then(()=>browser.storage.local.set({[progressKey]:Object.fromEntries([...refreshRuns].map(([id,job])=>[id,{...job.progress}]))}));
    progressWrites=task.catch(()=>{});return progressWrites;
  }
  const network=(run,options)=>globalThis.YouTubeRequests?YouTubeRequests.run(run,options):run((url,init)=>fetch(url,options.timeoutMs?{...init,signal:AbortSignal.timeout(options.timeoutMs)}:init));
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
      const combined=new Map((old.entries||[]).map(v=>[v.videoId,v])),history=new Map((old.uploadHistory||[]).map(v=>[v.videoId,v]));
      for(const entry of entries){
        const previous=combined.get(entry.videoId)||history.get(entry.videoId);
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
      // A small history of dates survives video-cache eviction. Only successful
      // responses update evidence; repeated lookups never create extra samples.
      cache.channels[channelId].uploadHistory=uploadEvidence(cache.channels[channelId]).slice(0,32);
      // Keep the newest known upload even if global storage limits later evict
      // every video from this channel. Use reconciled dates so a rounded page
      // age cannot replace an exact date or drift forward on every refresh.
      // When an exact date corrects an estimate for the known latest video,
      // replace its old scalar too. Keep a legacy scalar if its video identity
      // was already evicted and we cannot establish which date it represented.
      const represented=[...(old.entries||[]),...(old.uploadHistory||[])].some(entry=>entry.publishedAt===old.latestUploadAt);
      const latest=latestUploadAt({...cache.channels[channelId],latestUploadAt:represented?undefined:old.latestUploadAt});
      if(latest!==undefined)cache.channels[channelId].latestUploadAt=latest;
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
      // Reuse upload results without promoting an automatic refresh just because
      // its cards are visible. A one-time legacy count upgrade retains its
      // two-hour floor: one shared feed avoids many individual watch requests.
      if(!job.shortsFirst&&checkViews&&(inFlight.has(channelId)||needsViewUpgrade(stored[key]?.channels?.[channelId]))){
        if(inFlight.has(channelId))await inFlight.get(channelId).promise;
        else if(uploadsDue(stored[key]?.channels?.[channelId],{background:true,countUpgrade:true})&&await backgroundAllowed(channelId))await getChannelUploads(channelId,false,true,false,true);
        if(version!==epoch)return;
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
  function latestUploadAt(channel){
    const dates=[channel?.latestUploadAt,...(channel?.entries||[]).map(entry=>entry.publishedAt),...(channel?.uploadHistory||[]).map(entry=>entry.publishedAt)].filter(at=>Number.isFinite(at)&&at>0);
    return dates.length?Math.max(...dates):undefined;
  }
  function uploadEvidence(channel){
    const known=new Map();
    for(const entry of [...(channel?.uploadHistory||[]),...(channel?.entries||[])]){
      if(!videoPattern.test(entry.videoId)||!Number.isFinite(entry.publishedAt)||entry.publishedAt<=0)continue;
      const old=known.get(entry.videoId),estimated=entry.publishedAtEstimated===true;
      if(old&&estimated&&(!old.publishedAtEstimated||old.publishedAt<entry.publishedAt))continue;
      known.set(entry.videoId,{videoId:entry.videoId,publishedAt:entry.publishedAt,...(estimated?{publishedAtEstimated:true}:{})});
    }
    return [...known.values()].sort((a,b)=>b.publishedAt-a.publishedAt||a.videoId.localeCompare(b.videoId));
  }
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
  function uploadPattern(dates){
    // Prefer the latest six releases, not a lifetime average. Time-of-day
    // fitting is circular so midnight, year boundaries and modest clock shifts
    // do not split a cluster. No creator time zone is guessed.
    const sample=dates.slice(0,6);if(sample.length<6)return null;
    const gaps=sample.slice(1).map((at,i)=>sample[i]-at),typical=median(gaps),tolerance=90*60000;
    for(const period of [day,7*day]){
      if(typical<period*.75||typical>period*1.25||gaps[0]<period*.6||gaps.some(gap=>gap>3*period))continue;
      for(const anchor of sample){
        const aligned=sample.map(at=>at-Math.round((at-anchor)/period)*period),origin=median(aligned);
        if(aligned.filter(at=>Math.abs(at-origin)<=tolerance).length<5)continue;
        if(new Set(sample.map(at=>Math.round((at-origin)/period))).size!==sample.length)continue;
        if(Math.abs(sample[0]-origin-Math.round((sample[0]-origin)/period)*period)>Math.min(day,period/4))continue;
        return {period,origin};
      }
    }
    return null;
  }
  function automaticSchedule(channel,now=Date.now()){
    const latest=latestUploadAt(channel),confirmed=Math.min(channel?.fetchedAt||0,now),attempt=channel?.attemptedAt||0;
    let interval=backgroundTTL,mode='regular',pattern=null,label='',reason='Regular checks while there is not yet a reliable upload pattern.';
    if(latest!==undefined&&confirmed>0&&confirmed-latest>=inactiveAfter){
      interval=inactiveTTL;mode='inactive';label='Checked daily';reason='No known uploads for at least 90 days at the last successful check.';
    }else if(latest!==undefined&&confirmed>=latest){
      const evidence=uploadEvidence(channel).filter(entry=>entry.publishedAt<=confirmed&&entry.publishedAt>=confirmed-365*day);
      // Rounded page ages and future/unconfirmed timestamps cannot establish a
      // clock schedule. A new approximate upload also invalidates an old model.
      const dates=[...new Set(evidence.filter(entry=>!entry.publishedAtEstimated).map(entry=>entry.publishedAt))].slice(0,12);
      if(dates.length>=6&&dates[0]===latest){
        const gaps=dates.slice(1,6).map((at,i)=>dates[i]-at),typical=median(gaps),previous=uploadPattern(dates.slice(1));
        const offset=previous?latest-previous.origin-Math.round((latest-previous.origin)/previous.period)*previous.period:0;
        // An ordinary late arrival fulfills this release; it is not a burst or
        // a new schedule. Repeated shifts still move the recent sample's center.
        const offSchedule=previous&&(offset< -90*60000||offset>Math.min(day,previous.period/4));
        const burst=gaps[0]<typical*.55||previous&&gaps[0]<previous.period*.6,returning=gaps[0]>Math.max(30*day,typical*3);
        if(now-latest<3*day&&(offSchedule||burst||returning)){
          mode='activity';label='Checking more often';reason='Recent uploads differ from the previous pattern. Checking every two hours while the schedule settles.';
        }else{
          pattern=uploadPattern(dates);
          if(pattern&&now-latest>Math.min(3*pattern.period,28*day))pattern=null;
          if(gaps.filter(gap=>gap>=2*day).length>=4&&gaps[0]>=2*day&&gaps.every(gap=>gap<=typical*3)&&typical>=3*day)interval=typical>=6*day?day:12*hour;
          if(pattern)interval=pattern.period===day?6*hour:day;
          // A temporary burst may end without immediately providing six new
          // slow uploads. Successful checks can then establish a quieter period.
          if(confirmed-latest>=30*day)interval=day;
          else if(confirmed-latest>=7*day)interval=Math.max(interval,12*hour);
          if(interval>backgroundTTL){
            mode=pattern?'predicted':'infrequent';label=pattern?'Adaptive checks':interval===day?'Checked daily':'Less frequent checks';
            reason=pattern?'Usually uploads '+(pattern.period===day?'daily':'weekly')+'. Checks slow down between expected uploads.':'Recent upload history supports checking '+(interval===day?'daily':'every twelve hours')+'.';
          }
        }
      }
    }
    let nextCheckAt=attempt+interval,expectedAt=null;
    if(pattern){
      const first=pattern.origin+(Math.round((latest-pattern.origin)/pattern.period)+1)*pattern.period;
      expectedAt=first+Math.max(0,Math.floor((now-first)/pattern.period))*pattern.period;
      if(now>=expectedAt+day)expectedAt+=pattern.period;
      const targets=[15,75,195].map(minutes=>expectedAt+minutes*60000),end=expectedAt+day;
      if(confirmed>=targets[0]&&confirmed<end&&now<end){
        // Follow-ups are anchored to one expected release, not to failures or
        // repeated visits. Waking after several targets produces just one check.
        mode='late';label='Checking for an upload';reason='The expected upload has not appeared. Extra checks stop after one day.';
        const target=targets.find(at=>at>confirmed);
        const due=Math.max(attempt+hour,target??attempt+backgroundTTL);
        if(due<end){nextCheckAt=due;interval=backgroundTTL;}
      }else if(!channel?.error){
        const target=targets[0];
        // Avoid spending a request just before an expected upload. The daily
        // fallback is delayed by at most two hours to align this one check.
        if(target>=now&&target>=nextCheckAt&&target-nextCheckAt<=Math.min(interval/2,2*hour))nextCheckAt=target;
        else nextCheckAt=Math.min(nextCheckAt,target);
        nextCheckAt=Math.max(attempt+hour,nextCheckAt);
      }
    }
    if(channel?.error){
      // Only a successful check can establish or advance the late window.
      // Preserve its two-hour retry cadence after failures instead of reverting
      // to the baseline daily interval; server/global pauses still apply.
      nextCheckAt=Math.max(nextCheckAt,attempt+interval,channel.retryAt||0,channel.retryAfter||0);
    }
    return {mode,interval,nextCheckAt,expectedAt,label,reason};
  }
  const automaticInterval=(channel,now=Date.now())=>automaticSchedule(channel,now).interval;
  function uploadsDue(stored,{force=false,background=false,retryCooldown=false,countUpgrade=false}={},now=Date.now()){
    if(!stored)return true;
    if(stored.error)return retryCooldown||now>=(background?automaticSchedule(stored,now).nextCheckAt:Math.max(stored.retryAt||0,stored.retryAfter||0,(stored.attemptedAt||0)+ttl));
    if(force)return now>=(stored.attemptedAt||0)+60000;
    if(background)return countUpgrade&&needsViewUpgrade(stored)&&now>=(stored.attemptedAt||0)+backgroundTTL||now>=automaticSchedule(stored,now).nextCheckAt;
    return needsViewUpgrade(stored)||now>=(stored.attemptedAt||0)+(stored.feedSource!=='uploads-page'?ttl:backgroundTTL);
  }
  async function backgroundAllowed(channelId){
    const local=await browser.storage.local.get(['settings',...(channelId?[ChannelGroups.key]:[])]);
    if(local.settings?.backgroundGroupChecks===false)return false;
    if(channelId&&!local[ChannelGroups.key]?.groups?.some(group=>group.channelIds.includes(channelId)))return false;
    const tabs=await browser.tabs.query({url:['https://www.youtube.com/*','https://m.youtube.com/*'],discarded:false});
    return tabs.some(tab=>!tab.incognito);
  }
  async function leaveGroup(tabId){
    if(!activeGroups.delete(tabId))return;
    const local=await browser.storage.local.get(ChannelGroups.key),active=new Set(activeGroups.values());
    const visible=new Set((local[ChannelGroups.key]?.groups||[]).filter(group=>active.has(group.id)).flatMap(group=>group.channelIds));
    for(const [id,job]of inFlight)if(!visible.has(id)){
      job.options.priority=0;
      if(job.options.reason!=='uploads-page-fallback')job.options.reason='background-refresh';
    }
    globalThis.YouTubeRequests?.wake();
  }
  globalThis.browser?.tabs?.onRemoved?.addListener(tabId=>{void leaveGroup(tabId).catch(()=>{});});
  async function getChannelUploads(channelId,force=false,background=false,retryCooldown=false,countUpgrade=false){
    if(!channelPattern.test(channelId))throw new Error('Choose a valid channel.');
    if(inFlight.has(channelId)){
      globalThis.YouTubeRequestLog?.skip({kind:'feed'},'reused');
      const job=inFlight.get(channelId);
      if(!background){job.options.priority=2;globalThis.YouTubeRequests?.wake();}
      return job.promise;
    }
    const version=epoch,options={priority:background?0:2,kind:'feed',reason:background?'background-refresh':force?'manual-refresh':'group-refresh',id:channelId,minSpacing:retryCooldown?10000:0,timeoutMs:15000,deferFeedFailure:!!globalThis.UploadsPage,cancelled:async()=>version!==epoch||options.priority<2&&!await backgroundAllowed(channelId)};
    const task=(async()=>{
      const stored=(await browser.storage.local.get(key))[key]?.channels[channelId];
      if(version!==epoch)return;
      const now=Date.now();
      // Only an explicit, accepted local-cooldown reset retries failed channels
      // early. The shared scheduler still blocks every server-imposed pause.
      if(!uploadsDue(stored,{force,background:options.priority<2,retryCooldown,countUpgrade},now)){globalThis.YouTubeRequestLog?.skip(options,stored.error?'cooldown':'cache');return {outcome:stored.error?'waiting':'cached'};}
      let entries,error='',retryAfter=0,feedSource='rss';
      const page=async()=>{
        feedSource='uploads-page';
        Object.assign(options,{reason:'uploads-page-fallback',minSpacing:10000,timeoutMs:30000,deferFeedFailure:false});
        return network(async fetchRequest=>{
          const response=await fetchRequest(UploadsPage.url(channelId),{credentials:'omit'});
          globalThis.YouTubeRequests?.checkResponse(response);
          const final=new URL(response.url);
          if(!response.ok||final.origin!=='https://www.youtube.com'||final.pathname!=='/playlist'||final.searchParams.get('list')!=='UU'+channelId.slice(2))throw Error('YouTube could not load this channel’s uploads page.');
          return UploadsPage.parse(await UploadsPage.read(response),channelId);
        },options);
      };
      try{
        if(globalThis.UploadsPage&&stored?.feedSource==='uploads-page'&&stored.rssRetryAt>now)entries=await page();
        else try{entries=await network(async(fetchRequest)=>{
          const response=await fetchRequest('https://www.youtube.com/feeds/videos.xml?channel_id='+channelId,{credentials:'omit',cache:'no-store'});
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
        if(e.name==='YouTubeCooldownError')return {outcome:'cooldown'};
        retryAfter=e.retryAfter||0;
        const source=feedSource==='uploads-page'?'uploads page':'upload feed';
        error=e.name==='TimeoutError'||e.name==='AbortError'?'YouTube’s '+source+' did not finish loading within '+options.timeoutMs/1000+' seconds. Cached videos are kept.':e.name==='TypeError'?'Could not connect to YouTube’s '+source+'.':String(e.message||'Could not refresh this channel.');
      }
      if(version!==epoch||!entries&&!error)return;
      await changeCache(cache=>{
        if(version!==epoch)return cache||{version:1,channels:{}};
        const next=merge(cache,channelId,entries,Date.now(),error,retryAfter),channel=next.channels[channelId];
        if(!error){channel.feedSource=feedSource;if(feedSource==='uploads-page')channel.rssRetryAt=stored?.rssRetryAt>now?stored.rssRetryAt:Date.now()+86400000;else delete channel.rssRetryAt;}
        return next;
      });
      return {outcome:error?'failed':'refreshed'};
    })();
    inFlight.set(channelId,{promise:task,options});try{return await task;}finally{if(inFlight.get(channelId)?.promise===task)inFlight.delete(channelId);}
  }
  async function refreshGroup(group,channelIds,{force=false,retryCooldown=false,failedOnly=false,automatic=false}={}){
    const previous=refreshRuns.get(group.id);
    if(previous?.progress.running){if(!retryCooldown){if(!automatic){previous.automatic=false;previous.force||=force;}return previous.promise;}await previous.promise;}
    const version=epoch,targets=[...new Set(channelIds)],job={automatic,force,progress:{total:targets.length,checked:0,refreshed:0,cached:0,failed:0,running:true,paused:false,failedOnly}};
    refreshRuns.delete(group.id);refreshRuns.set(group.id,job);
    for(const [id,old]of refreshRuns)if(refreshRuns.size>200&&!old.progress.running)refreshRuns.delete(id);
    job.promise=(async()=>{
      await publishProgress();let index=0;
      try{
        const results=await Promise.allSettled(Array.from({length:Math.min(retryCooldown?1:4,targets.length)},async()=>{
          while(index<targets.length&&version===epoch){
            const background=job.automatic||![...activeGroups.values()].includes(group.id);
            if(background&&!await backgroundAllowed()||(await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now())break;
            if(index>=targets.length||version!==epoch)break;
            const result=await getChannelUploads(targets[index++],retryCooldown||!background&&job.force,background,retryCooldown);
            if(version!==epoch)break;
            if(['refreshed','cached','failed'].includes(result?.outcome)){job.progress.checked++;job.progress[result.outcome]++;await publishProgress();}
          }
        }));
        const error=results.find(result=>result.status==='rejected');if(error)throw error.reason;
        return {ok:true};
      }finally{
        if(version===epoch&&refreshRuns.get(group.id)===job){
          job.progress.running=false;job.progress.paused=(await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now();await publishProgress();
        }
      }
    })();return job.promise;
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
    if(message.type==='groupFeed:leave'){await leaveGroup(sender.tab.id);return {ok:true};}
    if(['groupFeed:get','groupFeed:refresh','groupFeed:retryCooldown'].includes(message.type)){
      if(message.visible===false)await leaveGroup(sender.tab.id);else activeGroups.set(sender.tab.id,message.groupId);
    }
    if(message.type==='groupFeed:source'){
      const context=(await browser.storage.session.get(launchKey))[launchKey]?.[message.token];
      if(!context||Date.now()-context.at>2*60*60*1000||!context.videoIds.includes(message.videoId))return {kind:'unknown',evidence:'unverified-link'};
      return {kind:'group',groupId:context.groupId,groupName:context.groupName,evidence:'group-feed-link'};
    }
    if(message.type==='groupFeed:checkAll'){
      if(checkingAll)return checkingAll;
      const version=epoch;checkingAll=(async()=>{
        if((await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now()||!await backgroundAllowed())return {ok:true};
        const local=await browser.storage.local.get([ChannelGroups.key,key]),cache=local[key]?.channels||{};
        const ids=[...new Set((local[ChannelGroups.key]?.groups||[]).flatMap(g=>g.channelIds))].filter(id=>channelPattern.test(id)&&uploadsDue(cache[id],{background:true})).sort((a,b)=>(cache[a]?.attemptedAt||0)-(cache[b]?.attemptedAt||0)).slice(0,200);
        for(const id of ids){if(version!==epoch||!await backgroundAllowed()||(await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now())break;await getChannelUploads(id,false,true);}return {ok:true};
      })();try{return await checkingAll;}finally{checkingAll=null;}
    }
    const data=await browser.storage.local.get([ChannelGroups.key,key]), groups=data[ChannelGroups.key]||{groups:[],channels:{}};
    const group=groups.groups.find(g=>g.id===message.groupId);
    if(!group)throw new Error('This group no longer exists.');
    const ids=group.channelIds.filter(id=>channelPattern.test(id));
    // Reading cached cards or returning to a tab must not promote background
    // uploads to the faster foreground queue. Only an explicit refresh does.
    if(message.visible!==false&&(message.type==='groupFeed:retryCooldown'||message.type==='groupFeed:refresh'&&message.automatic!==true)){for(const id of ids){const job=inFlight.get(id);if(job){job.options.priority=2;if(job.options.reason==='background-refresh')job.options.reason='group-refresh';}}globalThis.YouTubeRequests?.wake();}
    if(message.type==='groupFeed:retryCooldown'){
      if(!Number.isFinite(message.pausedUntil)||message.pausedUntil<=0)throw Error('Refresh this group to see its current cooldown.');
      if(!await globalThis.YouTubeRequests?.retryCooldown(message.pausedUntil))return {ok:true,retried:false};
      await refreshGroup(group,ids,{retryCooldown:true});
      return {ok:true,retried:true};
    }
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
      const targets=message.failedOnly===true?ids.filter(id=>data[key]?.channels?.[id]?.error):ids;
      const automatic=message.automatic===true;
      // Warm visits do not create a progress run or per-channel cache attempts.
      if(automatic&&(!targets.some(id=>uploadsDue(data[key]?.channels?.[id],{background:true}))||!await backgroundAllowed()||(await globalThis.YouTubeRequests?.status())?.pausedUntil>Date.now()))return {ok:true};
      return refreshGroup(group,targets,{force:!automatic&&message.force===true,failedOnly:message.failedOnly===true,automatic});
    }
    if(message.type!=='groupFeed:get')throw new Error('Unknown feed request.');
    const cache=data[key]?.channels||{}, entries=[...new Map(ids.flatMap(id=>cache[id]?.entries||[]).map(v=>[v.videoId,v])).values()].sort((a,b)=>b.publishedAt-a.publishedAt||a.videoId.localeCompare(b.videoId));
    return {...(await globalThis.YouTubeRequests?.status()),refresh:refreshRuns.get(group.id)?{...refreshRuns.get(group.id).progress}:null,progress:globalThis.WatchStatus?await WatchStatus.read():{version:1,videos:{}},group,channels:ids.map(id=>({...groups.channels[id],id,fetchedAt:cache[id]?.fetchedAt||null,error:cache[id]?.error||'',retryAt:cache[id]?.retryAt||0,feedSource:cache[id]?.feedSource||'rss',dailyChecks:automaticInterval(cache[id])===inactiveTTL,checkSchedule:automaticSchedule(cache[id])})),entries,launchToken:entries.length?await launchContext(group,entries):null};
  }
  return {invalidate(){epoch++;inFlight.clear();refreshRuns.clear();void publishProgress();},key,parse,parseVideoDetails,readPlayer,merge,automaticInterval,automaticSchedule,getChannelUploads,handle,prune};
})();
