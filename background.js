let pending = Promise.resolve();
browser.action.onClicked.addListener(() => browser.tabs.create({url:browser.runtime.getURL('dashboard.html')}));
browser.runtime.onMessage.addListener((message, sender) => {
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
      await browser.storage.local.set({[key]:events});
    } else if (message.type === 'events') {
      if (!sender.tab || sender.tab.incognito || !/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url || '')) return;
      if ((await browser.storage.local.get('paused')).paused) return;
      const grouped = {};
      for (const event of (message.events || []).slice(0,100)) {
        if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end-event.start > 5000 || event.end <= event.start) continue;
        for (const e of Ledger.pieces(event)) (grouped['day:'+e.day] ||= []).push(e);
      }
      const stored = await browser.storage.local.get(Object.keys(grouped));
      for (const [key, events] of Object.entries(grouped)) {
        const rows = stored[key] || [];
        for (const e of events) Ledger.add(rows,e);
        stored[key] = rows;
      }
      await browser.storage.local.set(stored);
    } else if (!sender.tab || sender.url === browser.runtime.getURL('dashboard.html')) {
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
  const result = pending.then(task);
  pending = result.catch(console.error);
  return result;
});
