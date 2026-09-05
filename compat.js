// Firefox exposes browser.*; Chrome's MV3 APIs use chrome.*.
// Keep asynchronous message channels open on Chrome versions that require callbacks.
if (typeof globalThis.browser === 'undefined') {
  const api = globalThis.chrome;
  globalThis.browser = {
    storage: api.storage,
    tabs: api.tabs,
    action: api.action,
    runtime: {
      getURL: api.runtime.getURL.bind(api.runtime),
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
