globalThis.LedgerNotesUI = (() => {
  const input = document.getElementById('goals'), status = document.getElementById('notes-status'), retry = document.getElementById('notes-retry');
  let epoch;
  const ready = browser.storage.local.get('recordingEpoch').then(data => {epoch = data.recordingEpoch;});
  function show(day) {
    if (day !== date.value) return;
    const draft = saver.get(day);
    status.textContent = draft?.error ? 'Not saved: ' + draft.error + ' Your draft is still here.' : draft ? 'Saving notes…' : 'Notes saved.';
    retry.hidden = !draft?.error;
  }
  const saver = LedgerNoteSaver({send: async (day, value) => {
    await ready;
    const result = await browser.runtime.sendMessage({type: 'data:note', day, value, epoch});
    if (!result?.ok) throw Error(result?.error || 'Could not save notes.');
  }, changed: show});
  input.addEventListener('input', () => saver.update(date.value, input.value));
  retry.addEventListener('click', () => void saver.flush().catch(() => {}));
  window.addEventListener('beforeunload', event => {if (saver.dirty) {event.preventDefault(); event.returnValue = '';}});
  browser.storage.onChanged.addListener((changes, area) => {if(area==='local'&&changes.recordingEpoch&&!saver.dirty)epoch=changes.recordingEpoch.newValue;});
  return {
    flush: () => saver.flush(),
    draft: day => saver.get(day),
    async discard(from, through) {saver.discard(from,through);epoch=(await browser.storage.local.get('recordingEpoch')).recordingEpoch;show(date.value);},
    render(day, saved) {const value=saver.get(day)?.value ?? saved ?? '';if(input.value!==value)input.value=value;show(day);},
    async reset() {saver.reset(); epoch = (await browser.storage.local.get('recordingEpoch')).recordingEpoch; show(date.value);}
  };
})();
