/* Local diagnostics for Ledger lookups only. No telemetry or extra network calls. */
globalThis.YouTubeRequestLog=(()=>{
  const key='youtubeRequestLog:v1',limit=1000,retention=7;
  const kinds=['feed','video','channel'],reasons=['group-refresh','background-refresh','manual-refresh','uploads-page-fallback','shorts','video-details','views-and-details','channel-lookup','channel-portrait'];
  let state,loading,pending=Promise.resolve(),flushTimer,storageWarning='';
  const day=at=>{const d=new Date(at);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  function prune(){
    const rows=state.recent.length,days=Object.keys(state.days).length;
    const cutoff=new Date(Date.now());cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-retention+1);
    state.days=Object.fromEntries(Object.entries(state.days).filter(([date])=>date>=day(cutoff)));
    state.recent=state.recent.filter(entry=>entry.at>=+cutoff).slice(-limit);
    return rows!==state.recent.length||days!==Object.keys(state.days).length;
  }
  async function ready(){
    if(!loading)loading=(async()=>{
      const saved=(await browser.storage.local.get(key))[key];
      state=saved?.version===1&&Array.isArray(saved.recent)&&saved.days?structuredClone(saved):{version:1,since:Date.now(),days:{},recent:[]};
      // A worker may stop before receiving a response. Preserve the attempt,
      // without inventing an HTTP result or counting it as a server failure.
      for(const entry of state.recent)if(entry.result==='pending')entry.result='unfinished';
      if(prune())await save();
    })();
    await loading;
  }
  async function save(){
    clearTimeout(flushTimer);flushTimer=null;
    try{await browser.storage.local.set({[key]:state});storageWarning='';}
    catch{storageWarning='The request log could not be saved. Recent counts may be lost when the extension stops.';}
  }
  function change(update,immediate=true){
    const task=pending.then(async()=>{await ready();prune();const value=update();if(immediate)await save();else if(!flushTimer)flushTimer=setTimeout(()=>{flushTimer=null;void change(()=>{}).catch(()=>{});},500);return value;});
    pending=task.catch(()=>{});return task;
  }
  function bucket(at,kind){
    const date=day(at),daily=state.days[date]||(state.days[date]={});
    return daily[kind]||(daily[kind]={started:0,failed:0,background:0,cache:0,cooldown:0,reused:0,cancelled:0,statuses:{}});
  }
  const kindOf=options=>kinds.includes(options.kind)?options.kind:'other';
  function target(url){
    // Keep public lookup addresses only, dropping unrelated query parameters.
    try{const u=new URL(url);if(u.protocol!=='https:'||!['www.youtube.com','m.youtube.com'].includes(u.hostname))return '';
      if(u.pathname==='/watch')return u.origin+u.pathname+'?v='+encodeURIComponent(u.searchParams.get('v')||'');
      if(u.pathname==='/feeds/videos.xml')return u.origin+u.pathname+'?channel_id='+encodeURIComponent(u.searchParams.get('channel_id')||'');
      if(u.pathname==='/playlist'&&/^UU[A-Za-z0-9_-]{22}$/.test(u.searchParams.get('list')||''))return u.origin+u.pathname+'?list='+u.searchParams.get('list');
      return (u.origin+u.pathname).slice(0,400);
    }catch{return '';}
  }
  async function run(operation,options,fetchRequest=globalThis.fetch){
    const attempts=[];
    const tracked=async(url,init)=>{
      const entry={id:crypto.randomUUID(),at:Date.now(),kind:kindOf(options),reason:reasons.includes(options.reason)?options.reason:'',mode:options.priority>=2?'foreground':'background',url:target(url),result:'pending'};
      attempts.push(entry);
      await change(()=>{const b=bucket(entry.at,entry.kind);b.started++;if(entry.mode==='background')b.background++;state.recent.push(entry);state.recent=state.recent.slice(-limit);}).catch(()=>{});
      try{const response=await fetchRequest(url,init);entry.status=response.status;return response;}
      catch(error){entry.result=error.name==='TimeoutError'||error.name==='AbortError'?'timeout':'network';throw error;}
    };
    let failure;
    try{return await operation(tracked);}catch(error){failure=error;throw error;}
    finally{
      for(const entry of attempts){
        const result=entry.result!=='pending'?entry.result:entry.status>=400?'http-error':failure&&entry===attempts.at(-1)?'unusable':'ok';
        await change(()=>{
          // Clearing the log during an active request must not restore it.
          const found=state.recent.find(v=>v.id===entry.id);if(!found)return;
          Object.assign(found,{result,status:entry.status,ms:Math.max(0,Date.now()-entry.at)});
          const b=bucket(entry.at,entry.kind);if(result!=='ok')b.failed++;
          const status=entry.status?String(entry.status):result;b.statuses[status]=(b.statuses[status]||0)+1;
        }).catch(()=>{});
      }
    }
  }
  function skip(options,reason){
    if(!['cache','cooldown','reused','cancelled'].includes(reason))return;
    void change(()=>{bucket(Date.now(),kindOf(options))[reason]++;},false).catch(()=>{});
  }
  async function snapshot(){await pending;await ready();if(prune())await save();return {...structuredClone(state),storageWarning,retentionDays:retention,recentLimit:limit,generatedAt:Date.now()};}
  async function handle(message,sender){
    if(sender.incognito||sender.tab?.incognito||(sender.url||'').split(/[?#]/)[0]!==browser.runtime.getURL('dashboard.html'))throw Error('Open Ledger Settings to view the request log.');
    if(message.type==='requestLog:clear')await change(()=>{state={version:1,since:Date.now(),days:{},recent:[]};});
    else if(message.type!=='requestLog:get')throw Error('Unknown request log action.');
    return snapshot();
  }
  return {key,run,skip,snapshot,handle};
})();
