/* Chrome-only storage boundary. The normal Ledger modules use this facade. */
importScripts('compat.js', 'chrome-vault/crypto.js', 'chrome-vault/store.js', 'chrome-vault/idb.js', 'core.js');
(() => {
  const api = chrome, nativeLocal = api.storage.local, listeners = new Set(), handlers = [];
  const readKeys = new Set(['paused','recordingEpoch','settings','setup:v1','connections:v1','connectionsChanged:v1',
    'channelGroups:v1','channelUploads:v1','groupBrowsing:v1','videoProgress:v1','watchEvidence:v1','recordingStatus:v1']);
  const contentValue = (key, value) => {
    if (key !== 'settings' || !value) return value;
    const safe = {...value}; delete safe.reviewPreference; return safe;
  };
  const dashboard = sender => !sender.tab?.incognito && !sender.incognito &&
    (sender.url || '').split(/[?#]/)[0] === api.runtime.getURL('dashboard.html');
  const youtube = sender => !sender.tab?.incognito && !sender.incognito && sender.tab && /^https:\/\/(www|m)\.youtube\.com\//.test(sender.url || '');
  const vault = LedgerChromeStore(LedgerVaultIDB(), api.storage.session, nativeLocal);
  globalThis.LedgerChromeVaultStore = vault;
  let rememberError = '';
  async function nativeKey(message) {
    if (!(await api.permissions.contains({permissions:['nativeMessaging']}))) throw Error('Allow the local companion permission to remember this computer.');
    return new Promise((resolve,reject) => {
      const port = api.runtime.connectNative('org.youtube_ledger.local_sync');
      let done = false;
      const finish = (value,error) => {if (done) return; done = true; clearTimeout(timer); port.disconnect(); error ? reject(error) : resolve(value);};
      const timer = setTimeout(() => finish(null,Error('The local companion did not respond. Unlock with your passphrase instead.')),10000);
      port.onMessage.addListener(result => {
        if (result?.error) finish(null,Error(result.error === 'Invalid profile identifier' ? 'Update the Ledger companion to use Remember on this computer.' : result.error));
        else finish(result);
      });
      port.onDisconnect.addListener(() => {void api.runtime.lastError; finish(null,Error('Install or update the Ledger companion to remember this computer. You can still unlock with your passphrase.'));});
      port.postMessage(message);
    });
  }
  async function autoUnlock() {
    const info = await vault.device();
    if (!info?.device || (await vault.status()).unlocked) return;
    try {
      const result = await nativeKey({op:'keychain:get',...info});
      if (!result?.key) throw Error('The remembered key is missing. Unlock with your passphrase, then choose Remember on this computer again.');
      try {await vault.resumeDevice(result.key);} finally {result.key = '';}
    } catch (error) {rememberError = error.message;}
  }
  const started = Promise.all([nativeLocal.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    api.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}), vault.init()]).then(autoUnlock);
  let remembering = Promise.resolve();
  function rememberDevice(enabled) {
    const next = remembering.then(() => changeRememberDevice(enabled));
    remembering = next.catch(()=>{}); return next;
  }
  async function changeRememberDevice(enabled) {
    if (!(await vault.status()).unlocked) throw Error('Unlock Ledger first.');
    const info = await vault.device();
    if (!enabled) {
      // Stop automatic use first, even when the companion is unavailable.
      await vault.setDevice(null); rememberError = '';
      if (info.device) {
        try {await nativeKey({op:'keychain:delete',...info});}
        catch {const windows=(await api.runtime.getPlatformInfo()).os==='win';return {remembered:false,warning:'Automatic unlock is off. The companion could not remove its saved key. '+(windows?'Run the companion cleanup tool to remove remembered unlocks.':'You can remove the org.youtube_ledger.chrome_unlock entry in macOS Keychain Access.')};}
      }
      return {remembered:false};
    }
    if (!['mac','win'].includes((await api.runtime.getPlatformInfo()).os)) throw Error('Remembered unlock currently supports Windows and macOS.');
    const saved = (await api.storage.session.get('ledgerVaultSession:v1'))['ledgerVaultSession:v1'];
    if (saved?.id !== info.vault || !saved.key) throw Error('Unlock Ledger again before remembering this computer.');
    const next = {...info,device:crypto.randomUUID()};
    try {await nativeKey({op:'keychain:set',...next,key:saved.key});} finally {saved.key = '';}
    try {await vault.setDevice(next.device);}
    catch (error) {await nativeKey({op:'keychain:delete',...next}).catch(()=>{}); throw error;}
    if (info.device) await nativeKey({op:'keychain:delete',...info}).catch(()=>{});
    rememberError = ''; return {remembered:true};
  }
  let draining;
  async function updateBadge() {
    const state = await vault.status();
    await api.action.setTitle({title:state.configured && !state.unlocked ? 'Ledger is locked — open to unlock your saved profile' : 'Open YouTube Ledger'});
    if (state.configured && !state.unlocked) await api.action.setBadgeText({text:'L'});
    else if (state.unlocked) {
      const local = await vault.get('recordingStatus:v1'), memory = await api.storage.session.get('recordingStatus:v1');
      await api.action.setBadgeText({text:local['recordingStatus:v1'] || memory['recordingStatus:v1'] ? '!' : ''});
    }
  }
  async function notify(changes) {
    if (!Object.keys(changes).length) return;
    for (const listener of listeners) {try {listener(changes, 'local');} catch (error) {console.error(error);}}
    void api.runtime.sendMessage({type:'vault:changed', changes}).catch(() => {});
    const contentChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => readKeys.has(key))
      .map(([key, change]) => [key, Object.fromEntries(Object.entries(change).map(([field, value]) => [field, contentValue(key, value)]))]));
    if (!Object.keys(contentChanges).length) return;
    const tabs = await api.tabs.query({url:['https://www.youtube.com/*','https://m.youtube.com/*']});
    await Promise.allSettled(tabs.map(tab => api.tabs.sendMessage(tab.id, {type:'vault:changed', changes:contentChanges})));
  }
  const local = {get: keys => vault.get(keys),
    async set(values) {const changes = await vault.mutate(values); await notify(changes);},
    async replace(values, removed) {const changes = await vault.mutate(values, removed); await notify(changes);},
    async remove(keys) {const changes = await vault.mutate({}, typeof keys === 'string' ? [keys] : keys); await notify(changes);},
    async clear() {await rememberDevice(false); await vault.setBrowserUnlock(false); const changes = await vault.mutate({}, [], true); await notify(changes);},
    getBytesInUse: () => vault.bytes()};
  browser.storage = {...browser.storage, local, onChanged:{addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}};
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    const safe = {...changes}; delete safe['ledgerVaultSession:v1'];
    if (Object.keys(safe).length) for (const listener of listeners) listener(safe, area);
  });
  // One native listener decides who can access decrypted data. Keep all ordinary
  // Ledger handlers behind it, including when the service worker wakes locked.
  browser.runtime.onMessage = {addListener: listener => handlers.push(listener)};
  function clean(events) {
    if (!Array.isArray(events) || !events.length || events.length > 100) throw Error('Invalid recording batch.');
    return events.map(event => {
      if (!event || !Ledger.states.includes(event.state) || typeof event.id !== 'string' || !event.id || event.id.length > 200 ||
          !Number.isFinite(event.start) || !Number.isFinite(event.end) || event.start < 946684800000 || event.end > 4102444800000 ||
          event.end <= event.start || event.end - event.start > 5000 || !/^(?:[\w-]{11})?$/.test(event.videoId || '')) throw Error('Invalid playback sample.');
      const value = {id:event.id, videoId:event.videoId || '', title:String(event.title || '').slice(0,500),
        channel:String(event.channel || '').slice(0,200), start:event.start, end:event.end, state:event.state};
      value.url = value.videoId ? 'https://www.youtube.com/watch?v=' + value.videoId : 'https://www.youtube.com/';
      for (const name of ['position','positionEnd','duration']) if (Number.isFinite(event[name]) && event[name] >= 0 && event[name] <= 604800) value[name] = event[name];
      // Locked capture avoids page-session persistence; source attribution can
      // still be carried in the current document's memory.
      if (event.source && ['recommendations','search','subscriptions','watchLater','channel','unknown','group'].includes(event.source.kind))
        value.source = {kind:event.source.kind};
      const channelURL = Ledger.channelURL(event.channelUrl), avatar = Ledger.avatarURL(event.channelAvatarUrl);
      if (channelURL) value.channelUrl = channelURL;
      if (avatar) value.channelAvatarUrl = avatar;
      return value;
    });
  }
  async function drain() {
    if (draining) return draining;
    draining = (async () => {
      await LedgerData.ready();
      if (!(await vault.status()).pendingBatches) return;
      for (const item of await vault.entries()) {
        const result = await LedgerStorage.write(() => LedgerRecording.events(item.message, {url:'https://www.youtube.com/', tab:{id:-1}}));
        if (!result?.ok) throw Error(result?.recordingError || 'Some encrypted recordings still need to be organized.');
        // If interrupted after the history commit, receipts make replay safe.
        await vault.acknowledge(item.name);
      }
    })().finally(() => {draining = null;});
    return draining;
  }
  async function lockedGet(keys) {
    const controls = await vault.controls();
    const value = {...controls, settings:{hideRecommendations:false, showHeaderButton:false, learnYouTubeProgress:false,
      backgroundGroupChecks:false, watchLaterCleanup:false}, 'connections:v1':{network:false, account:false}};
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
    return Object.fromEntries(names.filter(key => Object.hasOwn(value,key)).map(key => [key,value[key]]));
  }
  async function handle(message, sender) {
    await started;
    const trusted = dashboard(sender), content = youtube(sender);
    if (!trusted && !content) throw Error('This page cannot access Ledger.');
    if (message?.type === 'vault:status') {
      if (!trusted) throw Error('Open Ledger to unlock saved data.');
      return {...await vault.status(),rememberError};
    }
    if (message?.type === 'vault:remember') {
      if (!trusted) throw Error('Open Ledger to manage remembered unlock.');
      if (typeof message.enabled !== 'boolean') throw Error('Choose whether to remember this computer.');
      return rememberDevice(message.enabled);
    }
    if (message?.type === 'vault:browserUnlock') {
      if (!trusted) throw Error('Open Ledger to manage automatic access.');
      if (typeof message.enabled !== 'boolean') throw Error('Choose whether to open automatically.');
      // Confirm a working recovery credential before dropping the browser key.
      // This also prevents a second, stale dashboard silently locking someone out.
      if (!message.enabled) await vault.confirmSecret(message.secret, message.recovery === true);
      return vault.setBrowserUnlock(message.enabled);
    }
    if (['vault:create','vault:unlock','vault:password','vault:recovery','vault:openBackup'].includes(message?.type)) {
      if (!trusted) throw Error('Open Ledger to manage encryption.');
      if (message.type === 'vault:openBackup') {
        if (!(await vault.status()).unlocked) throw Error('Unlock Ledger first.');
        return vault.openBackup(message.backup, message.secret, message.recovery === true);
      }
      if (message.type === 'vault:password') return vault.changePassword(message.secret, message.next, message.recovery === true);
      if (message.type === 'vault:recovery') return vault.replaceRecovery(message.secret, message.recovery === true);
      const result = message.type === 'vault:create' ? await vault.create(message.secret) : await vault.unlock(message.secret, message.recovery === true);
      await drain();
      const values = await vault.get([...readKeys]);
      await notify(Object.fromEntries(Object.entries(values).map(([key,newValue]) => [key,{newValue}])));
      await updateBadge();
      return result;
    }
    const state = await vault.status();
    if (message?.type === 'vault:storage') {
      if (!trusted) {
        const keys = typeof message.keys === 'string' ? [message.keys] : Array.isArray(message.keys) ? message.keys : Object.keys(message.keys || {});
        if (message.method === 'get' && (message.keys == null || keys.some(key => !readKeys.has(key)))) throw Error('This page cannot read private Ledger records.');
        if (message.method !== 'get' && !(state.unlocked && message.method === 'set' && Object.keys(message.values || {}).join(',') === 'settings')) throw Error('This page cannot write private Ledger records.');
      }
      if (!state.unlocked) {
        if (message.method !== 'get' || trusted) throw Error('Unlock Ledger first.');
        return lockedGet(message.keys);
      }
      if (content && message.method === 'set') {
        const {settings} = await local.get('settings'), next = message.values.settings;
        if (typeof next?.groupDebugMode !== 'boolean') throw Error('Invalid debug preference.');
        return local.set({settings:{...settings,groupDebugMode:next.groupDebugMode}});
      }
      if (message.method === 'get') {
        const values = await local.get(message.keys);
        return trusted ? values : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, contentValue(key, value)]));
      }
      if (message.method === 'set') return local.set(message.values);
      if (message.method === 'remove') return local.remove(message.keys);
      if (message.method === 'clear') return local.clear();
      if (message.method === 'getBytesInUse') return local.getBytesInUse();
      throw Error('Unknown storage operation.');
    }
    if (!state.unlocked) {
      if (message?.type === 'events' && content) return vault.append(message, clean);
      if (message?.type === 'recording:open' && content) {await api.tabs.create({url:api.runtime.getURL('dashboard.html')}); return {ok:true};}
      if (message?.type === 'recording:problem' && content) {await api.action.setBadgeText({text:'!'}); return {ok:true};}
      if (message?.type === 'connections:status') return {network:false,account:false};
      if (message?.type === 'sourceContext:get') return null;
      if (message?.type === 'recommendation' || message?.type === 'sourceContext:put') return null;
      const error = 'Unlock Ledger to use saved groups, watch status and sync. New viewing is still saved in encrypted form.';
      return {error,channelGroupError:error,groupFeedError:error};
    }
    await drain();
    for (const listener of handlers) {
      const response = await listener(message, sender);
      if (response !== undefined) return message?.type === 'backup:export' && !response?.error ? vault.sealBackup(response) : response;
    }
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'vault:changed') return false;
    handle(message, sender).then(value => respond(value ?? null), error => respond({ledgerError:String(error?.message || error)})); return true;
  });
  void started.then(async () => {await updateBadge(); if ((await vault.status()).unlocked) await drain();}).catch(console.error);
})();
importScripts('connections.js','ledger-storage.js','data-controls.js','ledger-undo.js','watch-status.js','watch-evidence.js',
  'group-icons.js','request-log.js','youtube-requests.js','channel-groups.js','group-sharing.js','uploads-page.js','group-feeds.js',
  'feed-library.js','group-queue.js','source-contexts.js','backup.js','recording.js','sync-model.js','local-sync.js','background.js');
