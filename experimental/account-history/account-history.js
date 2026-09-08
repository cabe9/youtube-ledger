/* Pure account-history normalization, reconciliation and estimation. No I/O. */
globalThis.AccountHistory = (() => {
  const keys = {config:'accountHistory:config',cache:'accountHistory:cache',status:'accountHistory:status'};
  const minute = 60000;
  const minimumSyncInterval=24*60*minute;
  const manualSyncInterval=20*minute;
  const nextAllowedAt=(cache={},status={},manual=false)=>Math.max(status.error ? status.nextAllowedAt || 0 : 0,
    manual ? (status.lastManualAttemptAt || 0)+manualSyncInterval : Math.max(status.lastAttemptAt || 0,cache.lastSuccessfulSync || 0)+minimumSyncInterval);
  const model = 'shorts-interval-union-v1';
  const videoPattern = /^[A-Za-z0-9_-]{11}$/;
  const channelPattern = /^UC[A-Za-z0-9_-]{22}$/;
  const clean = (value, limit=500) => typeof value === 'string' ? value.trim().slice(0,limit) : '';
  function parseDuration(text) {
    if (typeof text !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text.trim())) return null;
    const parts=text.trim().split(':').map(Number);
    if (parts.slice(1).some(n=>n>=60)) return null;
    const n=parts.reduce((a,b)=>a*60+b,0);
    return n>0 && n<=604800 ? n : null;
  }
  function parseWatchTime(day, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
    const match=String(text).match(/(?:^|\s)(\d{1,2}):(\d{2})\s*([AP]M)\b/i);
    if (!match || +match[1]<1 || +match[1]>12 || +match[2]>59) return null;
    const [y,m,d]=day.split('-').map(Number);
    const time=new Date(y,m-1,d,+match[1]%12+(match[3].toUpperCase()==='PM'?12:0),+match[2]);
    return Ledger.dayKey(+time)===day ? +time : null;
  }
  function normalize(input, accountKey='default') {
    if (!videoPattern.test(input?.videoId || '') || !['short','video'].includes(input.mediaType)) return null;
    const watchedAt=Number(input.watchedAt);
    if (!Number.isFinite(watchedAt) || watchedAt<946684800000 || watchedAt>Date.now()+minute*5) return null;
    const title=clean(input.title); if (!title) return null;
    const seconds=Number(input.videoDurationSeconds);
    const duration=input.videoDurationSeconds!=null && Number.isFinite(seconds) && seconds>0 && seconds<=604800 ? seconds : null;
    const at=Math.floor(watchedAt/minute)*minute;
    const occurrence=Number.isInteger(input.occurrence) && input.occurrence>=0 ? input.occurrence : 0;
    return {
      id:`${accountKey}:${input.videoId}:${at}:${occurrence}`,accountKey,
      videoId:input.videoId,title,channelName:clean(input.channelName,200),
      channelId:channelPattern.test(input.channelId || '') ? input.channelId : null,
      url:`https://www.youtube.com/${input.mediaType==='short'?'shorts/':'watch?v='}${input.videoId}`,
      watchedAt:at,timestampPrecision:'minute',timeZone:clean(input.timeZone,80),
      watchTimeText:clean(input.watchTimeText,100),videoDurationSeconds:duration,
      device:clean(input.device,80) || null,mediaType:input.mediaType,trackingMethod:'account-history',
      watchedSeconds:null,occurrence,sourceOrder:Number.isInteger(input.sourceOrder)?input.sourceOrder:0
    };
  }
  function merge(previous, incoming) {
    const map=new Map(previous.map(event=>[event.id,event]));
    for (const event of incoming) {
      const old=map.get(event.id);
      map.set(event.id,{...old,...event,device:event.device || old?.device || null});
    }
    return [...map.values()].sort((a,b)=>a.watchedAt-b.watchedAt || b.sourceOrder-a.sourceOrder || a.occurrence-b.occurrence);
  }
  function directMatch(event, directRows) {
    // A minute timestamp denotes a bucket, not an exact playback start. Never
    // dedupe by video/day alone: a later phone rewatch must survive.
    return directRows.some(row=>{
      if(row.videoId!==event.videoId)return false;
      const playback=Ledger.playbackSeconds(row.seconds)*1000;
      if(!playback)return false;
      const overlaps=([start,end])=>start<event.watchedAt+minute&&end>event.watchedAt;
      if(Array.isArray(row.playbackIntervals))return row.playbackIntervals.some(overlaps);
      // Older rows have no coverage. Match only when playback fills the span,
      // or the entire span falls in this one minute (so its playback must too).
      return overlaps([row.start,row.end])&&(
        playback>=row.end-row.start || row.start>=event.watchedAt&&row.end<=event.watchedAt+minute);
    });
  }
  function reconcile(observations, directRows) {
    const byVideo=new Map();
    for (const row of directRows) { if (!byVideo.has(row.videoId)) byVideo.set(row.videoId,[]);byVideo.get(row.videoId).push(row); }
    const recovered=[],matched=[];
    for (const event of observations) (directMatch(event,byVideo.get(event.videoId) || [])?matched:recovered).push(event);
    return {recovered,matched};
  }
  function estimateSessions(observations, matchedIds=new Set()) {
    const events=[...observations].sort((a,b)=>a.watchedAt-b.watchedAt || b.sourceOrder-a.sourceOrder || a.occurrence-b.occurrence);
    const sessions=[];let current=null,previous=null;
    for (const event of events) {
      if (event.mediaType!=='short' || matchedIds.has(event.id)) { current=null;previous=null;continue; }
      const joins=current && previous.videoDurationSeconds!=null &&
        Ledger.dayKey(previous.watchedAt)===Ledger.dayKey(event.watchedAt) && previous.accountKey===event.accountKey &&
        event.watchedAt-previous.watchedAt<=previous.videoDurationSeconds*1000+minute;
      if (!joins) {
        current={id:'short-session:'+event.id,startTime:event.watchedAt,endTime:event.watchedAt,eventCount:0,
          estimatedActiveMinutes:null,device:null,eventIds:[],estimationModel:model,trackingMethod:'account-history',
          label:'Estimated from synced history',intervals:[],devices:[]};
        sessions.push(current);
      }
      current.eventIds.push(event.id);current.eventCount++;current.devices.push(event.device);
      current.endTime=Math.max(current.endTime,event.watchedAt);
      if (event.videoDurationSeconds!=null) {
        // Minute-rounded starts and same-minute ties must not multiply time.
        // Estimate full-length intervals, union overlaps, and exclude idle gaps.
        const end=event.watchedAt+event.videoDurationSeconds*1000;
        current.intervals.push([event.watchedAt,end]);current.endTime=Math.max(current.endTime,end);
      }
      previous=event;
    }
    return sessions.map(session=>{
      let total=0,lastEnd=-Infinity;
      for (const [start,end] of session.intervals) { total+=Math.max(0,end-Math.max(start,lastEnd));lastEnd=Math.max(lastEnd,end); }
      session.estimatedActiveMinutes=session.intervals.length===session.eventCount ? total/minute : null;
      session.device=session.devices.every(device=>device && device===session.devices[0]) ? session.devices[0] : null;
      delete session.intervals;delete session.devices;
      return session;
    });
  }
  function project(cache={},directRows=[],days=null) {
    const observations=(cache.observations || []).filter(event=>!days || days.includes(Ledger.dayKey(event.watchedAt)));
    const {recovered,matched}=reconcile(observations,directRows);
    const sessions=estimateSessions(observations,new Set(matched.map(event=>event.id)));
    return {events:recovered,sessions,matchedDirectCount:matched.length,
      estimatedShortsMinutes:sessions.reduce((n,s)=>n+(s.estimatedActiveMinutes || 0),0),
      unestimatedShortCount:sessions.filter(s=>s.estimatedActiveMinutes===null).reduce((n,s)=>n+s.eventCount,0),
      recoveredShortCount:recovered.filter(e=>e.mediaType==='short').length,
      recoveredVideoCount:recovered.filter(e=>e.mediaType==='video').length};
  }
  const stale=(lastSuccessfulSync,maxAge,now=Date.now())=>!lastSuccessfulSync || now-lastSuccessfulSync>=maxAge || lastSuccessfulSync>now;
  return {keys,minute,minimumSyncInterval,manualSyncInterval,nextAllowedAt,model,clean,parseDuration,parseWatchTime,normalize,merge,directMatch,reconcile,estimateSessions,project,stale};
})();
