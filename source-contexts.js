/* Short-lived evidence carried by an observed link into a new tab. */
globalThis.SourceContexts=(()=>{
  const key='sourceContexts:v1';let writes=Promise.resolve();
  function handle(message,sender){
    if(!sender.tab||sender.tab.incognito||!/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||'')||!/^[-\w]{36}$/.test(message.token||'')||!/^[-\w]{11}$/.test(message.videoId||''))return Promise.resolve(null);
    const task=writes.then(async()=>{
      const data=(await browser.storage.session.get(key))[key]||{},now=Date.now();
      if(message.type==='sourceContext:get'){
        const item=data[message.token];if(!item||item.videoId!==message.videoId||now-item.at>=7200000)return null;
        const source={...item.source,journey:item.claimed?null:item.source.journey};item.claimed=true;
        await browser.storage.session.set({[key]:data});return source;
      }
      if(message.type!=='sourceContext:put'||!['recommendations','search','subscriptions','watchLater','channel','unknown'].includes(message.source?.kind))return null;
      const entries=Object.entries(data).filter(([,v])=>now-v.at<7200000).sort((a,b)=>b[1].at-a[1].at).slice(0,511);
      const source={kind:message.source.kind,journey:Ledger.journey(message.source.journey),evidence:message.source.evidence==='observed-context-link'?'observed-context-link':'observed-link'};
      await browser.storage.session.set({[key]:{...Object.fromEntries(entries),[message.token]:{at:now,videoId:message.videoId,source}}});return {ok:true};
    });writes=task.catch(()=>{});return task;
  }
  return {handle};
})();
