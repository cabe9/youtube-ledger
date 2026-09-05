const settingsFields = Object.keys(Ledger.defaults);
function fillSettings(value) {
  const settings=Ledger.settings(value);
  for (const key of settingsFields) {
    const input=document.getElementById('setting-'+key);
    if (input.type==='checkbox') input.checked=settings[key]; else input.value=settings[key];
  }
}
browser.storage.local.get('settings').then(data=>fillSettings(data.settings));
document.getElementById('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const value={};
  for (const key of settingsFields) {
    const input=document.getElementById('setting-'+key);
    value[key]=input.type==='checkbox' ? input.checked : input.type==='number' ? Number(input.value) : input.value;
  }
  try {
    await browser.storage.local.set({settings:Ledger.settings(value)});
    await render();
    document.getElementById('settings-status').textContent='Settings saved.';
  } catch {document.getElementById('settings-status').textContent='Could not save settings. Please try again.';}
});
document.getElementById('settings-reset').addEventListener('click',async()=>{
  try {
    await browser.storage.local.set({settings:{...Ledger.defaults}});
    fillSettings(Ledger.defaults);await render();
    document.getElementById('settings-status').textContent='Defaults restored.';
  } catch {document.getElementById('settings-status').textContent='Could not restore settings. Please try again.';}
});
