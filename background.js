let pending = Promise.resolve();
browser.action.onClicked.addListener(() => browser.tabs.create({url:browser.runtime.getURL('dashboard.html')}));
browser.runtime.onMessage.addListener((message, sender) => {
  // Channel lookups must not block playback writes while waiting on YouTube.
  if (typeof message?.type === 'string' && message.type.startsWith('channelGroups:')) return ChannelGroups.handle(message,sender).catch(error=>({channelGroupError:String(error.message || error)}));
  if (typeof message?.type === 'string' && message.type.startsWith('groupFeed:')) return GroupFeeds.handle(message,sender).catch(error=>({groupFeedError:String(error.message || error)}));
  if(message?.type==='ledger:undo')return LedgerUndo.handle(message,sender);
  if(message?.type?.startsWith('feedLibrary:'))return FeedLibrary.handle(message,sender);
  if(message?.type?.startsWith('groupQueue:'))return GroupQueue.handle(message,sender);
  if(message?.type==='watchStatus:set')return WatchStatus.handle(message,sender).catch(error=>({groupFeedError:String(error.message)}));
  if(message?.type?.startsWith('backup:'))return LedgerBackup.handle(message,sender).catch(error=>({error:String(error.message)}));
  if(message?.type?.startsWith('sourceContext:'))return SourceContexts.handle(message,sender).catch(()=>null);
  if(message?.type?.startsWith('recording:'))return LedgerRecording.handle(message,sender);
  const task = async () => {
    if (message.type === 'recommendation') {
      if (!sender.tab || sender.tab.incognito || !/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url || '')) return;
      if ((await browser.storage.local.get('paused')).paused) return;
      const e=message.event;
      if (!e || !['reveal','visible','hide'].includes(e.kind) || !Number.isFinite(e.at) || typeof e.id !== 'string') return;
      const key='recommendations:'+Ledger.dayKey(e.at);
      const data=await browser.storage.local.get(key);
      const events=data[key] || [];
      if (!events.some(x=>x.id===e.id)) events.push({id:e.id,revealId:e.revealId,kind:e.kind,at:e.at,page:String(e.page).slice(0,300)});
      try{await LedgerStorage.saveHistory({[key]:events});}catch(error){await LedgerRecording.problem(error);}
    } else if (message.type === 'events') {
      return LedgerRecording.events(message,sender);
    } else if (!sender.tab || (sender.url || '').split('#')[0] === browser.runtime.getURL('dashboard.html')) {
      if (message.type === 'groupLabel' && Ledger.labels.includes(message.label) && typeof message.key === 'string') {
        const key='purposes:'+message.day;
        const data=await browser.storage.local.get(key);
        await browser.storage.local.set({[key]:{...(data[key] || {}),[message.key]:message.label}});
      } else if (message.type === 'label' && Ledger.labels.includes(message.label)) {
        const key = 'day:'+message.day;
        const data = await browser.storage.local.get(key);
        const row = (data[key] || []).find(r=>r.id === message.id);
        if (row) { row.label = message.label; await browser.storage.local.set(data); }
      } else if (message.type === 'clear') {
        await browser.storage.local.remove(['day:'+message.day,'recommendations:'+message.day,'purposes:'+message.day]);
      }
    }
  };
  const result = globalThis.LedgerStorage?LedgerStorage.write(task):pending.then(task);
  pending = result.catch(console.error);
  return result;
});
