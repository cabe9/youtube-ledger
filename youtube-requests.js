/* Pace Ledger's public metadata lookups. Playback and image loading are separate. */
globalThis.YouTubeRequests = (() => {
  const key='youtubeRequests:v1',queue=[];
  let state,loading,busy=false,timer;
  function pauseInfo(){
    const pausedUntil=state.pausedUntil>Date.now()?state.pausedUntil:0;
    if(!pausedUntil)return {pausedUntil:0,pauseScope:'all',pauseReason:'unknown',pauseMessage:''};
    const time=new Date(pausedUntil).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const reason={'feed-failures':'Several channel upload feeds failed.','feed-not-found':'Three channel upload checks returned HTTP 404 without a successful upload check.','http-403':'YouTube returned HTTP 403.','http-429':'YouTube returned HTTP 429.','retry-after':'YouTube asked Ledger to wait before retrying.'}[state.pauseReason]||'A previous cooldown is still active.';
    const pauseMessage=(state.pauseScope==='automatic'?'Automatic ':'')+'YouTube checks are paused until '+time+'. '+reason+(state.pauseScope==='automatic'?' You can still add channels manually.':'');
    return {pausedUntil,pauseScope:state.pauseScope,pauseReason:state.pauseReason,pauseMessage};
  }
  const cooldownError=()=>Object.assign(new Error(pauseInfo().pauseMessage+' Cached videos are still available.'),{name:'YouTubeCooldownError',retryAfter:state.pausedUntil});
  async function ready(){
    if(!loading)loading=(async()=>{
      const saved=(await browser.storage.local.get(key))[key]||{},now=Date.now();
      const time=value=>Number.isFinite(value)&&value>=0?Math.min(value,now+86400000):0;
      // Older failure records lack HTTP status; they cannot safely count toward
      // the new thresholds. An already active cooldown still keeps its scope.
      const failures=Array.isArray(saved.failures)?saved.failures.filter(v=>v&&typeof v.id==='string'&&Number.isFinite(v.at)&&v.at<=now&&now-v.at<300000&&Number.isInteger(v.status)&&v.status>=0&&v.status<600):[];
      state={lastFeedSuccessAt:Math.min(time(saved.lastFeedSuccessAt),now),lastStartedAt:Math.min(time(saved.lastStartedAt),now),pausedUntil:time(saved.pausedUntil),level:Math.min(4,Math.max(0,Number(saved.level)||0)),failures:[...new Map(failures.map(v=>[v.id,v])).values()].slice(-6),successes:0};
      state.pauseReason=['feed-failures','feed-not-found','http-403','http-429','retry-after'].includes(saved.pauseReason)?saved.pauseReason:'unknown';
      // Older cooldowns have no recorded cause, so keep their original scope.
      state.pauseScope=saved.pauseScope==='automatic'&&['feed-failures','feed-not-found'].includes(state.pauseReason)?'automatic':'all';
    })();
    await loading;
  }
  const save=()=>browser.storage.local.set({[key]:{...state,...pauseInfo()}});
  function checkResponse(response){
    if(response.ok)return;
    const raw=response.headers?.get('Retry-After'),now=Date.now();
    const retry=raw?(/^\d+$/.test(raw)?now+Number(raw)*1000:Date.parse(raw)):0;
    throw Object.assign(new Error('YouTube request failed (HTTP '+response.status+').'),{youtubeStatus:response.status,retryAfter:Number.isFinite(retry)?Math.max(0,Math.min(now+86400000,retry)):0});
  }
  function record(error,options){
    const now=Date.now();
    state.failures=state.failures.filter(v=>now-v.at<300000&&(options.kind!=='feed'||v.id!==options.id));
    if(!error){
      if(options.kind==='feed'){
        state.lastFeedSuccessAt=now;
        // A working feed breaks the missing-feed run. Isolated 404s retain
        // their per-channel backoff without blocking the rest of the groups.
        state.failures=state.failures.filter(v=>v.status!==404);
        if(++state.successes>=3){state.level=0;state.failures=[];}
      }
      return;
    }
    // An eligible RSS failure has one paced uploads-page fallback. Count the
    // completed channel check toward the failure guard; explicit refusals still stop immediately.
    if(options.deferFeedFailure&&globalThis.UploadsPage?.eligible(error))return;
    state.successes=0;
    if(options.kind==='feed'&&typeof options.id==='string')state.failures.push({id:options.id,at:now,status:error.youtubeStatus||0});
    const missingFeeds=state.failures.filter(v=>v.status===404).length;
    const failedRun=state.failures.filter(v=>v.at>state.lastFeedSuccessAt);
    const serverPause=error.youtubeStatus===403||error.youtubeStatus===429||error.retryAfter>now;
    if(serverPause||state.failures.length-missingFeeds>=3||failedRun.length>=3){
      const delay=Math.min(2*3600000,15*60000*2**state.level);
      state.level=Math.min(4,state.level+1);
      state.pausedUntil=Math.max(now+delay,error.retryAfter||0);
      state.pauseScope=serverPause?'all':'automatic';
      state.pauseReason=error.youtubeStatus===403?'http-403':error.youtubeStatus===429?'http-429':serverPause?'retry-after':failedRun.length>=3&&failedRun.every(v=>v.status===404)?'feed-not-found':'feed-failures';
      state.failures=[];error.retryAfter=state.pausedUntil;
    }
  }
  function wake(){
    if(busy)return;
    if(timer){clearTimeout(timer);timer=null;}
    void pump();
  }
  async function pump(){
    busy=true;
    try{
      await ready();
      // Process a user's reset between requests, so an in-flight server refusal
      // is recorded before deciding whether the cooldown can be cleared.
      if(queue[0]?.control){
        const job=queue.shift();
        try{job.resolve(await job.operation());}catch(error){job.reject(error);}
        return;
      }
      if(state.pausedUntil>Date.now()){
        // Ordinary feed failures stop automatic work, not an explicit channel
        // addition. Server refusals and Retry-After still stop every lookup.
        for(let i=queue.length-1;i>=0;i--){
          const job=queue[i],manual=job.options.kind==='channel'&&job.options.priority>=3;
          if(state.pauseScope!=='automatic'||!manual){queue.splice(i,1);globalThis.YouTubeRequestLog?.skip(job.options,'cooldown');job.reject(cooldownError());}
        }
      }else{state.pausedUntil=0;state.pauseReason='unknown';state.pauseScope='all';}
      queue.sort((a,b)=>(b.options.priority||0)-(a.options.priority||0));
      const job=queue[0];if(!job)return;
      // Foreground work can move ahead of background work even during a wait.
      const spacing=Math.max(job.options.priority>=2?2000:10000,job.options.minSpacing||0);
      const wait=state.lastStartedAt+spacing-Date.now();
      if(wait>0){timer=setTimeout(()=>{timer=null;wake();},wait);return;}
      queue.shift();
      if(job.options.cancelled?.()){globalThis.YouTubeRequestLog?.skip(job.options,'cancelled');job.resolve();return;}
      state.lastStartedAt=Date.now();
      try{
        // Persist pacing before the request, including across worker restarts.
        await save();
        // Storage/logging can delay dispatch. Start the next spacing interval
        // from the actual fetch, not from the earlier bookkeeping.
        const fetchRequest=(...args)=>{state.lastStartedAt=Date.now();return globalThis.fetch(...args);};
        const value=await (globalThis.YouTubeRequestLog?YouTubeRequestLog.run(job.operation,job.options,fetchRequest):job.operation(fetchRequest));record(null,job.options);await save();job.resolve(value);
      }catch(error){record(error,job.options);await save().catch(()=>{});job.reject(error);}
    }catch(error){for(const job of queue.splice(0))job.reject(error);}
    finally{busy=false;if(queue.length&&!timer)wake();}
  }
  function run(operation,options={}){
    return new Promise((resolve,reject)=>{queue.push({operation,options,resolve,reject});wake();});
  }
  function retryCooldown(expectedUntil){
    return new Promise((resolve,reject)=>{
      queue.unshift({control:true,resolve,reject,operation:async()=>{
        if(state.pausedUntil<=Date.now())return false;
        if(state.pauseScope!=='automatic')throw cooldownError();
        // A double click or a stale tab cannot clear a newly triggered pause.
        if(state.pausedUntil!==expectedUntil)return false;
        Object.assign(state,{pausedUntil:0,pauseScope:'all',pauseReason:'unknown',failures:[],successes:0});
        // Preserve request spacing and escalation if these new checks also fail.
        await save();return true;
      }});wake();
    });
  }
  return {key,run,wake,checkResponse,retryCooldown,async status(){await ready();return pauseInfo();},async diagnostics(){await ready();return {...pauseInfo(),queued:queue.filter(job=>!job.control).length,busy};}};
})();
