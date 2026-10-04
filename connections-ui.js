/* Browser permission prompts are requested only by these explicit user gestures. */
(() => {
  const note = document.getElementById('connections-status');
  const fields = {network: document.getElementById('connection-network'), account: document.getElementById('connection-account')};
  let busy = false;
  function show(value) {
    if (busy) return;
    for (const [kind, input] of Object.entries(fields)) input.checked = value?.[kind] === true;
  }
  for (const [kind, input] of Object.entries(fields)) input.addEventListener('change', () => {
    const enabled = input.checked;
    const request = LedgerConnections.change(kind, enabled);
    busy = true; for (const field of Object.values(fields)) field.disabled = true;
    note.textContent = 'Saving connection choice…';
    void request.then(granted => {
      note.textContent = enabled && !granted ? 'Permission declined. Local records remain available.' : enabled ? kind === 'account' ? 'Account permission saved. Enable Watch Later cleanup below to show selection controls on YouTube.' : 'Permission saved. You can now refresh groups or load YouTube images.' : 'Connection disabled. Local records remain available.';
    }).catch(error => { note.textContent = error.message; }).finally(async () => {
      busy = false; for (const field of Object.values(fields)) field.disabled = false;
      show(await LedgerConnections.status());
    });
  });
  LedgerConnections.onChange(show);
  void LedgerConnections.status().then(show);
})();
