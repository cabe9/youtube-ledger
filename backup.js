/* Portable, explicit local backup. Review exports are deliberately a different format. */
globalThis.LedgerBackup=(()=>{
  const format='youtube-ledger-backup', maxBytes=100*1024*1024;
  const dateKey=/^(day|recommendations|purposes|goals):\d{4}-\d{2}-\d{2}$/;
  const fixed=['settings','paused','channelGroups:v1','channelUploads:v1','videoProgress:v1','groupBrowsing:v1'];
  const known=k=>fixed.includes(k)||dateKey.test(k);
  const fail=()=>{throw new Error('This backup contains invalid or unsupported Ledger data.');};
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const text=(v,n)=>typeof v==='string'&&v.length<=n;
  const number=v=>Number.isFinite(v)&&v>=0;
  const video=v=>typeof v==='string'&&/^[\w-]{11}$/.test(v);
  const channel=v=>typeof v==='string'&&/^UC[\w-]{22}$/.test(v);
  function validate(backup){
    if(backup?.format!==format||backup.schemaVersion!==1||!object(backup.data))throw new Error('Choose a full Ledger backup, not a daily review export.');
    if(JSON.stringify(backup).length>maxBytes)throw new Error('This backup is over 100 MB.');
    const data=JSON.parse(JSON.stringify(backup.data));
    // Reject prototype keys throughout, including maps embedded in otherwise valid data.
    function safe(v){if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail();safe(x);}}safe(data);
    for(const [key,value] of Object.entries(data)){
      if(!known(key))fail();
      if(dateKey.test(key)){
        const day=key.slice(key.indexOf(':')+1);if(Ledger.datesEnding(day,1)[0]!==day)fail();
      }
      if(key.startsWith('day:')){
        if(!Array.isArray(value))fail();
        for(const r of value){
          if(!object(r)||!text(r.id,200)||!r.id||!(r.videoId===''||video(r.videoId))||!text(r.title,5000)||!text(r.channel,1000)||!number(r.start)||!number(r.end)||r.end<r.start||!object(r.seconds)||!Ledger.states.every(s=>number(r.seconds[s]))||!Ledger.labels.includes(r.label))fail();
          if(typeof r.url!=='string')fail();
          let url;try{url=new URL(r.url);}catch{fail();}
          if(url.protocol!=='https:'||!['www.youtube.com','m.youtube.com','youtube.com'].includes(url.hostname)||url.username||url.password)fail();
          r.source=Ledger.source(r.source);r.journey=Ledger.journey(r.journey);
          if(r.channelUrl!==undefined&&!Ledger.channelURL(r.channelUrl))fail();
          if(r.channelAvatarUrl!==undefined&&(!r.channelUrl||!Ledger.avatarURL(r.channelAvatarUrl)))fail();
          if(r.playbackIntervals!==undefined&&(!Array.isArray(r.playbackIntervals)||r.playbackIntervals.length>2048||r.playbackIntervals.some((range,i)=>!Array.isArray(range)||range.length!==2||!number(range[0])||!number(range[1])||range[1]<=range[0]||range[0]<r.start||range[1]>r.end||i>0&&range[0]<=r.playbackIntervals[i-1][1])))fail();
          if(r._receipts!==undefined&&(!object(r._receipts)||Object.entries(r._receipts).some(([id,sequence])=>!/^[-\w]{36}$/.test(id)||!Number.isSafeInteger(sequence)||sequence<1)))fail();
        }
      }else if(key.startsWith('goals:')){if(!text(value,1000000))fail();}
      else if(key.startsWith('purposes:')){if(!object(value)||Object.entries(value).some(([k,v])=>!(k==='browsing'||/^video:[\w-]{11}$/.test(k))||!['Mixed',...Ledger.labels].includes(v)))fail();}
      else if(key.startsWith('recommendations:')){
        if(!Array.isArray(value)||value.some(e=>!object(e)||!text(e.id,200)||!['reveal','visible','hide'].includes(e.kind)||!number(e.at)||!text(e.page,2000)))fail();
      }else if(key==='paused'){if(typeof value!=='boolean')fail();}
      else if(key==='settings'){if(!object(value))fail();data[key]=Ledger.settings(value);}
      else if(key==='channelGroups:v1'){
        if(value?.collapsed!==undefined&&typeof value.collapsed!=='boolean')fail();
        if(value?.version!==1||!Array.isArray(value.groups)||value.groups.length>200||!object(value.channels)||new Set(value.groups.map(g=>g.id)).size!==value.groups.length)fail();
        let budget=0;
        for(const [id,c] of Object.entries(value.channels))if(!channel(id)||c.id!==id||!text(c.name,200)||c.url!=='https://www.youtube.com/channel/'+id)fail();
        for(const c of Object.values(value.channels)){
          if(c.avatarUrl!==undefined&&!Ledger.avatarURL(c.avatarUrl))fail();
          if(c.avatarCheckedAt!==undefined&&!number(c.avatarCheckedAt))fail();
        }
        for(const g of value.groups){
          if(!text(g.id,100)||!g.id||!text(g.name,80)||!g.name.trim()||!Array.isArray(g.channelIds)||g.channelIds.length>2000||g.channelIds.some(id=>!value.channels[id])||!number(g.createdAt)||!number(g.updatedAt))fail();
          if(g.icon!==undefined){g.icon=GroupIcons.normalize(g.icon);if(g.icon.kind==='image')budget+=g.icon.value.length;}
          if(g.sort!==undefined&&!Object.hasOwn(Ledger.groupSorts,g.sort))fail();
          if(g.hideShorts!==undefined&&typeof g.hideShorts!=='boolean')fail();
          if(g.watchFilter&&!['all','started','watched','unwatched','hidden'].includes(g.watchFilter))fail();
        }
        if(budget>GroupIcons.imageBudget)fail();
      }else if(key==='channelUploads:v1'){
        if(value?.version!==1||!object(value.channels))fail();let count=0;
        for(const [id,c] of Object.entries(value.channels)){
          if(!channel(id)||!Array.isArray(c.entries)||c.entries.length>250||c.entries.some(e=>!video(e.videoId)||e.channelId!==id||!text(e.title,500)||!text(e.channel,200)||!number(e.publishedAt)))fail();count+=c.entries.length;
          if(c.entries.some(e=>e.details!==undefined&&!Ledger.validVideoDetails(e.details)))fail();
          if(c.entries.some(e=>e.views!==undefined&&!Ledger.validVideoViews(e.views)))fail();
          if(c.entries.some(e=>e.publishedAtEstimated!==undefined&&typeof e.publishedAtEstimated!=='boolean'||e.views?.approximate!==undefined&&typeof e.views.approximate!=='boolean'))fail();
          if(c.feedSource!==undefined&&!['rss','uploads-page'].includes(c.feedSource)||c.rssRetryAt!==undefined&&!number(c.rssRetryAt))fail();
          if(c.fetchedAt!==undefined&&!number(c.fetchedAt)||c.attemptedAt!==undefined&&!number(c.attemptedAt)||c.viewsAttemptedAt!==undefined&&!number(c.viewsAttemptedAt)||c.error!==undefined&&!text(c.error,2000))fail();
          if(c.retryAt!==undefined&&!number(c.retryAt)||c.retryAfter!==undefined&&!number(c.retryAfter)||c.failures!==undefined&&(!Number.isInteger(c.failures)||c.failures<1||c.failures>8))fail();
        }if(count>5000)fail();
      }else if(key==='groupBrowsing:v1'){
        if(value?.version!==1||!object(value.groups)||Object.keys(value.groups).length>200)fail();
        for(const [id,g] of Object.entries(value.groups)){
          if(!text(id,100)||!id||!object(g)||!Array.isArray(g.hidden)||g.hidden.length>5000||g.hidden.some(v=>!video(v))||g.lastVisitedAt!==undefined&&!number(g.lastVisitedAt)||g.channelsExpanded!==undefined&&typeof g.channelsExpanded!=='boolean')fail();
          if(g.hiddenChannels!==undefined&&(!Array.isArray(g.hiddenChannels)||g.hiddenChannels.length>2000||g.hiddenChannels.some(v=>!channel(v))))fail();
          if(g.uploadedFilter!==undefined&&!['all','visit','day','week','month'].includes(g.uploadedFilter))fail();
          if(g.lengthFilter!==undefined&&!['all','short','medium','long'].includes(g.lengthFilter))fail();
        }
      }else if(key==='videoProgress:v1'){
        if(value?.version!==1||!object(value.videos))fail();
        for(const [id,v] of Object.entries(value.videos))if(!video(id)||typeof v.observed!=='boolean'||!Array.isArray(v.segments)||v.segments.length>500||v.segments.some(s=>!Array.isArray(s)||s.length!==2||!number(s[0])||!number(s[1])||s[1]<=s[0])||v.manual&&!['watched','unwatched'].includes(v.manual)||v.duration!==undefined&&(!number(v.duration)||v.duration>604800)||v.position!==undefined&&(!number(v.position)||!number(v.duration)||v.position>v.duration)||v.lastWatchedAt!==undefined&&!number(v.lastWatchedAt))fail();
      }
    }
    return data;
  }
  function summary(data){return {days:Object.keys(data).filter(k=>k.startsWith('day:')).length,sessions:Object.entries(data).filter(([k])=>k.startsWith('day:')).reduce((n,[,rows])=>n+rows.length,0),groups:data['channelGroups:v1']?.groups.length||0,channels:Object.keys(data['channelGroups:v1']?.channels||{}).length};}
  function wrap(data){return {format,schemaVersion:1,exportedAt:new Date().toISOString(),extensionVersion:browser.runtime.getManifest().version,data:Object.fromEntries(Object.entries(data).filter(([k])=>known(k)))};}
  async function handle(message,sender){
    if((sender.url||'').split(/[?#]/)[0]!==browser.runtime.getURL('dashboard.html'))throw new Error('Open Ledger Settings to manage backups.');
    if(message.type==='backup:preview'){const data=validate(message.backup);return summary(data);}
    return LedgerStorage.write(async()=>{
      const previous=Object.fromEntries(Object.entries(await browser.storage.local.get(null)).filter(([k])=>known(k)));
      if(message.type==='backup:export')return wrap(previous);
      if(message.type!=='backup:restore')throw new Error('Unknown backup request.');
      const restored=validate(message.backup),obsolete=Object.keys(previous).filter(k=>!Object.hasOwn(restored,k));
      try{await browser.storage.local.remove(obsolete);await browser.storage.local.set(restored);}
      catch(error){
        await browser.storage.local.remove(Object.keys(restored).filter(k=>!Object.hasOwn(previous,k)));
        await browser.storage.local.set(previous);
        throw new Error('The backup could not be saved, possibly because browser storage is full. Your previous Ledger data was restored.');
      }
      // A feed refresh already in flight must not write old account-independent metadata into the restored cache.
      globalThis.GroupFeeds?.invalidate?.();
      await browser.storage.session.set({'ledgerUndo:v1':{}});
      return {ok:true,...summary(restored)};
    });
  }
  return {validate,summary,wrap,handle,maxBytes};
})();
