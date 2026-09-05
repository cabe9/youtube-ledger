const settingsFields = Object.keys(Ledger.defaults);
let themeSaveQueue=Promise.resolve();
let themeRevision=0;
document.getElementById('setting-theme').addEventListener('change',event=>{
  const theme=event.target.value;
  const revision=++themeRevision;
  pendingDashboardTheme=theme;
  document.documentElement.dataset.theme=theme;
  document.getElementById('settings-status').textContent='Saving theme…';
  themeSaveQueue=themeSaveQueue.then(async()=>{
    const data=await browser.storage.local.get('settings');
    await browser.storage.local.set({settings:{...Ledger.settings(data.settings),theme}});
    if (revision===themeRevision) {
      pendingDashboardTheme=null;
      document.getElementById('settings-status').textContent='Theme saved. Other changes still need Save settings.';
    }
  }).catch(async()=>{
    if (revision!==themeRevision) return;
    pendingDashboardTheme=null;
    const data=await browser.storage.local.get('settings').catch(()=>({}));
    const saved=Ledger.settings(data.settings).theme;
    document.documentElement.dataset.theme=saved;
    document.getElementById('setting-theme').value=saved;
    document.getElementById('settings-status').textContent='Could not save theme. Please try again.';
  });
});
let motionRevision=0;
document.getElementById('setting-animateRetrowave').addEventListener('change',event=>{
  const animateRetrowave=event.target.checked;
  const revision=++motionRevision;
  pendingDashboardMotion=animateRetrowave;
  document.documentElement.dataset.motion=animateRetrowave ? 'on' : 'off';
  document.getElementById('settings-status').textContent='Saving animation setting…';
  // Serialize with theme saves so quick appearance changes preserve both choices.
  themeSaveQueue=themeSaveQueue.then(async()=>{
    const data=await browser.storage.local.get('settings');
    await browser.storage.local.set({settings:{...Ledger.settings(data.settings),animateRetrowave}});
    if (revision===motionRevision) {
      pendingDashboardMotion=null;
      document.getElementById('settings-status').textContent='Animation setting saved.';
    }
  }).catch(async()=>{
    if (revision!==motionRevision) return;
    pendingDashboardMotion=null;
    const data=await browser.storage.local.get('settings').catch(()=>({}));
    const saved=Ledger.settings(data.settings).animateRetrowave;
    document.documentElement.dataset.motion=saved ? 'on' : 'off';
    document.getElementById('setting-animateRetrowave').checked=saved;
    document.getElementById('settings-status').textContent='Could not save animation setting. Please try again.';
  });
});
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
    await themeSaveQueue;
    await browser.storage.local.set({settings:Ledger.settings(value)});
    await render();
    document.getElementById('settings-status').textContent='Settings saved.';
  } catch {document.getElementById('settings-status').textContent='Could not save settings. Please try again.';}
});
document.getElementById('settings-reset').addEventListener('click',async()=>{
  try {
    await themeSaveQueue;
    await browser.storage.local.set({settings:{...Ledger.defaults}});
    fillSettings(Ledger.defaults);await render();
    document.getElementById('settings-status').textContent='Defaults restored.';
  } catch {document.getElementById('settings-status').textContent='Could not restore settings. Please try again.';}
});
