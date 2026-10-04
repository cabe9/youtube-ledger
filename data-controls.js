/* Local consent, retention and deletion. All mutations share the recording writer. */
globalThis.LedgerData = (() => {
  const setupKey = 'setup:v1', policyKey = 'dataPolicy:v1';
  const historyKey = /^(day|goals|purposes|recommendations):(\d{4}-\d{2}-\d{2})$/;
  const allowedRetention = [0, 30, 90, 365];
  let initialized, lastPrunedDay;
  const dashboard = sender => !sender.tab?.incognito && (sender.url || '').split(/[?#]/)[0] === browser.runtime.getURL('dashboard.html');
  function validDay(day) {
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Ledger.datesEnding(day, 1)[0] === day;
  }
  const ready = () => initialized ||= LedgerStorage.write(async () => {
    const data = await browser.storage.local.get([setupKey, 'paused', 'settings']);
    if (data[setupKey]?.erasePending) {
      await browser.storage.local.clear();
      await browser.storage.session.clear();
      await browser.storage.local.set({[setupKey]: {version: 1, complete: false}, paused: true, recordingEpoch: crypto.randomUUID()});
    } else if (!data[setupKey]) {
      try {await LedgerStorage.saveHistory({[setupKey]: {version: 1, complete: false}, paused: true});}
      catch(error) {
        // Missing consent still blocks collection. Keep deletion usable even if
        // an upgraded profile is too full to persist the setup marker.
        if(!LedgerStorage.quotaError(error))throw error;
      }
    }
  });
  async function configured() {
    await ready();
    return (await browser.storage.local.get(setupKey))[setupKey]?.complete === true;
  }
  function cutoff(days, now = Date.now()) {
    if (!days) return null;
    const date = new Date(now); date.setDate(date.getDate() - days + 1);
    return Ledger.dayKey(date.getTime());
  }
  function expiredKeys(data, days, now) {
    const before = cutoff(days, now);
    return before ? Object.keys(data).filter(key => historyKey.test(key) && historyKey.exec(key)[2] < before) : [];
  }
  // Called inside LedgerStorage.write, including by the recorder. No nested writer.
  async function prune(now = Date.now(), force = false) {
    const today = Ledger.dayKey(now);
    if (!force && lastPrunedDay === today) return;
    const data = await browser.storage.local.get(null), days = data[policyKey]?.retentionDays || 0;
    const keys = expiredKeys(data, days, now);
    if (keys.length) await browser.storage.local.remove(keys);
    lastPrunedDay = today;
  }
  function accepts(at, policy, now = Date.now()) {
    const before = cutoff(policy?.retentionDays || 0, now);
    return !before || Ledger.dayKey(at) >= before;
  }
  async function status() {
    const data = await browser.storage.local.get(null), keys = Object.keys(data);
    const bytes = browser.storage.local.getBytesInUse
      ? await browser.storage.local.getBytesInUse(null)
      : keys.reduce((n, key) => n + new TextEncoder().encode(key + JSON.stringify(data[key])).length, 0);
    const days = [...new Set(keys.map(key => historyKey.exec(key)?.[2]).filter(Boolean))].sort();
    return {ok: true, setup: data[setupKey], settings: Ledger.settings(data.settings), paused: data.paused !== false,
      bytes, quota: browser.storage.local.QUOTA_BYTES || null, retentionDays: data[policyKey]?.retentionDays || 0,
      days: days.length, firstDay: days[0] || '', lastDay: days.at(-1) || ''};
  }
  async function rotateRecording() {
    await LedgerStorage.saveHistory({recordingEpoch: crypto.randomUUID()});
  }
  async function deleteDays(from, through) {
    if (!validDay(from) || !validDay(through) || from > through) throw Error('Choose a valid date range.');
    const data = await browser.storage.local.get(null);
    const keys = Object.keys(data).filter(key => {
      const match = historyKey.exec(key); return match && match[2] >= from && match[2] <= through;
    });
    // Removing inside the writer frees quota before invalidating buffered retries.
    await browser.storage.local.remove(keys);
    await rotateRecording();
    return {ok: true, deletedDays: new Set(keys.map(key => historyKey.exec(key)[2])).size};
  }
  async function handle(message, sender) {
    if (!dashboard(sender)) throw Error('Open Ledger Settings to manage your data.');
    await ready();
    if (message.type === 'data:status') {await LedgerStorage.write(() => prune()); return status();}
    return LedgerStorage.write(async () => {
      if (message.type === 'data:setup') {
        if (['tracking', 'hideRecommendations', 'learnYouTubeProgress', 'backgroundGroupChecks'].some(key => typeof message[key] !== 'boolean')) throw Error('Choose your setup preferences.');
        const data = await browser.storage.local.get('settings');
        await browser.storage.local.set({[setupKey]: {version: 1, complete: true, acceptedAt: Date.now()}, paused: !message.tracking,
          settings: {...Ledger.settings(data.settings), hideRecommendations: message.hideRecommendations,
            learnYouTubeProgress: message.learnYouTubeProgress, backgroundGroupChecks: message.backgroundGroupChecks}});
        return {ok: true};
      }
      if (message.type === 'data:retention') {
        if (!allowedRetention.includes(message.days)) throw Error('Choose a supported retention period.');
        const data = await browser.storage.local.get(null);
        await browser.storage.local.remove(expiredKeys(data, message.days));
        await rotateRecording();
        await browser.storage.local.set({[policyKey]: {version: 1, retentionDays: message.days}});
        await prune(Date.now(), true);
        return {ok: true};
      }
      if (message.type === 'data:note') {
        if (!validDay(message.day) || typeof message.value !== 'string' || message.value.length > 1000000) throw Error('These notes could not be saved.');
        const data = await browser.storage.local.get(['recordingEpoch', policyKey]);
        if (message.epoch !== data.recordingEpoch) throw Error('Ledger data changed in another tab. Reload before saving these notes.');
        if (!accepts(new Date(message.day + 'T12:00:00').getTime(), data[policyKey])) throw Error('This day is outside your history retention period. Change retention in Settings to save notes here.');
        await LedgerStorage.saveHistory({['goals:' + message.day]: message.value});
        return {ok: true};
      }
      if (message.type === 'data:deleteDays') return deleteDays(message.from, message.through);
      if (message.type === 'data:resetWatch') {
        const data = await browser.storage.local.get('settings');
        // An empty progress record prevents migration from reconstructing it from history.
        await browser.storage.local.set({'videoProgress:v1': {version: 1, videos: {}}, 'watchEvidence:v1': {version: 1, videos: {}},
          settings: {...Ledger.settings(data.settings), learnYouTubeProgress: false}});
        await rotateRecording();
        await browser.storage.session.remove('ledgerUndo:v1');
        return {ok: true};
      }
      if (message.type === 'data:eraseAll') {
        globalThis.GroupFeeds?.invalidate();
        await browser.storage.local.clear();
        await browser.storage.session.clear();
        await browser.storage.local.set({[setupKey]: {version: 1, complete: false, erasePending: true}, paused: true, recordingEpoch: crypto.randomUUID()});
        await browser.action.setBadgeText({text: ''});
        // Stop every old request, timer and tab context; old in-memory queues must not restore deleted data.
        setTimeout(() => browser.runtime.reload(), 1200);
        return {ok: true, reload: true};
      }
      throw Error('Unknown data-control request.');
    });
  }
  return {setupKey, policyKey, ready, configured, prune, accepts, expiredKeys, cutoff, validDay, deleteDays, handle};
})();
void LedgerData.ready().then(() => LedgerStorage.write(() => LedgerData.prune())).catch(console.error);
