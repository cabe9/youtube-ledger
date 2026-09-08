/* Browsing preferences never modify playback history or watch status. */
globalThis.FeedLibrary=(()=>{
  const key='groupBrowsing:v1';
  const uploadedFilters=['all','visit','day','week','month'],lengthFilters=['all','short','medium','long'];
  function metric(entry,progress,kind){
    if(kind==='date')return entry.publishedAt;
    if(kind==='length'){
      if(['live','upcoming'].includes(entry.details?.status))return undefined;
      const duration=entry.details?.duration||progress?.videos?.[entry.videoId]?.duration;return Number.isFinite(duration)&&duration>0?duration:undefined;
    }
    if(!Ledger.validVideoViews(entry.views))return undefined;
    if(kind==='views')return entry.views.count;
    // Use the age at the count's measurement, not today's age with a stale count.
    const hours=(entry.views.checkedAt-entry.publishedAt)/3600000;
    return kind==='rate'&&hours>0?entry.views.count/hours:undefined;
  }
  function visible(entries,progress,preferences={},options={}){
    const hidden=new Set(preferences.hidden||[]),hiddenChannels=new Set(preferences.hiddenChannels||[]),query=(options.query||'').trim().toLocaleLowerCase();
    const now=options.now??Date.now(),days={day:1,week:7,month:30},uploaded=preferences.uploadedFilter;
    const since=uploaded==='visit'?options.visitBoundary:days[uploaded]?now-days[uploaded]*86400000:null;
    return entries.filter(e=>{
      if(options.hideShorts===true&&e.details?.shorts===true)return false;
      if(since!=null&&(e.publishedAt<=since||e.publishedAt>now))return false;
      const duration=e.details?.duration||progress?.videos?.[e.videoId]?.duration;
      // Unknown lengths remain visible so their on-screen metadata can be checked.
      if(Number.isFinite(duration)&&duration>0){
        if(preferences.lengthFilter==='short'&&duration>=600)return false;
        if(preferences.lengthFilter==='medium'&&(duration<600||duration>1800))return false;
        if(preferences.lengthFilter==='long'&&duration<=1800)return false;
      }
      const excluded=hidden.has(e.videoId)||hiddenChannels.has(e.channelId);
      if(options.filter==='hidden')return excluded&&matches(e);
      if(excluded)return false;
      const state=WatchStatus.state(progress?.videos?.[e.videoId]);
      return (!options.filter||options.filter==='all'||(options.filter==='unwatched'?state!=='watched':state===options.filter))&&matches(e);
    }).sort((a,b)=>{
      const order=Ledger.groupSort(options.sort),left=metric(a,progress,order.metric),right=metric(b,progress,order.metric);
      // Unknown values sort last in both directions; zero views is a known value.
      if(left===undefined&&right!==undefined)return 1;if(right===undefined&&left!==undefined)return -1;
      return (left!==undefined&&right!==undefined?(order.descending?-1:1)*(left-right):0)||b.publishedAt-a.publishedAt||a.videoId.localeCompare(b.videoId);
    });
    function matches(e){return !query||(e.title+' '+e.channel).toLocaleLowerCase().includes(query);}
  }
  function newCount(entries,preferences,now=Date.now()){
    const since=preferences?.lastVisitedAt;if(!since)return 0;const hidden=new Set(preferences.hidden||[]),channels=new Set(preferences.hiddenChannels||[]);
    return entries.filter(e=>e.publishedAt>since&&e.publishedAt<=now&&!hidden.has(e.videoId)&&!channels.has(e.channelId)).length;
  }
  function shuffle(entries,random=Math.random){const result=[...entries];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
  async function handle(message,sender){
    if(!sender.tab||sender.tab.incognito||!/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||''))throw new Error('Open a group on YouTube.');
    return LedgerStorage.write(async()=>{
      const data=await browser.storage.local.get([key,ChannelGroups.key,GroupFeeds.key]),group=data[ChannelGroups.key]?.groups.find(g=>g.id===message.groupId);
      if(!group)throw new Error('This group no longer exists.');
      const state=data[key]||{version:1,groups:{}},prefs=state.groups[group.id]||={hidden:[]};
      if(message.type==='feedLibrary:visit'){
        const previous=prefs.lastVisitedAt||null;if(prefs.uploadedFilter===undefined)prefs.uploadedFilter='week';prefs.lastVisitedAt=Date.now();await browser.storage.local.set({[key]:state});return {previous,at:prefs.lastVisitedAt};
      }
      if(message.type==='feedLibrary:channels'){
        if(typeof message.expanded!=='boolean')throw new Error('Choose whether to show the channels.');
        prefs.channelsExpanded=message.expanded;await browser.storage.local.set({[key]:state});return {ok:true};
      }
      if(message.type==='feedLibrary:filters'){
        if(!message.filters||typeof message.filters!=='object'||Array.isArray(message.filters)||!Object.keys(message.filters).length||Object.keys(message.filters).some(k=>!['uploadedFilter','lengthFilter'].includes(k)))throw new Error('Choose a feed filter.');
        for(const [field,choices] of [['uploadedFilter',uploadedFilters],['lengthFilter',lengthFilters]])if(field in message.filters&&!choices.includes(message.filters[field]))throw new Error('Choose a supported feed filter.');
        Object.assign(prefs,message.filters);await browser.storage.local.set({[key]:state});return {ok:true};
      }
      if(message.type==='feedLibrary:resetFilters'){
        prefs.uploadedFilter='all';prefs.lengthFilter='all';group.watchFilter='all';group.hideShorts=false;
        await browser.storage.local.set({[key]:state,[ChannelGroups.key]:data[ChannelGroups.key]});return {ok:true};
      }
      if(message.type==='feedLibrary:hideChannel'){
        if(!/^UC[-\w]{22}$/.test(message.channelId||'')||typeof message.hidden!=='boolean')throw new Error('Choose a channel to hide or restore.');
        if(message.hidden&&!group.channelIds.includes(message.channelId))throw new Error('This channel is no longer in the group.');
        const before=prefs.hiddenChannels,ids=new Set(before||[]);message.hidden?ids.add(message.channelId):ids.delete(message.channelId);
        if(ids.size>2000)throw new Error('Restore some hidden channels first.');
        prefs.hiddenChannels=[...ids];
        const undoToken=await LedgerUndo.record([{key,path:['groups',group.id,'hiddenChannels'],before,after:prefs.hiddenChannels}]);
        await browser.storage.local.set({[key]:state});return {ok:true,undoToken};
      }
      if(message.type!=='feedLibrary:hide'||!/^[-\w]{11}$/.test(message.videoId||'')||typeof message.hidden!=='boolean')throw new Error('Choose a video to hide or restore.');
      if(message.hidden&&!group.channelIds.some(id=>data[GroupFeeds.key]?.channels[id]?.entries.some(e=>e.videoId===message.videoId)))throw new Error('This video is no longer in the group feed.');
      const before=[...(prefs.hidden||[])],ids=new Set(before);message.hidden?ids.add(message.videoId):ids.delete(message.videoId);
      if(ids.size>5000)throw new Error('This group has reached its hidden-video limit. Restore some hidden videos first.');
      prefs.hidden=[...ids];
      const undoToken=await LedgerUndo.record([{key,path:['groups',group.id,'hidden'],before,after:prefs.hidden}]);await browser.storage.local.set({[key]:state});return {ok:true,undoToken};
    });
  }
  return {key,metric,visible,newCount,shuffle,handle};
})();
