/* Single flight and a durable request budget shared by every trigger.
 * Storage remains separate from direct playback; source failures never erase it. */
globalThis.AccountHistorySync = (() => {
  const permissions={origins:['https://myactivity.google.com/*']};
  const {minimumSyncInterval:minimumInterval,nextAllowedAt}=AccountHistory;
  function create(api,source,now=()=>Date.now()) {
    const {keys,minute}=AccountHistory;
    let flight=null,activeRead=null,edits=Promise.resolve();
    const serial=task=>{const result=edits.then(task);edits=result.catch(()=>{});return result;};
    async function configure(enabled) {
      if (enabled && !await api.permissions.contains(permissions)) throw new Error('Allow the optional history permission to enable syncing.');
      await serial(async()=>{
        const data=await api.storage.local.get(keys.config),config=data[keys.config] || {};
        await api.storage.local.set({[keys.config]:{...config,enabled:!!enabled,revision:(config.revision || 0)+1}});
      });
      if (!enabled) activeRead?.controller.abort();
      return {enabled:!!enabled};
    }
    async function run(options) {
      const initial=await api.storage.local.get(Object.values(keys));
      const config=initial[keys.config] || {},old=initial[keys.cache] || {},status=initial[keys.status] || {};
      if (!config.enabled) return {cache:old,disabled:true};
      // Automatic reads run at most daily on demand. One explicit read can
      // bypass that wait; manual checks have a 20-minute budget across restarts.
      const allowed=nextAllowedAt(old,status,options.force);
      if (now()<allowed) return {cache:old,cached:true,throttled:true,nextAllowedAt:allowed,error:status.error || null};
      if (status.manualRetry && !options.force) return {cache:old,cached:true,paused:true,error:status.error};
      const startedAt=now(),runId=String(startedAt)+':'+Math.random().toString(36).slice(2);
      const lastManualAttemptAt=options.force ? startedAt : status.lastManualAttemptAt || 0;
      const reader={controller:new AbortController()};activeRead=reader;
      // Persist before the first request so a worker crash cannot cause a retry storm.
      await api.storage.local.set({[keys.status]:{syncing:true,runId,startedAt,lastAttemptAt:startedAt,
        lastManualAttemptAt,nextAllowedAt:startedAt+minimumInterval,phase:'Reading recent Google activity…',failureCount:status.failureCount || 0,blockedCount:status.blockedCount || 0,
        // Keep a prior refusal until success, including if this retry is
        // interrupted or the worker exits before it records a result.
        error:status.error || null,errorCode:status.errorCode || null,httpStatus:status.httpStatus || null,
        retryAfterAt:status.retryAfterAt || 0,manualRetry:!!status.manualRetry || (status.blockedCount || 0)>0}});
      // This local call keeps a worker alive only during an already running read.
      // It never schedules or performs another history request.
      const keepAlive=setInterval(()=>api.storage.local.get(keys.config).catch(()=>{}),20000);
      let timeout;
      try {
        if (!await api.permissions.contains(permissions)) throw Object.assign(new Error('History permission was removed. Re-enable Cross-device history in Settings.'),{manualRetry:true});
        const day=Ledger.dayKey(startedAt),sinceDay=Ledger.datesEnding(day,7)[0];
        const knownDevices=Object.fromEntries((old.observations || []).filter(e=>e.device).map(e=>[e.videoId+':'+e.watchedAt,e.device]));
        const priorDays=[...new Set((old.observations || []).flatMap(e=>Ledger.datesEnding(Ledger.dayKey(e.watchedAt),2)))];
        const priorDirect=await api.storage.local.get(priorDays.map(day=>'day:'+day));
        // Only prior recovered imports are overlap evidence. Desktop playback,
        // including source observations reconciled to direct rows, cannot count.
        const previouslyRecovered=AccountHistory.project(old,Object.values(priorDirect).flatMap(rows=>Array.isArray(rows)?rows:[])).events;
        const knownRecoveredKeys=previouslyRecovered.map(e=>e.videoId+':'+e.watchedAt);

        const progress=async phase=>{
          if (reader.controller.signal.aborted) return;
          const data=await api.storage.local.get(keys.status),state=data[keys.status];
          if (state?.runId===runId && state.syncing) await api.storage.local.set({[keys.status]:{...state,phase}});
        };
        const result=await Promise.race([source.read({sinceDay,knownDevices,knownRecoveredKeys,expanded:options.force,signal:reader.controller.signal,onProgress:progress}),
          new Promise((_,reject)=>{timeout=setTimeout(()=>{reader.controller.abort();reject(new Error('History refresh timed out. Cached data is still available.'));},70000);})]);
        await progress('Saving recovered activity…');
        return await serial(async()=>{
          const current=await api.storage.local.get([keys.config,keys.cache]);
          const latestConfig=current[keys.config] || {},cache=current[keys.cache] || {};
          if (reader.controller.signal.aborted || !latestConfig.enabled || latestConfig.revision!==config.revision) return {cache,cancelled:true};
          if (cache.accountKey && cache.accountKey!==result.accountKey) throw Object.assign(new Error('The signed-in Google account changed. Sign back into the account used for the last sync.'),{manualRetry:true});
          const incoming=result.events.filter(e=>e.watchedAt>(cache.clearedThroughByDay?.[Ledger.dayKey(e.watchedAt)] || 0));
          const observations=AccountHistory.merge(cache.observations || [],incoming);
          const days=[...new Set(observations.flatMap(e=>Ledger.datesEnding(Ledger.dayKey(e.watchedAt),2)))];
          const direct=await api.storage.local.get(days.map(day=>'day:'+day));
          const projection=AccountHistory.project({observations},Object.values(direct).flatMap(value=>Array.isArray(value)?value:[]));
          const previousIds=new Set((cache.observations || []).map(e=>e.id)),incomingIds=new Set(incoming.map(e=>e.id));
          const next={...cache,schemaVersion:1,accountKey:result.accountKey,observations,sessions:projection.sessions,
            lastSuccessfulSync:now(),lastRecoveredCount:projection.events.filter(e=>incomingIds.has(e.id) && !previousIds.has(e.id)).length,
            lastMatchedDirectCount:projection.matchedDirectCount,coverage:{...result.coverage,completeness:result.coverage.completeness || 'unknown'},estimationModel:AccountHistory.model};
          // Retain source evidence once. Recovered events are a projection that
          // can change after direct writes; duplicating every title/URL doubles
          // storage cost on accounts with hundreds of Shorts a day.
          delete next.events;
          const quota=api.storage.local.QUOTA_BYTES;
          if (Number.isFinite(quota) && api.storage.local.getBytesInUse) {
            const [used,priorBytes]=await Promise.all([api.storage.local.getBytesInUse(null),api.storage.local.getBytesInUse(keys.cache)]);
            const nextBytes=new TextEncoder().encode(JSON.stringify(next)).length+keys.cache.length;
            const reserve=Math.min(2*1024*1024,quota/4);
            if (used-priorBytes+nextBytes>quota-reserve) throw new Error('Cross-device history storage is nearly full. Export and delete older days before syncing again. Existing history is kept; space is reserved for direct tracking.');
          }
          await api.storage.local.set({[keys.cache]:next,[keys.status]:{syncing:false,lastAttemptAt:startedAt,lastManualAttemptAt,nextAllowedAt:next.lastSuccessfulSync+minimumInterval,error:null,failureCount:0,blockedCount:0,manualRetry:false}});
          return {cache:next};
        });
      } catch (error) {
        const current=await api.storage.local.get([keys.cache,keys.config]);
        if (!current[keys.config]?.enabled || current[keys.config]?.revision!==config.revision) return {cache:current[keys.cache] || {},cancelled:true};
        const message=String(error?.message || error).slice(0,400),failureCount=(status.failureCount || 0)+1;
        // A refusal stops automatic sync until a deliberate manual retry. A
        // second refusal since the last success needs a full week of quiet.
        const blockedCount=(status.blockedCount || 0)+(error.code==='blocked'?1:0);
        const cooldown=(error.code==='blocked' ? (blockedCount>1?7*24:48) : Math.min(24,2**Math.min(failureCount-1,5)))*60*minute;
        const retryAfterAt=Number.isFinite(error.retryAfterAt) ? Math.max(0,error.retryAfterAt) : 0;
        await api.storage.local.set({[keys.status]:{syncing:false,runId,lastAttemptAt:startedAt,error:message,
          lastManualAttemptAt,nextAllowedAt:Math.max(now()+cooldown,retryAfterAt),retryAfterAt,failureCount,blockedCount,
          errorCode:error.code || null,httpStatus:error.httpStatus || null,manualRetry:blockedCount>0 || !!error.manualRetry}});
        return {cache:current[keys.cache] || {},error:message};
      } finally {
        reader.controller.abort();if(activeRead===reader) activeRead=null;
        clearInterval(keepAlive);clearTimeout(timeout);
        const current=await api.storage.local.get(keys.status),latest=current[keys.status];
        if (latest?.runId===runId && latest.syncing) await api.storage.local.set({[keys.status]:{...latest,syncing:false}});
      }
    }
    function sync(options={}) {
      if (!flight) flight=run({force:options.force===true}).finally(()=>{flight=null;});
      return flight;
    }
    function clearDay(day) {
      return serial(async()=>{
        const data=await api.storage.local.get(keys.cache),cache=data[keys.cache];
        if (!cache) return;
        const keep=event=>Ledger.dayKey(event.watchedAt)!==day;
        await api.storage.local.set({[keys.cache]:{...cache,observations:(cache.observations || []).filter(keep),events:(cache.events || []).filter(keep),
          sessions:(cache.sessions || []).filter(session=>Ledger.dayKey(session.startTime)!==day),
          clearedThroughByDay:{...cache.clearedThroughByDay,[day]:now()}}});
      });
    }
    return {sync,configure,clearDay};
  }
  return {create,permissions,minimumInterval,nextAllowedAt};
})();
