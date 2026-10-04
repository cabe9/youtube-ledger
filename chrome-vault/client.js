/* Decrypted storage is requested through the sender-checked background facade. */
(() => {
  const listeners = new Set(), session = browser.storage.session;
  const send = message => browser.runtime.sendMessage(message);
  browser.storage = {...browser.storage, session, local:{
    get: keys => send({type:'vault:storage',method:'get',keys}),
    set: values => send({type:'vault:storage',method:'set',values}),
    remove: keys => send({type:'vault:storage',method:'remove',keys}),
    clear: () => send({type:'vault:storage',method:'clear'}),
    getBytesInUse: () => send({type:'vault:storage',method:'getBytesInUse'})
  }, onChanged:{addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}};
  // Use Chrome's raw listener: a notification must never answer another request.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'vault:changed') for (const listener of listeners) listener(message.changes, 'local');
    return false;
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'session') return;
    const safe = {...changes}; delete safe['ledgerVaultSession:v1'];
    if (Object.keys(safe).length) for (const listener of listeners) listener(safe,area);
  });
})();
