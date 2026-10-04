/* Optional encrypted sync through the on-computer native host. Credentials never enter backups. */
globalThis.LedgerLocalSync=(()=>{
  const key='localSync:v1',docKey='localSyncDocument:v1',alarm='ledger-local-sync',host='org.youtube_ledger.local_sync';
  let inFlight,timer;
  const clients=new Set();
  const permissionError=()=>Error('Local sync needs permission. Open Settings → Sync & data to allow sharing with the companion.');
  const model=()=>LedgerSyncModel;
  async function authorized(secret){
    const config=(await browser.storage.local.get(key))[key];
    if(!config?.enabled||config.consentVersion!==1||secret&&config.secret!==secret||!await LedgerConnections.syncAllowed())throw permissionError();
  }
  function connect(profile,secret){
    const port=browser.runtime.connectNative(host);let waiting,closed=false;
    port.onMessage.addListener(message=>{if(waiting){const w=waiting;waiting=null;clearTimeout(w.timer);message.error?w.reject(Error(message.error)):w.resolve(message);}});
    port.onDisconnect.addListener(()=>{const reason=port.error?.message||browser.runtime.lastError?.message||'';if(waiting){clearTimeout(waiting.timer);waiting.reject(Error('Local sync companion disconnected. Install it on this computer, then retry.'+(reason?' '+reason:'')));waiting=null;}});
    const client={close:()=>{if(closed)return;closed=true;clients.delete(client);if(waiting){clearTimeout(waiting.timer);waiting.reject(permissionError());waiting=null;}port.disconnect();},send:async message=>{
      await authorized(secret);if(closed)throw permissionError();
      return new Promise((resolve,reject)=>{waiting={resolve,reject,timer:setTimeout(()=>{waiting=null;client.close();reject(Error('Local sync companion did not respond.'));},15000)};port.postMessage({...message,profile});});
    }};clients.add(client);return client;
  }
  async function status(){const config=(await browser.storage.local.get(key))[key]||{},permitted=config.consentVersion===1&&await LedgerConnections.syncAllowed();return {enabled:!!config.enabled&&permitted,needsPermission:!!config.enabled&&!permitted,lastSync:config.lastSync||0,error:config.error||'',conflicts:config.conflicts||0};}
  async function capture(){return LedgerStorage.write(async()=>{
    const data=await browser.storage.local.get(null),config=data[key];if(!config?.enabled)return null;
    // Validate our portable data before putting any of it into sync.
    const portable=LedgerBackup.validate(LedgerBackup.wrap(data));
    const doc=model().capture(data[docKey]||model().empty(),portable,config.device);
    await browser.storage.local.set({[docKey]:doc});return {config,doc};
  });}
  async function perform(){
    let client;
    try{
      let local=await capture();if(!local)return;
      const secret=local.config.secret,profile=await model().namespace(secret);await authorized(secret);client=connect(profile,secret);
      for(let attempt=0;attempt<5;attempt++){
        const remote=await client.send({op:'get'});let text='';
        for(let part=0;part<remote.parts;part++)text+=(await client.send({op:'read',part})).data;
        let doc=remote.parts?model().merge(local.doc,await model().open(JSON.parse(text),secret)):local.doc;
        // Finish local writes and validate the complete merged profile before publishing.
        const prepared=await LedgerStorage.write(async()=>{
          const data=await browser.storage.local.get(null),config=data[key];if(!config?.enabled||config.secret!==secret)return null;
          await authorized(secret);
          const current=model().capture(data[docKey]||model().empty(),LedgerBackup.validate(LedgerBackup.wrap(data)),config.device);
          doc=model().merge(doc,current);
          const merged=model().materialize(doc);
          const checked=LedgerBackup.validate(LedgerBackup.wrap(merged));
          // Shared successful metadata must not erase this browser's backoff when
          // it has not actually learned a newer successful check from its peer.
          for(const [id,channel]of Object.entries(checked['channelUploads:v1']?.channels||{})){
            const previous=data['channelUploads:v1']?.channels?.[id];
            if(previous&&previous.fetchedAt>=channel.fetchedAt)for(const field of ['error','failures','retryAt','retryAfter','attemptedAt','viewsAttemptedAt'])if(Object.hasOwn(previous,field))channel[field]=previous[field];
          }
          if(globalThis.LedgerData)for(const old of LedgerData.expiredKeys(checked,data['dataPolicy:v1']?.retentionDays||0))delete checked[old];
          // Apply retention to sync too; an offline browser cannot resurrect expired local records.
          doc=model().capture(doc,checked,config.device);
          const obsolete=Object.keys(data).filter(k=>model().tracked(k)&&!Object.hasOwn(checked,k));
          const values=Object.fromEntries(Object.entries(checked).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(data[k])));
          // Empty deleted collections in the same atomic write as their baseline.
          // A failed separate remove could otherwise look like a new local edit next time.
          for(const k of obsolete)values[k]=k.startsWith('goals:')?'':/^(day|recommendations):/.test(k)?[]:k.startsWith('purposes:')?{}:k==='channelGroups:v1'?{version:1,groups:[],channels:{}}:k==='groupBrowsing:v1'?{version:1,groups:{}}:{version:1,[k==='channelUploads:v1'?'channels':'videos']:{}};
          const deletesHistory=Object.entries(data).some(([k,rows])=>k.startsWith('day:')&&rows.some(r=>!(checked[k]||[]).some(next=>next.id===r.id)));
          if(deletesHistory)values.recordingEpoch=crypto.randomUUID();
          // If quota rejects it, no existing data is removed.
          await browser.storage.local.set({...values,[docKey]:doc});
          if(values['channelGroups:v1']||values['channelUploads:v1'])globalThis.GroupFeeds?.invalidate?.();
          return {doc,config};
        });
        if(!prepared)return;
        const payload=JSON.stringify(await model().seal(prepared.doc,secret));
        await client.send({op:'begin',revision:remote.revision});
        for(let i=0;i<payload.length;i+=200000)await client.send({op:'append',data:payload.slice(i,i+200000)});
        const result=await client.send({op:'commit'});
        if(result.conflict){local=await capture();if(!local)return;continue;}
        await LedgerStorage.write(async()=>{const config=(await browser.storage.local.get(key))[key];if(config?.enabled&&config.secret===secret)await browser.storage.local.set({[key]:{...config,lastSync:Date.now(),error:'',conflicts:Object.keys(prepared.doc.conflicts).length}});});
        return;
      }
      throw Error('Both browsers are writing. Changes are safe locally; sync will retry.');
    }catch(error){
      await LedgerStorage.write(async()=>{const config=(await browser.storage.local.get(key))[key];if(config?.enabled)await browser.storage.local.set({[key]:{...config,error:String(error.message||error).slice(0,300)}});});
      throw error;
    }finally{client?.close();}
  }
  function sync(){if(!inFlight)inFlight=perform().finally(()=>{inFlight=null;});return inFlight;}
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{void sync().catch(()=>{});},3000);}
  function start(){
    browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(model().tracked))schedule();});
    browser.alarms.onAlarm.addListener(a=>{if(a.name===alarm)void sync().catch(()=>{});});
    browser.permissions?.onRemoved?.addListener(()=>{void (async()=>{
      if(await LedgerConnections.syncAllowed())return;
      for(const client of clients)client.close();
      clearTimeout(timer);await browser.alarms.clear(alarm);
      await LedgerStorage.write(async()=>{const config=(await browser.storage.local.get(key))[key];if(config?.enabled)await browser.storage.local.set({[key]:{...config,enabled:false,error:permissionError().message}});});
    })().catch(()=>{});});
    void browser.storage.local.get(key).then(data=>{if(data[key]?.enabled){browser.alarms.create(alarm,{periodInMinutes:1});schedule();}});
  }
  async function handle(message,sender){
    if(sender.incognito||sender.tab?.incognito||(sender.url||'').split(/[?#]/)[0]!==browser.runtime.getURL('dashboard.html'))throw Error('Open Ledger Settings to manage sync.');
    if(message.type==='localSync:status')return status();
    if(message.type==='localSync:run'){await sync();return status();}
    if(message.type==='localSync:conflicts'){const data=await browser.storage.local.get(docKey);return {format:'ledger-sync-conflicts',records:data[docKey]?.conflicts||{}};}
    if(message.type==='localSync:code'){const config=(await browser.storage.local.get(key))[key];return {code:config?.enabled?config.secret:''};}
    if(message.type==='localSync:disable'){
      await LedgerStorage.write(async()=>{const config=(await browser.storage.local.get(key))[key]||{};await browser.storage.local.set({[key]:{...config,enabled:false}});});
      for(const client of clients)client.close();
      clearTimeout(timer);await browser.alarms.clear(alarm);if(inFlight)await inFlight.catch(()=>{});
      await LedgerConnections.releaseDataPermissions(LedgerConnections.syncTypes);return status();
    }
    if(message.type==='localSync:enable'){
      if(!await LedgerConnections.syncAllowed())throw permissionError();
      const previous=(await browser.storage.local.get(key))[key];
      const secret=message.code||previous?.secret||model().newSecret();await model().namespace(secret);
      await LedgerStorage.write(async()=>{
        const data=await browser.storage.local.get([key,docKey]);
        if(data[key]?.secret&&data[key].secret!==secret)throw Error('This browser is paired to another sync profile. Disconnecting preserves that pairing; use a separate browser profile to join a different one.');
        await browser.storage.local.set({[key]:{...data[key],enabled:true,consentVersion:1,error:'',secret,device:data[key]?.device||crypto.randomUUID()}});
      });
      await browser.alarms.create(alarm,{periodInMinutes:1});await sync();return status();
    }
    throw Error('Unknown sync action.');
  }
  return {start,handle,sync,status};
})();
