globalThis.LedgerYouTubeAccessUI = (() => {
  const byId = id=>document.getElementById(id);
  const allow=byId('youtube-access-allow'), check=byId('youtube-access-check');
  const setupConnection=document.createElement('div');setupConnection.className='setup-connection';
  setupConnection.innerHTML='<h3>Check YouTube access</h3><p data-setup-connection-status role="status">Checking…</p><div class="actions"><button type="button" class="secondary" data-setup-allow hidden>Allow YouTube access</button><a href="https://www.youtube.com/" target="_blank" rel="noreferrer">Open YouTube</a><button type="button" class="secondary" data-setup-check>Check again</button></div>';
  byId('setup-form').after(setupConnection);
  setupConnection.querySelector('[data-setup-allow]').onclick=()=>allow.click();
  setupConnection.querySelector('[data-setup-check]').onclick=()=>refresh();
  let revision=0, state={}, requesting=false, label='Checking YouTube access';
  function updateIndicator() {
    byId('tracking-indicator').textContent=document.documentElement?.dataset?.recordingWarning==='true' ? 'Recording warning' : label;
  }
  async function refresh(next=state) {
    state=next;
    const current=++revision, access=await LedgerYouTubeAccess.inspect();
    if(current!==revision)return;
    const view=LedgerYouTubeAccess.describe(access,state);
    label=view.label;updateIndicator();
    const panel=byId('youtube-access-heading').closest('section');
    panel.hidden=access.kind==='granted'&&access.connected>=access.tabs;
    panel.dataset.state=access.kind==='granted'?(access.connected<access.tabs?'attention':access.connected?'connected':'idle'):'attention';
    byId('youtube-access-status').textContent=view.message;
    setupConnection.querySelector('[data-setup-connection-status]').textContent=view.message;
    setupConnection.querySelector('[data-setup-allow]').hidden=!view.allow;
    allow.hidden=!view.allow;
    const notice=byId('youtube-connection-notice');
    notice.hidden=access.kind==='granted'&&access.connected>=access.tabs;
    byId('youtube-connection-notice-text').textContent=view.message;
  }
  allow.addEventListener('click',async()=>{
    if(requesting)return;
    requesting=true;allow.disabled=true;
    try {
      const granted=await LedgerYouTubeAccess.request();
      byId('youtube-access-result').textContent=granted
        ? 'YouTube access allowed. Refresh open YouTube tabs that are missing Ledger’s controls, then select Check connection.'
        : 'YouTube access was not granted. You can keep using your saved history and notes, and allow access later.';
    } catch {
      byId('youtube-access-result').textContent='Could not request access. In your browser’s extension menu on YouTube, choose Always run for Ledger, then refresh YouTube.';
    } finally { requesting=false;allow.disabled=false;await refresh(); }
  });
  check.addEventListener('click',()=>refresh());
  window.addEventListener('focus',()=>refresh());
  browser.permissions?.onAdded?.addListener(()=>refresh());
  browser.permissions?.onRemoved?.addListener(()=>refresh());
  return {refresh,updateIndicator};
})();
