/* Optional external connections. Consent is local to this installation, never a backup setting. */
globalThis.LedgerConnections = (() => {
  const key = 'connections:v1', revisionKey = 'connectionsChanged:v1';
  const types = {network: ['browsingActivity', 'websiteContent'], account: ['websiteActivity']};
  const syncTypes = ['browsingActivity', 'websiteContent', 'websiteActivity', 'technicalAndInteraction'];
  const listeners = new Set(), images = new Set(), active = new Set();
  let revision = 0, background = false;
  const isFirefox = () => !!browser.runtime.getManifest().browser_specific_settings?.gecko;
  function syncPermissions() {
    return {permissions: ['nativeMessaging'], ...(isFirefox() ? {data_collection: syncTypes} : {})};
  }
  async function syncAllowed() {
    try {
      if (!await browser.permissions.contains({permissions: ['nativeMessaging']})) return false;
      const grants = isFirefox() ? (await browser.permissions.getAll()).data_collection || [] : null;
      return !grants || syncTypes.every(type => grants.includes(type));
    } catch { return false; }
  }
  async function releaseDataPermissions(names) {
    if (!isFirefox()) return;
    const data = await browser.storage.local.get([key, 'localSync:v1']), saved = data[key] || {};
    const retained = new Set(Object.entries(types).filter(([kind]) => saved[kind]).flatMap(([, value]) => value));
    if (data['localSync:v1']?.enabled && data['localSync:v1'].consentVersion === 1) for (const name of syncTypes) retained.add(name);
    const unused = names.filter(name => !retained.has(name));
    if (unused.length) await browser.permissions.remove({data_collection: unused});
  }
  const error = () => Object.assign(new Error('YouTube connections are off. Enable them in Ledger Settings to load images and check channels. Cached records remain available.'), {name: 'LedgerConsentError'});
  async function status() {
    try {
      // Content scripts cannot access the permissions API. The background answers them.
      if (isFirefox() && !browser.permissions?.getAll) return await browser.runtime.sendMessage({type: 'connections:status'});
      const saved = (await browser.storage.local.get(key))[key] || {};
      const grants = isFirefox() ? (await browser.permissions.getAll()).data_collection || [] : null;
      return Object.fromEntries(Object.entries(types).map(([kind, names]) => [kind, saved[kind] === true && (!grants || names.every(name => grants.includes(name)))]));
    } catch { return {network: false, account: false}; }
  }
  async function allowed(kind = 'network') { return (await status())?.[kind] === true; }
  async function assert(kind = 'network') {
    if (!await allowed(kind)) throw kind === 'network' ? error() : new Error('Allow Watch Later account actions in Ledger Settings before removing videos.');
  }
  async function change(kind, enabled) {
    if (!types[kind] || globalThis.location?.href.split(/[?#]/)[0] !== browser.runtime.getURL('dashboard.html')) throw new Error('Open Ledger Settings to change connection permissions.');
    // Start the browser prompt synchronously in the user's click handler.
    const grant = enabled && isFirefox() ? browser.permissions.request({data_collection: types[kind]}) : Promise.resolve(true);
    if (!await grant) return false;
    const saved = (await browser.storage.local.get(key))[key] || {};
    await browser.storage.local.set({[key]: {...saved, [kind]: enabled}});
    if (!enabled) await releaseDataPermissions(types[kind]);
    await refresh();
    return enabled;
  }
  function combineSignals(...signals) {
    const controller = new AbortController();
    for (const signal of signals.filter(Boolean)) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), {once: true});
    }
    return controller.signal;
  }
  async function run(operation) {
    await assert();
    const controller = new AbortController(); active.add(controller);
    try { await assert(); return await operation(controller.signal); }
    finally { active.delete(controller); }
  }
  function image(node, url) {
    // Keep the DOM wrapper alive while the image is in use. A WeakRef alone can
    // disappear in Firefox even when the underlying DOM node remains attached.
    if (images.size % 64 === 0) for (const item of images) {
      if (!item.node.isConnected && Date.now() - item.created > 1000) images.delete(item);
    }
    const record = {node, url, created: Date.now()}; images.add(record);
    const current = revision;
    void allowed().then(yes => {
      if (current !== revision) return;
      if (yes) { node.hidden = false; node.src = url; }
      else { node.removeAttribute('src'); node.hidden = true; }
    });
    return node;
  }
  async function refresh() {
    const current = ++revision, value = await status();
    if (current !== revision) return;
    if (!value?.network) for (const controller of active) controller.abort(error());
    for (const record of images) {
      const node = record.node;
      if (!value?.network) { node.removeAttribute('src'); node.hidden = true; }
      else if (node.isConnected) { if (node.getAttribute('src') !== record.url) node.src = record.url; node.hidden = false; }
      if (!node.isConnected && Date.now() - record.created > 1000) images.delete(record);
    }
    for (const listener of listeners) listener(value);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[key] || changes[revisionKey])) void refresh();
  });
  function startBackground() {
    if (background) return; background = true;
    const changed = async () => {
      await refresh();
      // Notify content scripts, which do not receive permissions events.
      await browser.storage.local.set({[revisionKey]: crypto.randomUUID()});
    };
    browser.permissions?.onAdded?.addListener(changed);
    browser.permissions?.onRemoved?.addListener(async () => {
      // Firefox categories are shared by several features. Remember a revocation
      // as an opt-out so granting sync later cannot silently re-enable YouTube.
      if (isFirefox()) {
        const grants = (await browser.permissions.getAll()).data_collection || [];
        const saved = (await browser.storage.local.get(key))[key] || {};
        let dirty = false;
        for (const [kind, names] of Object.entries(types)) if (saved[kind] && !names.every(name => grants.includes(name))) { saved[kind] = false; dirty = true; }
        if (dirty) await browser.storage.local.set({[key]: saved});
      }
      await changed();
    });
  }
  return {key, types, syncTypes, syncPermissions, syncAllowed, releaseDataPermissions, status, allowed, assert, change, run, combineSignals, image, refresh, startBackground,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }};
})();
