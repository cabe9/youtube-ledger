const settingsFields = Object.keys(Ledger.defaults);
let settingsSaveQueue=Promise.resolve();
let themeRevision=0;
document.getElementById('setting-theme').addEventListener('change',event=>{
  const theme=event.target.value;
  const revision=++themeRevision;
  pendingDashboardTheme=theme;
  applyDashboardTheme(theme);
  document.getElementById('settings-status').textContent='Saving theme…';
  settingsSaveQueue=settingsSaveQueue.then(async()=>{
    const data=await browser.storage.local.get('settings');
    await browser.storage.local.set({settings:{...Ledger.settings(data.settings),theme}});
    if (revision===themeRevision) {
      pendingDashboardTheme=null;
      document.getElementById('settings-status').textContent='Theme saved.';
    }
  }).catch(async()=>{
    if (revision!==themeRevision) return;
    pendingDashboardTheme=null;
    const data=await browser.storage.local.get('settings').catch(()=>({}));
    const saved=Ledger.settings(data.settings).theme;
    applyDashboardTheme(saved);
    document.getElementById('setting-theme').value=saved;
    document.getElementById('settings-status').textContent='Could not save theme. Please try again.';
  });
});
const checkboxRevisions=new Map();
for(const key of settingsFields){
  const input=document.getElementById('setting-'+key);
  if(input.type!=='checkbox')continue;
  input.addEventListener('change',()=>{
    const checked=input.checked,revision=(checkboxRevisions.get(key)||0)+1;
    checkboxRevisions.set(key,revision);
    const current=()=>checkboxRevisions.get(key)===revision;
    const motion=key==='animateRetrowave',status=document.getElementById('settings-status');
    if(motion){pendingDashboardMotion=checked;document.documentElement.dataset.motion=checked?'on':'off';}
    status.textContent=motion?'Saving animation setting…':'Saving…';
    // Save this checkbox only; review instruction drafts still wait for Save instructions.
    // Share the write queue so rapid toggles and profile exports keep the last choice.
    settingsSaveQueue=settingsSaveQueue.then(async()=>{
      const data=await browser.storage.local.get('settings');
      await browser.storage.local.set({settings:{...Ledger.settings(data.settings),[key]:checked}});
      if(current()){
        if(motion)pendingDashboardMotion=null;
        input.checked=checked;
        status.textContent=motion?'Animation setting saved.':'Settings saved.';
      }
      await render().catch(console.error);
    }).catch(async()=>{
      if(!current())return;
      const data=await browser.storage.local.get('settings').catch(()=>null);
      if(!current())return;
      if(motion)pendingDashboardMotion=null;
      if(data){
        input.checked=Ledger.settings(data.settings)[key];
        if(motion)document.documentElement.dataset.motion=input.checked?'on':'off';
      }
      status.textContent='Could not save this setting. Please try again.';
    });
  });
}
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
    value[key]=input.type==='checkbox' ? input.checked : input.value;
  }
  settingsSaveQueue=settingsSaveQueue.then(async()=>{
    await browser.storage.local.set({settings:Ledger.settings(value)});
    await render();
    document.getElementById('settings-status').textContent='Instructions saved.';
  }).catch(()=>{document.getElementById('settings-status').textContent='Could not save instructions. Please try again.';});
});
document.getElementById('settings-reset').addEventListener('click',async()=>{
  settingsSaveQueue=settingsSaveQueue.then(async()=>{
    await browser.storage.local.set({settings:{...Ledger.defaults}});
    fillSettings(Ledger.defaults);await render();
    document.getElementById('settings-status').textContent='Defaults restored.';
  }).catch(()=>{document.getElementById('settings-status').textContent='Could not restore settings. Please try again.';});
});
