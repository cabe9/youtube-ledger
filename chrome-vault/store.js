/* Transactional encrypted records. Optional automatic access also persists a
   non-extractable CryptoKey in this browser profile; it is not an OS key store. */
globalThis.LedgerChromeStore = (io, session, legacy, {inboxLimit = 64 * 1024 * 1024} = {}) => {
  const crypt = LedgerChromeCrypto, sessionName = 'ledgerVaultSession:v1';
  const own = (value, key) => Object.hasOwn(value, key);
  const copy = value => structuredClone(value);
  const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const identity = () => crypto.randomUUID() + ':1';
  let meta, privateKey, index = {}, initialized, pending = Promise.resolve(), wake, browserUnlockError = '', sessionUnlockError = '';
  const unlocked = new Promise(resolve => {wake = resolve;});
  const serial = task => {const next = pending.then(task); pending = next.catch(() => {}); return next;};
  const state = () => ({configured: !!meta, unlocked: !!privateKey, migrationPending: !!meta?.migrationPending,
    remembered: !!meta?.device, browserUnlock: meta?.browserUnlock === true, browserUnlockError, sessionUnlockError,
    paused: meta?.control?.paused !== false, pendingBatches: meta?.inboxCount || 0, pendingBytes: meta?.inboxBytes || 0, inboxLimit});
  async function checkIndex(key, config = meta.config) {
    const sealed = await io.get('index');
    if (!sealed) throw Error('Encrypted index is missing. Restore an intact backup.');
    const value = await crypt.open(config, key, sealed);
    if (!value || value.kind !== 'index' || !value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys) ||
        Object.values(value.keys).some(id => !/^[\w-]{36}:1$/.test(id))) throw Error('Invalid encrypted index.');
    if (new Set(Object.values(value.keys)).size !== Object.values(value.keys).length) throw Error('Duplicate encrypted record identity.');
    return value.keys;
  }
  async function readRecord(key, slot, secret = privateKey) {
    const sealed = await io.get('data:' + slot);
    if (!sealed || sealed.recordId !== slot) throw Error('An encrypted record is missing. Restore an intact backup.');
    const record = await crypt.open(meta.config, secret, sealed);
    if (record?.key !== key || !own(record, 'value')) throw Error('Encrypted record identity mismatch.');
    return record.value;
  }
  async function finishMigration(key, keys) {
    if (!meta.migrationPending) return;
    // Re-read/decrypt every committed copy before touching legacy storage. A
    // crash here leaves both copies; the next unlock safely resumes cleanup.
    for (const [name, slot] of Object.entries(keys)) await readRecord(name, slot, key);
    await legacy.clear();
    const next = {...meta, migrationPending: false};
    await io.commit({meta: next}); meta = next;
  }
  async function remember(key, sessionKey, keys) {
    // Chrome documents storage.session as memory-only, cleared at restart or
    // extension reload. Serialized sessionKey never goes in browser disk storage.
    // Automatic browser access instead retains a non-extractable CryptoKey.
    await session.set({[sessionName]: {id: meta.config.id, key: sessionKey}});
    privateKey = key; index = keys; wake();
  }
  async function init() {
    return initialized ||= (async () => {
      meta = await io.get('meta');
      if (meta) {
        if (meta.version !== 1) throw Error('Unsupported vault version.');
        await crypt.publicKey(meta.config);
        const cached = (await session.get(sessionName))[sessionName];
        if (cached?.id === meta.config.id) {
          try {
            const key = await crypt.resume(meta.config, cached.key), keys = await checkIndex(key);
            await finishMigration(key, keys); privateKey = key; index = keys; wake();
          } catch {
            // A stale or damaged memory-only key must not poison init forever.
            // Keep the encrypted records and allow independent credentials to
            // authenticate them again. Corrupt records still fail on that read.
            await session.remove(sessionName);
            sessionUnlockError = 'This session could not reopen Ledger. Unlock with your passphrase or recovery key.';
          }
        }
        if (!privateKey && meta.browserUnlock === true) {
          try {
            const saved = await io.get('browser-unlock');
            if (saved?.id !== meta.config.id || saved.key?.type !== 'private' || saved.key.extractable !== false ||
                saved.key.algorithm?.name !== 'RSA-OAEP' || saved.key.usages?.join(',') !== 'unwrapKey') throw Error('Missing browser key.');
            // Authenticate the key against the recording key as well as index.
            await crypt.open(meta.config, saved.key, await crypt.seal(meta.config, identity(), []));
            const keys = await checkIndex(saved.key);
            await finishMigration(saved.key, keys); privateKey = saved.key; index = keys; wake();
          } catch {
            browserUnlockError = 'Automatic access is unavailable. Unlock with your passphrase or recovery key, then enable it again in Settings.';
          }
        }
      }
      if (privateKey) sessionUnlockError = '';
      return state();
    })();
  }
  async function ready() {await init(); await unlocked;}
  function control(values) {
    return {paused: values.paused !== false, epoch: String(values.recordingEpoch || ''),
      configured: values['setup:v1']?.complete === true};
  }
  async function create(passphrase) {
    await init();
    return serial(async () => {
      if (meta) throw Error('A vault already exists. Unlock it instead.');
      const created = await crypt.create(passphrase), secret = await crypt.unlock(created.config, passphrase, false, true);
      const values = await legacy.get(null), slots = Object.create(null), writes = {};
      if (!/^[\w-]{36}$/.test(values.recordingEpoch || '')) values.recordingEpoch = crypto.randomUUID();
      for (const [key, value] of Object.entries(values)) {
        slots[key] = identity(); writes['data:' + slots[key]] = await crypt.seal(created.config, slots[key], {key, value});
      }
      writes.index = await crypt.seal(created.config, identity(), {kind: 'index', keys: slots});
      writes.meta = {version: 1, config: created.config, control: control(values), migrationPending: true, inboxCount: 0, inboxBytes: 0};
      // IDB commits config, index and records together, including quota failure.
      await io.commit(writes); meta = writes.meta;
      const checked = await checkIndex(secret.privateKey);
      await finishMigration(secret.privateKey, checked);
      await remember(secret.privateKey, secret.sessionKey, checked); secret.sessionKey = '';
      return {...state(), recoveryKey: created.recoveryKey};
    });
  }
  async function unlock(secret, recovery = false) {
    await init();
    return serial(async () => {
      if (!meta) throw Error('Create an encrypted Ledger first.');
      const key = await crypt.unlock(meta.config, secret, recovery, true), keys = await checkIndex(key.privateKey);
      await finishMigration(key.privateKey, keys);
      await remember(key.privateKey, key.sessionKey, keys); key.sessionKey = ''; sessionUnlockError = '';
      return state();
    });
  }
  async function resumeDevice(sessionKey) {
    await init();
    return serial(async () => {
      if (!meta?.device) throw Error('Remembered unlock is not enabled.');
      const key = await crypt.resume(meta.config, sessionKey), keys = await checkIndex(key);
      await finishMigration(key, keys);
      await remember(key, sessionKey, keys);
      return state();
    });
  }
  async function setDevice(device) {
    await ready(); return serial(async () => {
      if (device !== null && !/^[0-9a-f-]{36}$/.test(device)) throw Error('Invalid remembered-unlock identifier.');
      const next = {...meta};
      if (device) next.device = device; else delete next.device;
      await io.commit({meta:next}); meta = next;
    });
  }
  async function setBrowserUnlock(enabled) {
    await init(); return serial(async () => {
      if (!privateKey) throw Error('Unlock Ledger first.');
      if (typeof enabled !== 'boolean') throw Error('Choose whether to open automatically.');
      const next = {...meta, browserUnlock:enabled};
      // Commit the preference and key together. Disabling never changes records
      // or backup credentials, and survives a worker or full browser restart.
      await io.commit(enabled ? {meta:next, 'browser-unlock':{id:meta.config.id,key:privateKey}} : {meta:next}, enabled ? [] : ['browser-unlock']);
      meta = next; browserUnlockError = ''; return state();
    });
  }
  async function confirmSecret(secret, recovery = false) {
    await init();
    if (!privateKey) throw Error('Unlock Ledger first.');
    await crypt.unlock(meta.config, secret, recovery);
  }
  async function get(selection) {
    await ready();
    return serial(async () => {
      const keys = selection == null ? Object.keys(index) : typeof selection === 'string' ? [selection] : Array.isArray(selection) ? selection : Object.keys(selection);
      const result = {};
      for (const key of keys) {
        if (own(index, key)) Object.defineProperty(result, key, {value: await readRecord(key, index[key]), enumerable: true, configurable: true, writable: true});
        else if (selection && !Array.isArray(selection) && typeof selection === 'object') result[key] = copy(selection[key]);
      }
      return result;
    });
  }
  async function mutate(values = {}, removed = [], clear = false) {
    await ready();
    return serial(async () => {
      const nextIndex = clear ? {} : {...index}, writes = {}, deletes = [], changes = {};
      const removal = clear ? Object.keys(index) : removed;
      for (const key of removal) if (own(index, key)) {
        changes[key] = {oldValue: await readRecord(key, index[key])}; deletes.push('data:' + index[key]); delete nextIndex[key];
      }
      for (const [key, value] of Object.entries(copy(values))) {
        if (value === undefined) throw Error('Cannot store an undefined value.');
        const old = own(index, key) ? await readRecord(key, index[key]) : undefined;
        if (JSON.stringify(old) === JSON.stringify(value) && own(nextIndex, key)) continue;
        if (own(index, key)) deletes.push('data:' + index[key]);
        const slot = identity(); Object.defineProperty(nextIndex, key, {value: slot, enumerable: true, configurable: true, writable: true});
        writes['data:' + slot] = await crypt.seal(meta.config, slot, {key, value});
        changes[key] = {...(old === undefined ? {} : {oldValue: old}), newValue: value};
      }
      if (!Object.keys(changes).length) return changes;
      const controlValues = {};
      for (const name of ['paused', 'recordingEpoch', 'setup:v1']) {
        if (own(values, name)) controlValues[name] = values[name];
        else if (own(nextIndex, name)) controlValues[name] = await readRecord(name, nextIndex[name]);
      }
      const next = {...meta, control: control(controlValues)};
      writes.meta = next; writes.index = await crypt.seal(meta.config, identity(), {kind: 'index', keys: nextIndex});
      await io.commit(writes, [...new Set(deletes)]); meta = next; index = nextIndex;
      return changes;
    });
  }
  async function append(message, clean) {
    await init();
    return serial(async () => {
      if (!meta?.control?.configured || meta.control.paused || message.epoch !== meta.control.epoch) return {ok: true, discarded: true};
      if (!/^[\w-]{36}$/.test(message.recorderId || '') || !Number.isSafeInteger(message.sequence) || message.sequence < 1) throw Error('Invalid recording receipt.');
      const receipt = message.recorderId + ':' + message.sequence, name = 'inbox:' + receipt;
      if (await io.get(name)) return {ok: true, duplicate: true};
      const payload = {kind: 'recording', message: {type:'events', recorderId:message.recorderId,
        sequence:message.sequence, epoch:message.epoch, events:clean(message.events)}};
      const sealed = await crypt.seal(meta.config, receipt, payload), bytes = size(sealed);
      if ((meta.inboxBytes || 0) + bytes > inboxLimit) throw Error('Unlock Ledger to organize its encrypted recordings and free inbox space. Keep this YouTube tab open to retry.');
      const next = {...meta, inboxCount: (meta.inboxCount || 0) + 1, inboxBytes: (meta.inboxBytes || 0) + bytes};
      await io.commit({[name]: sealed, meta: next}); meta = next; return {ok: true};
    });
  }
  async function entries() {
    await ready();
    return serial(async () => {
      const result = [];
      for (const [name, sealed] of await io.entries()) if (name.startsWith('inbox:')) {
        if (name !== 'inbox:' + sealed.recordId) throw Error('Invalid encrypted inbox identity.');
        const value = await crypt.open(meta.config, privateKey, sealed);
        if (value?.kind !== 'recording') throw Error('Invalid encrypted recording.');
        result.push({name, message: value.message});
      }
      return result.sort((a,b) => a.message.recorderId.localeCompare(b.message.recorderId) || a.message.sequence - b.message.sequence);
    });
  }
  async function acknowledge(name) {
    await ready(); return serial(async () => {
      const sealed = await io.get(name); if (!sealed || !name.startsWith('inbox:')) return;
      const next = {...meta, inboxCount: Math.max(0, (meta.inboxCount || 0) - 1), inboxBytes: Math.max(0, (meta.inboxBytes || 0) - size(sealed))};
      await io.commit({meta: next}, [name]); meta = next;
    });
  }
  async function sealBackup(value) {
    await ready(); return serial(async () => ({format: 'ledger-encrypted-profile', version: 1, vault: meta.config,
      payload: await crypt.seal(meta.config, identity(), {kind: 'profile-backup', value})}));
  }
  async function openBackup(backup, secret, recovery = false) {
    if (!backup || backup.format !== 'ledger-encrypted-profile' || backup.version !== 1 ||
        Object.keys(backup).sort().join(',') !== 'format,payload,vault,version') throw Error('Invalid encrypted backup.');
    await crypt.publicKey(backup.vault);
    const key = secret ? await crypt.unlock(backup.vault, secret, recovery) : privateKey && meta?.config.id === backup.vault.id ? privateKey : null;
    if (!key) throw Error('Enter the passphrase or recovery key for this backup.');
    const decoded = await crypt.open(backup.vault, key, backup.payload);
    if (decoded?.kind !== 'profile-backup') throw Error('Invalid encrypted backup contents.');
    return decoded.value;
  }
  async function changePassword(secret, next, recovery = false) {
    await ready(); return serial(async () => {
      const config = await crypt.changePassword(meta.config, secret, next, recovery), updated = {...meta, config};
      await io.commit({meta: updated}); meta = updated; return {ok: true};
    });
  }
  async function replaceRecovery(secret, recovery = false) {
    await ready(); return serial(async () => {
      const result = await crypt.replaceRecovery(meta.config,secret,recovery), updated = {...meta,config:result.config};
      await io.commit({meta:updated}); meta = updated; return {recoveryKey:result.recoveryKey};
    });
  }
  return {init, ready, create, unlock, resumeDevice, setDevice, setBrowserUnlock, confirmSecret, get, mutate, append, entries, acknowledge, sealBackup, openBackup, changePassword, replaceRecovery,
    async device() {await init(); return meta ? {vault:meta.config.id, device:meta.device || null} : null;},
    async status() {await init(); return state();},
    async controls() {await init(); return {paused: meta?.control?.paused !== false, recordingEpoch: meta?.control?.epoch,
      'setup:v1': {version: 1, complete: !!meta?.control?.configured}};},
    async bytes() {await init(); return size(await io.entries());}};
};
