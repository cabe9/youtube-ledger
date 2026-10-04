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
// The same preference can be changed from a group's menu on YouTube.
browser.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.settings)document.getElementById('setting-groupDebugMode').checked=Ledger.settings(changes.settings.newValue).groupDebugMode;
});
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

// Organize the existing controls without replacing their listeners or draft values.
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.querySelector('[data-view="settings"]'), form=document.getElementById('settings-form');
  const oldPanel=root.querySelector('.settings-panel'), help=oldPanel.querySelector(':scope > .note');
  const explanation=form.querySelector(':scope > .note');
  const save=form.querySelector('button[type="submit"]');
  const reset=document.getElementById('settings-reset'), status=document.getElementById('settings-status');
  // Explicit ownership lets the same form span the visual categories.
  for(const control of form.querySelectorAll('input,select,textarea,button'))control.setAttribute('form',form.id);
  const shell=document.createElement('div');shell.className='settings-workspace';
  const sidebar=document.createElement('div');sidebar.className='settings-sidebar';
  const tabs=document.createElement('div');tabs.className='settings-tabs';tabs.id='settings-categories';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Settings categories');
  const content=document.createElement('div');content.className='settings-content';
  sidebar.append(tabs);shell.append(sidebar,content);oldPanel.before(shell);
  const categories=[
    ['general','General','Appearance and reviews'],
    ['youtube','YouTube','Playback and permissions'],
    ['data','Sync & data','Browsers, backups and storage'],
    ['advanced','Advanced','Diagnostics and reset']
  ];
  const panels=new Map(),buttons=[];
  for(const [id,title,hint] of categories){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.id='settings-tab-'+id;
    button.setAttribute('role','tab');button.setAttribute('aria-controls','settings-page-'+id);
    const name=document.createElement('span'),sub=document.createElement('small');name.textContent=title;sub.textContent=hint;button.append(name,sub);tabs.append(button);buttons.push(button);
    const panel=document.createElement('section');panel.id='settings-page-'+id;panel.className='settings-page';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;content.append(panel);panels.set(id,panel);
    button.addEventListener('click',()=>select(id));
  }
  function select(id){
    for(const [key,panel] of panels){const active=key===id;panel.hidden=!active;const button=document.getElementById('settings-tab-'+key);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
  }
  tabs.addEventListener('keydown',event=>{
    const index=buttons.indexOf(document.activeElement);if(index<0)return;
    let next;if(['ArrowDown','ArrowRight'].includes(event.key))next=(index+1)%buttons.length;
    if(['ArrowUp','ArrowLeft'].includes(event.key))next=(index+buttons.length-1)%buttons.length;
    if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;
    if(next!==undefined){event.preventDefault();select(categories[next][0]);buttons[next].focus();}
  });
  const narrow=window.matchMedia('(max-width:760px)');
  const orient=()=>tabs.setAttribute('aria-orientation',narrow.matches?'horizontal':'vertical');orient();narrow.addEventListener('change',orient);
  function section(category,title,description,keys=[]){
    const block=document.createElement('section');block.className='settings-section';
    const heading=document.createElement('h3');heading.textContent=title;block.append(heading);
    if(description){const intro=document.createElement('p');intro.className='settings-description';intro.textContent=description;block.append(intro);}
    for(const key of keys)block.append(document.getElementById('setting-'+key).closest('label'));
    panels.get(category).append(block);return block;
  }
  section('general','Appearance','Make Ledger feel at home in your browser.',['theme','animateRetrowave']);
  const review=section('general','Reviews','Optional instructions for the AI review you export.',['reviewPreference']);
  review.querySelector('label').classList.add('review-preference-label');
  const saveRow=document.createElement('div');saveRow.className='actions';saveRow.append(save);review.append(saveRow);
  section('youtube','Recommendations','Choose what appears when you open YouTube.',['hideRecommendations','resetOnNavigate','showHeaderButton']).append(explanation);
  section('youtube','History and uploads','How Ledger keeps your viewing record and channel groups up to date.',['showPausedOnly','backgroundGroupChecks','learnYouTubeProgress']).append(document.querySelector('.watch-status-actions'));
  const permissions=document.getElementById('connections-heading').closest('section');panels.get('youtube').append(permissions);
  section('youtube','Watch Later','', ['watchLaterCleanup']);
  const sync=document.getElementById('local-sync'),backup=document.getElementById('backup-export').closest('section'),storage=document.getElementById('data-controls');
  panels.get('data').append(backup,storage,sync);
  section('advanced','Troubleshooting','Extra information when a group does not look right.',['groupDebugMode']);
  panels.get('advanced').append(document.querySelector('.settings-diagnostics'));
  const defaults=section('advanced','Setup and defaults','Restore appearance and behavior preferences, or revisit your tracking choices.');
  const resetRow=document.createElement('div');resetRow.className='actions';resetRow.append(reset,document.getElementById('setup-review'));defaults.append(resetRow);
  // Keep saving feedback visible whichever category owns the changed control.
  const feedback=document.createElement('div');feedback.className='settings-feedback';feedback.append(status);content.append(feedback);
  help.className='settings-help';help.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE)node.textContent=' ';});sidebar.append(help);
  const intro=document.createElement('p');intro.className='settings-intro';intro.textContent='Make Ledger work the way you watch. Preferences save automatically; review instructions have their own Save button.';root.querySelector('.toolbar').after(intro);
  // Keep the form itself for submission; its controls retain explicit ownership.
  form.replaceChildren();form.hidden=true;root.append(form);oldPanel.remove();
  select('general');
});
