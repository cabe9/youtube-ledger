/* Acknowledged writes and persistent health reporting for the playback collector. */
globalThis.LedgerRecording=(()=>{
  const key='recordingStatus:v1';
  const youtube=sender=>sender.tab&&!sender.tab.incognito&&/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||'');
  const dashboard=sender=>(sender.url||'').split(/[?#]/)[0]===browser.runtime.getURL('dashboard.html');
  async function badge(warning){try{await browser.action.setBadgeText({text:warning?'!':''});}catch{}}
  async function problem(error,lostSeconds=0){
    try{const [local,session]=await Promise.all([browser.storage.local.get(key),browser.storage.session.get(key)]);lostSeconds=Math.max(lostSeconds,local[key]?.lostSeconds||0,session[key]?.lostSeconds||0);}catch{}
    const quota=LedgerStorage.quotaError(error),value={at:Date.now(),message:quota?
      'Ledger ran out of storage. Download a backup, then delete older history to free space. Keep affected YouTube tabs open so recent activity can retry.':
      'Ledger had trouble saving activity. Keep affected YouTube tabs open to retry, and check your recent history.',lostSeconds};
    // The reserved bytes allow a warning to persist even when history fills local storage.
    try{await browser.storage.local.remove(LedgerStorage.reserveKey);await browser.storage.local.set({[key]:value});}
    catch{try{await browser.storage.session.set({[key]:value});}catch{}}
    await badge(true);return {ok:false,recordingError:value.message};
  }
  async function events(message,sender){
    if(!youtube(sender))return {ok:false};
    if((await browser.storage.local.get('paused')).paused)return {ok:true,discarded:true};
    const tracked=message.recorderId!==undefined;
    if(tracked&&(!/^[-\w]{36}$/.test(message.recorderId)||!Number.isSafeInteger(message.sequence)||message.sequence<1))throw Error('Invalid recording batch.');
    const grouped={},originals=[];
    for(const event of (Array.isArray(message.events)?message.events:[]).slice(0,100)){
      if(!Ledger.states.includes(event.state)||typeof event.id!=='string'||!event.id||event.id.length>200||!Number.isFinite(event.start)||!Number.isFinite(event.end)||event.end-event.start>5000||event.end<=event.start)continue;
      originals.push(event);
      for(const piece of Ledger.pieces(event))(grouped['day:'+piece.day]||=[]).push(piece);
    }
    const stored=await browser.storage.local.get(Object.keys(grouped)),accepted=new Set();
    for(const [day,events] of Object.entries(grouped)){
      const rows=stored[day]||[],duplicates=new Set(rows.filter(row=>tracked&&(row._receipts?.[message.recorderId]||0)>=message.sequence).map(row=>row.id));
      for(const event of events){
        if(duplicates.has(event.id))continue;
        Ledger.add(rows,event);accepted.add(event.id);
        if(tracked){const row=rows.find(r=>r.id===event.id);(row._receipts||={})[message.recorderId]=message.sequence;}
      }
      stored[day]=rows;
    }
    if(!accepted.size)return {ok:true};
    const progress=await WatchStatus.read();
    for(const event of originals)if(accepted.has(event.id))WatchStatus.add(progress,event);
    stored[WatchStatus.key]=progress;
    // Receipts commit with history and progress. A lost reply can be retried after
    // worker restart without adding the same seconds or resetting watch state twice.
    try{await LedgerStorage.saveHistory(stored);return {ok:true};}
    catch(error){return problem(error);}
  }
  async function handle(message,sender){
    if(message.type==='recording:open'&&youtube(sender)){await browser.tabs.create({url:browser.runtime.getURL('dashboard.html')+'#settings'});return {ok:true};}
    if(message.type==='recording:dismiss'){
      if(!dashboard(sender)||sender.tab?.incognito)return {ok:false};
      return LedgerStorage.write(async()=>{await browser.storage.local.remove(key);await browser.storage.session.remove(key);await badge(false);await LedgerStorage.reserve();return {ok:true};});
    }
    if(message.type==='recording:problem'&&youtube(sender))return LedgerStorage.write(()=>problem(new Error('Playback buffer filled'),Number.isFinite(message.lostSeconds)?Math.max(0,message.lostSeconds):0));
    return {ok:false};
  }
  LedgerStorage.write(async()=>{
    await LedgerStorage.reserve();
    const [local,session]=await Promise.all([browser.storage.local.get(key),browser.storage.session.get(key)]);
    await badge(!!(local[key]||session[key]));
  }).catch(()=>{});
  return {key,events,handle,problem};
})();
