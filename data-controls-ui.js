/* Explicit local choices; no network request is made by these controls. */
globalThis.LedgerDataUI = (() => {
  const setup = document.getElementById('setup-panel');
  const section = document.getElementById('data-controls');
  const status = document.getElementById('data-status');
  let state, busy = false, revision = 0;
  async function request(message) {
    const result = await browser.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || 'Ledger could not save this change.');
    return result;
  }
  function fillSetup() {
    const settings = state?.settings || Ledger.defaults;
    document.getElementById('setup-tracking').checked = state?.setup?.complete ? !state.paused : false;
    for (const key of ['hideRecommendations', 'learnYouTubeProgress', 'backgroundGroupChecks']) document.getElementById('setup-' + key).checked = state?.setup?.complete ? settings[key] : false;
  }
  function showSetup() {
    fillSetup(); setup.hidden = false; setup.focus(); setup.scrollIntoView({block: 'start', behavior: 'auto'});
  }
  async function refresh() {
    const current = ++revision, next = await request({type: 'data:status'});
    if (current !== revision) return;
    state = next;
    if (!next.setup?.complete && setup.hidden) {fillSetup(); setup.hidden = false;}
    const amount = bytes => (bytes / 1048576).toFixed(2) + ' MB';
    document.getElementById('storage-summary').textContent = amount(next.bytes) + (next.quota ? ' of ' + amount(next.quota) : ' used locally') + ' · ' + next.days + ' days with saved history or notes';
    const meter = document.getElementById('storage-meter');
    meter.hidden = !next.quota; meter.max = next.quota || 1; meter.value = Math.min(next.bytes, meter.max);
    document.getElementById('storage-warning').hidden = !next.quota || next.bytes < next.quota * .8;
    if (!busy) document.getElementById('retention-days').value = String(next.retentionDays);
    for (const [id, value] of [['delete-from', next.firstDay], ['delete-through', next.lastDay]]) {
      const input = document.getElementById(id); if (!input.value) input.value = value;
    }
    document.getElementById('delete-history').disabled = busy || !next.days;
    if (!next.setup?.complete) {
      document.getElementById('tracking-indicator').textContent = 'Setup needed';
      document.getElementById('pause').textContent = 'Set up Ledger';
    }
  }
  async function perform(message, success, after = () => {}) {
    if (busy) return;
    busy = true; status.textContent = 'Saving…';
    const controls = [...section.querySelectorAll('button,input,select')];
    for (const input of controls) input.disabled = true;
    try {
      await settingsSaveQueue;
      // Storage pressure must not prevent deletion. Unaffected drafts remain available.
      await globalThis.LedgerNotesUI?.flush().catch(() => {});
      await request(message);
      await after(); status.textContent = success;
      if (message.type === 'data:eraseAll') {
        // The background reload stops old writers and closes Chrome extension pages.
        return;
      }
      const data = await browser.storage.local.get('settings'); fillSettings(data.settings);
      await render();
    } catch (error) {status.textContent = error.message;}
    finally {
      busy = false; for (const input of controls) input.disabled = false;
      if (message.type !== 'data:eraseAll') await refresh().catch(() => {});
    }
  }
  document.getElementById('setup-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = document.getElementById('setup-save'), note = document.getElementById('setup-status');
    button.disabled = true; note.textContent = 'Saving your choices…';
    try {
      await settingsSaveQueue;
      const choices = Object.fromEntries(['tracking', 'hideRecommendations', 'learnYouTubeProgress', 'backgroundGroupChecks'].map(key => [key, document.getElementById('setup-' + key).checked]));
      await request({type: 'data:setup', ...choices});
      setup.hidden = true; note.textContent = '';
      const data = await browser.storage.local.get('settings'); fillSettings(data.settings);
      await render(); await refresh();
      document.getElementById(viewHeadings[activeView]).focus({preventScroll: true});
    } catch (error) {note.textContent = error.message;}
    finally {button.disabled = false;}
  });
  document.getElementById('setup-review').addEventListener('click', showSetup);
  document.getElementById('retention-save').addEventListener('click', () => {
    const days = Number(document.getElementById('retention-days').value);
    if (days && !confirm('Keep the most recent ' + days + ' calendar days, including today? Older history, notes, labels and recommendation events will be deleted now and during future use. Watch status stays saved. Export a backup first if you want to keep older records. With local sync enabled, these deletions also reach paired browsers.')) return;
    void perform({type: 'data:retention', days}, days ? 'Retention saved. Older history and notes were removed. Watch status is unchanged.' : 'Automatic history deletion is off.', () => {const before=new Date();before.setDate(before.getDate()-days);return globalThis.LedgerNotesUI?.discard('0000-01-01',days?Ledger.dayKey(before.getTime()):'0000-01-01');});
  });
  document.getElementById('delete-range').addEventListener('click', () => {
    const from = document.getElementById('delete-from').value, through = document.getElementById('delete-through').value;
    if (!from || !through || from > through) {status.textContent = 'Choose a start date on or before the end date.'; return;}
    if (!confirm('Delete history, notes, labels and recommendation events from ' + from + ' through ' + through + '? Watch status and groups stay saved. With local sync enabled, this deletion also reaches paired browsers. This cannot be undone.')) return;
    void perform({type: 'data:deleteDays', from, through}, 'The selected history and notes were deleted. New activity can still be recorded.', () => globalThis.LedgerNotesUI?.discard(from,through));
  });
  document.getElementById('delete-history').addEventListener('click', () => {
    if (!state?.days || !confirm('Delete all saved history, notes, labels and recommendation events? Groups and watch status stay saved. With local sync enabled, this deletion also reaches paired browsers. This cannot be undone.')) return;
    const from=state.firstDay,through=state.lastDay;
    void perform({type: 'data:deleteDays', from, through}, 'Saved history and notes were deleted. New activity can still be recorded.', () => globalThis.LedgerNotesUI?.discard(from,through));
  });
  document.getElementById('reset-watch').addEventListener('click', () => {
    if (!confirm('Reset all resume positions, watched/unwatched choices, and YouTube/imported watch evidence? Passive learning from YouTube will be turned off. Future playback can create new progress. Your history stays saved. With local sync enabled, watch-status changes also reach paired browsers.')) return;
    void perform({type: 'data:resetWatch'}, 'Watch status reset. Passive learning is off; you can enable it again in Settings.',()=>globalThis.LedgerNotesUI?.discard('0000-01-01','0000-01-01'));
  });
  document.getElementById('erase-all').addEventListener('click', () => {
    if (!confirm('Delete ALL local Ledger data, including history, notes, groups, icons, preferences, caches and watch status? Ledger will reload with tracking off. This disconnects only this browser; paired browsers and the companion copy remain. This cannot be undone and does not delete YouTube account data or exported files.')) return;
    void perform({type: 'data:eraseAll'}, 'Local data deleted. Ledger will close while it reloads. Reopen it from the toolbar to set up again.', () => globalThis.LedgerNotesUI?.reset());
  });
  let refreshTimer;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['setup:v1']?.newValue?.complete) setup.hidden = true;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => {if (activeView === 'settings' || changes['setup:v1']) void refresh().catch(() => {});}, 250);
  });
  window.addEventListener('hashchange', () => {if (activeView === 'settings') void refresh().catch(() => {});});
  void refresh().catch(error => {status.textContent = error.message;});
  return {refresh, showSetup};
})();
