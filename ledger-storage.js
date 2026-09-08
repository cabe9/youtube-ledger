/* One local-write queue shared by tracking, groups, cache and restore. */
globalThis.LedgerStorage=(()=>{
  let pending=Promise.resolve();
  const cacheKey='channelUploads:v1',reserveKey='recordingReserve:v1',padding=' '.repeat(8192);
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const quotaError=error=>/quota|QUOTA_BYTES|storage.*full/i.test(String(error?.message||error));
  function trimCache(cache,budget){
    const result={version:1,channels:Object.fromEntries(Object.entries(cache?.channels||{}).map(([id,c])=>[id,{...c,entries:[]}]))};
    let remaining=budget-bytes(result);if(remaining<0)return {version:1,channels:{}};
    const entries=Object.values(cache?.channels||{}).flatMap(c=>c.entries||[]).sort((a,b)=>b.publishedAt-a.publishedAt);
    for(const entry of entries){const cost=bytes(entry)+1;if(cost>remaining)continue;result.channels[entry.channelId].entries.push(entry);remaining-=cost;}
    return result;
  }
  async function limitCache(cache){
    const local=browser.storage.local,quota=local.QUOTA_BYTES;
    if(!Number.isFinite(quota)||!local.getBytesInUse)return cache;
    const [used,old]=await Promise.all([local.getBytesInUse(null),local.getBytesInUse(cacheKey)]);
    return trimCache(cache,Math.max(0,quota-used+old-cacheKey.length-Math.min(2*1024*1024,quota/4)));
  }
  async function saveHistory(values){
    const local=browser.storage.local;
    try{await local.set(values);}
    catch(error){
      if(!quotaError(error))throw error;
      // Reclaim only upload metadata, never history, notes, icons, or watch state.
      const quota=local.QUOTA_BYTES;
      if(Number.isFinite(quota)&&local.getBytesInUse){
        const [used,old,cacheBytes,data]=await Promise.all([local.getBytesInUse(null),local.getBytesInUse(Object.keys(values)),local.getBytesInUse(cacheKey),local.get(cacheKey)]);
        const next=Object.entries(values).reduce((n,[key,value])=>n+key.length+bytes(value),0);
        const budget=quota-used+old+cacheBytes-next-cacheKey.length-8192;
        if(budget>=32&&data[cacheKey]){await local.set({...values,[cacheKey]:trimCache(data[cacheKey],budget)});return;}
      }
      await local.remove([cacheKey,reserveKey]);await local.set(values);
    }
  }
  async function reserve(){
    const local=browser.storage.local;
    try{const data=await local.get(reserveKey);if(!data[reserveKey])await local.set({[reserveKey]:padding});}catch{}
  }
  return {cacheKey,reserveKey,quotaError,trimCache,limitCache,saveHistory,reserve,write(task){const result=pending.then(task);pending=result.catch(()=>{});return result;}};
})();
