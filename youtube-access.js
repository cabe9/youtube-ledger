// Dashboard-only checks. No page titles, URLs or history are retained.
globalThis.LedgerYouTubeAccess = (() => {
  const origins = ['https://www.youtube.com/*', 'https://m.youtube.com/*'];
  async function inspect(api = browser, timeoutMs = 1500) {
    try {
      if (!await api.permissions.contains({origins})) return {kind:'missing'};
      const tabs = (await api.tabs.query({url:origins})).filter(tab=>!tab.discarded && !tab.incognito);
      const replies = await Promise.all(tabs.map(async tab => {
        let timer;
        try {
          const reply = await Promise.race([
            api.tabs.sendMessage(tab.id,{type:'ledger:page-status'},{frameId:0}),
            new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})
          ]);
          return reply?.connected === true;
        } catch { return false; }
        finally { clearTimeout(timer); }
      }));
      return {kind:'granted', tabs:tabs.length, connected:replies.filter(Boolean).length};
    } catch { return {kind:'unknown'}; }
  }
  function describe(access, {setupNeeded=false, paused=false} = {}) {
    const base = setupNeeded ? 'Setup needed' : paused ? 'Tracking paused' : 'Ready for YouTube';
    if (access.kind==='missing') return {label:'YouTube access needed', allow:true,
      message:'Allow Ledger to run on YouTube for automatic tracking and page controls. If your browser says “On click”, choose “Always run” for YouTube. Then refresh any YouTube tabs already open. Your saved history and notes remain available.'};
    if (access.kind==='unknown') return {label:'YouTube access unverified',
      message:'Ledger could not check YouTube access. Check its site permissions in your browser, then try again.'};
    if (access.connected < access.tabs) return {label:setupNeeded||paused ? base : 'YouTube tabs need attention',
      message:`Ledger connected to ${access.connected} of ${access.tabs} open YouTube tabs. Refresh tabs missing Ledger’s controls, then check again. If a tab still does not connect, check that Ledger is allowed to always run on YouTube.`};
    if (!access.tabs) return {label:base,
      message:'YouTube access is allowed. Open a YouTube tab to check that Ledger connects. Refresh any existing tab missing Ledger’s controls.'};
    return {label:setupNeeded||paused ? base : `Tracking ${access.connected} ${access.connected===1?'tab':'tabs'}`,
      message:`Ledger connected to ${access.connected} YouTube ${access.connected===1?'tab':'tabs'}.${setupNeeded?' Save your setup choices to enable tracking.':paused?' Tracking is paused.':''}`};
  }
  // Invoke directly from the click handler to preserve the browser user gesture.
  function request(api = browser) { return api.permissions.request({origins}); }
  return {inspect, describe, request};
})();
