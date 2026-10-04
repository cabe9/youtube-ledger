// Firefox exposes browser.*; Chrome's MV3 APIs use chrome.*.
// Keep asynchronous message channels open on Chrome versions that require callbacks.
if (typeof globalThis.browser === 'undefined') {
  const api = globalThis.chrome;
  globalThis.browser = {
    storage: api.storage,
    alarms: api.alarms,
    permissions: api.permissions,
    tabs: api.tabs,
    action: api.action,
    runtime: {
      get lastError(){return api.runtime.lastError;},
      getManifest: api.runtime.getManifest.bind(api.runtime),
      connectNative: (...args) => api.runtime.connectNative(...args),
      getURL: api.runtime.getURL.bind(api.runtime),
      reload: api.runtime.reload?.bind(api.runtime),
      sendMessage: async message => {
        const response = await api.runtime.sendMessage(message);
        if (response?.ledgerError) throw new Error(response.ledgerError);
        return response;
      },
      onMessage: {
        addListener(listener) {
          api.runtime.onMessage.addListener((message, sender, respond) => {
            Promise.resolve().then(() => listener(message, sender)).then(
              value => respond(value ?? null),
              error => respond({ledgerError:String(error?.message || error)})
            );
            return true;
          });
        }
      }
    }
  };
}
