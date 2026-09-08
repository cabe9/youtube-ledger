(() => {
  const disposeEvent='ledger-channel-groups-dispose';
  document.dispatchEvent(new Event(disposeEvent));
  // Extension reloads can leave controls and open dialogs in the current page.
  document.querySelectorAll('#ledger-channel-groups-control, #ledger-channel-groups-dialog').forEach(node=>{node.shadowRoot?.querySelector('dialog')?.close();node.remove();});
  let disposed=false;
  let control, button, modal, route='', navigating=false;
  let theme=Ledger.settings().theme, themeReady=false, settingsChanged=false;
  // Register at document_start, before YouTube's global shortcuts. Shadow DOM retargets
  // the input to our host, so YouTube otherwise treats typing as player commands.
  // Stop propagation only: native editing, Tab, Enter, Escape, and checkbox activation still work.
  const groupKeys=new Set();
  function protectKeys(event){
    if(disposed)return;
    const type=event.type;
    const openDialog=[...document.querySelectorAll('#ledger-channel-groups-dialog, #ledger-group-icon-dialog, #ledger-group-manager-dialog, #ledger-group-bulk-dialog, #ledger-group-sharing-dialog')].map(host=>host.shadowRoot?.querySelector('dialog[open]')).filter(Boolean).at(-1);
    const path=event.composedPath(), inside=!!openDialog||(modal?.isConnected&&path.includes(modal))||path.some(node=>['ledger-group-queue','ledger-group-feed','ledger-groups-sidebar','ledger-group-actions','ledger-groups-mini','ledger-group-icon-dialog','ledger-group-manager-dialog','ledger-group-bulk-dialog','ledger-group-sharing-dialog'].includes(node?.id)), key=event.code||event.key;
    const protect=inside||groupKeys.has(key);
    if(type==='keydown'&&inside)groupKeys.add(key);
    if(type==='keyup')groupKeys.delete(key);
    // Escape or Enter can close/re-render the menu before keyup; finish protecting that keystroke.
    if(protect)event.stopImmediatePropagation();
    if(inside&&path.some(node=>['ledger-groups-sidebar','ledger-group-actions'].includes(node?.id))&&globalThis.LedgerGroupMenuKeyboard?.(event))event.preventDefault();
    if(inside&&path.some(node=>node?.id==='ledger-group-feed')&&globalThis.LedgerFeedKeyboard?.(event))event.preventDefault();
    if(inside&&type==='keydown'&&event.key==='Escape'&&!event.isComposing&&path[0]?.tagName!=='SELECT'){
      const dialog=path.find(node=>node?.tagName==='DIALOG')||openDialog;if(dialog){event.preventDefault();dialog.close();}
    }
  }
  for(const type of ['keydown','keypress','keyup'])window.addEventListener(type,protectKeys,true);
  const clearKeys=()=>groupKeys.clear();
  window.addEventListener('blur',clearKeys);
  function applyTheme(settings){
    if(disposed)return;
    theme=Ledger.settings(settings).theme;themeReady=true;
    if(modal)modal.dataset.ledgerTheme=theme;
    mount();
  }
  function updateSettings(changes,area){
    if(disposed)return;
    if(area==='local'&&changes.settings){settingsChanged=true;applyTheme(changes.settings.newValue);}
  }
  browser.storage.onChanged.addListener(updateSettings);
  browser.storage.local.get('settings').then(data=>{if(!settingsChanged)applyTheme(data.settings);}).catch(()=>{if(!settingsChanged)applyTheme();});
  function identity(){const u=new URL(location.href);if(u.pathname==='/watch'&&/^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get('v')||''))return 'https://www.youtube.com/watch?v='+u.searchParams.get('v');if(/^\/(?:@[^/]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[^/]+|user\/[^/]+)(?:\/|$)/.test(u.pathname))return 'https://www.youtube.com'+u.pathname;return '';}
  function close(){modal?.shadowRoot?.querySelector('dialog')?.close();modal?.remove();modal=null;}
  function channelButtonPlacement(){
    const header=document.querySelector('ytd-browse[page-subtype="channels"] yt-page-header-renderer, ytd-c4-tabbed-header-renderer, ytd-browse[page-subtype="channels"] yt-page-header-view-model');
    const target=header?.querySelector('yt-flexible-actions-view-model, #buttons');
    if(!target)return {};
    // Keep Ledger in the native actions row, outside the Subscribe component's own rendering.
    let anchor=target.querySelector('yt-subscribe-button-view-model, ytd-subscribe-button-renderer, #subscribe-button');
    if(anchor){while(anchor.parentElement!==target)anchor=anchor.parentElement;}
    // Current signed-out headers render Subscribe as the first generic button action.
    else anchor=Array.from(target.children).find(child=>child!==control&&child.querySelector('button'));
    return anchor?{target,anchor}:{};
  }
  function mount(){
    if(disposed||!themeReady)return;
    const next=identity();if(next!==route){close();route=next;}
    if(!next||navigating){control?.remove();return;}
    const watch=new URL(next).pathname==='/watch';
    const {target,anchor}=watch?{target:document.querySelector('ytd-watch-metadata #owner')}:channelButtonPlacement();
    if(!target){control?.remove();return;}
    if(!control){
      control=document.createElement('span');control.id='ledger-channel-groups-control';const root=control.attachShadow({mode:'open'}),style=document.createElement('style');
      // The preceding native action already supplies the left gap; supply the same gap before Join.
      // This control belongs to YouTube's action row. Inherit its live palette,
      // including custom theme overrides, instead of importing Ledger's colors.
      style.textContent=`
        :host{display:inline-flex!important;align-self:center!important;flex-shrink:0!important;margin:8px!important;color:var(--yt-spec-text-primary,var(--yt-sys-color-baseline--text-primary,inherit));color-scheme:inherit}
        :host([data-channel-header]){margin:0 8px 0 0!important}
        button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;font:500 14px/20px Roboto,Arial,sans-serif;padding:0 16px;border:0;border-radius:18px;background:var(--yt-spec-badge-chip-background,var(--yt-sys-color-baseline--additive-background,#8882));color:inherit;cursor:pointer;white-space:nowrap}
        :host([data-channel-header]) button{height:40px;border-radius:20px}
        button:hover{background:var(--yt-spec-button-chip-background-hover,var(--yt-sys-color-baseline--button-chip-background-hover,#8884))}
        button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      `;
      button=document.createElement('button');button.type='button';button.textContent='Add to group';button.title='Organize this channel in YouTube Ledger';
      button.addEventListener('click',openPicker);root.append(style,button);
    }
    control.toggleAttribute('data-channel-header',!watch);
    if(anchor){if(anchor.nextElementSibling!==control)anchor.after(control);}
    else if(control.parentElement!==target)target.append(control);
  }
  function openPicker(){
    if(disposed)return;close();const current=identity();if(!current)return;
    modal=document.createElement('div');modal.id='ledger-channel-groups-dialog';modal.dataset.ledgerTheme=theme;document.body.append(modal);
    ChannelGroupsUI.picker(modal,current,()=>!disposed&&button.isConnected&&button.focus());
  }
  function navigationStart(){navigating=true;close();control?.remove();}
  function navigationFinish(){navigating=false;mount();}
  document.addEventListener('yt-navigate-start',navigationStart);
  document.addEventListener('yt-navigate-finish',navigationFinish);
  document.addEventListener('DOMContentLoaded',mount,{once:true});
  window.addEventListener('pagehide',close);
  const timer=setInterval(mount,1000);
  function dispose(){
    if(disposed)return;disposed=true;clearInterval(timer);clearKeys();
    for(const type of ['keydown','keypress','keyup'])window.removeEventListener(type,protectKeys,true);
    window.removeEventListener('blur',clearKeys);window.removeEventListener('pagehide',close);
    document.removeEventListener('yt-navigate-start',navigationStart);
    document.removeEventListener('yt-navigate-finish',navigationFinish);
    document.removeEventListener('DOMContentLoaded',mount);document.removeEventListener(disposeEvent,dispose);
    try{browser.storage.onChanged.removeListener(updateSettings);}catch{}
    button?.removeEventListener('click',openPicker);close();control?.remove();
  }
  document.addEventListener(disposeEvent,dispose,{once:true});mount();
})();
