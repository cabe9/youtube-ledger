(() => {
  const disposeEvent='ledger-recommendations-dispose';
  // A reload can leave the old control in the page. Retire any live instance
  // first, then remove orphaned controls from older extension versions.
  document.dispatchEvent(new Event(disposeEvent));
  document.querySelectorAll('#youtube-ledger-control').forEach(node=>node.remove());
  let disposed=false;
  let shown = false, revealId = null, observed = false, enabled = false, host, button, note;
  let preferences = Ledger.settings();
  let route = location.pathname + location.search;
  let destinationHome = null;
  let layoutTarget, layoutSearch, alignmentFrame=0;
  const layoutResize=new ResizeObserver(alignWithSearch);
  const searchChanges=new MutationObserver(scheduleAlignment);
  const surfaces = 'ytd-browse[page-subtype="home"] ytd-rich-item-renderer, ytd-watch-flexy #related ytd-compact-video-renderer, ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer, .ytp-endscreen-content a, .ytp-ce-element, ytm-browse[tab-identifier="FEwhat_to_watch"] ytm-video-with-context-renderer, ytm-item-section-renderer[section-identifier="related-items"] ytm-video-with-context-renderer';
  browser.storage.local.get(['paused','settings']).then(x => {if(disposed)return;enabled = !x.paused; applySettings(x.settings, true);});
  function settingsChanged(changes) {
    if(disposed)return;
    if (changes.paused) enabled = !changes.paused.newValue;
    if (changes.settings) applySettings(changes.settings.newValue);
  }
  browser.storage.onChanged.addListener(settingsChanged);
  function applySettings(value, initial=false) {
    const next=Ledger.settings(value);
    if (initial || next.hideRecommendations !== preferences.hideRecommendations) {
      shown=!next.hideRecommendations;revealId=null;observed=false;
    }
    preferences=next;
    mount();sync();
  }
  function resetVisibility() {
    if (!preferences.resetOnNavigate) return;
    shown=!preferences.hideRecommendations;revealId=null;observed=false;sync();
  }
  function emit(kind) {
    if (!enabled) return;
    const u = new URL(location.href);
    const video = u.searchParams.get('v');
    browser.runtime.sendMessage({type:'recommendation',event:{id:crypto.randomUUID(),revealId,kind,at:Date.now(),page:video ? '/watch?v='+encodeURIComponent(video) : u.pathname}}).catch(console.error);
  }
  function visibleRecommendations() {
    return [...document.querySelectorAll(surfaces)].some(el => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
      for (let node=el; node && node.nodeType===1; node=node.parentElement) {
        const s=getComputedStyle(node);
        if (s.display==='none' || s.visibility==='hidden' || s.opacity==='0') return false;
      }
      return true;
    });
  }
  function sync() {
    document.documentElement?.setAttribute('data-ledger-recommendations',shown ? 'shown' : 'hidden');
    guardHome();
    if (button) {
      const action=shown ? 'Hide recommendations' : 'Show recommendations';
      button.setAttribute('aria-label',action);button.title=action;
      button.setAttribute('aria-pressed',String(shown));
      setNote(shown ? (preferences.resetOnNavigate ? 'Recommendations shown. Your default is restored on navigation.' : 'Recommendations shown. This choice stays for this tab until reload.') : 'Recommendations hidden');
    }
  }
  function setNote(text) {
    if (note) note.textContent=text;
  }
  function toggle() {
    shown = !shown;
    if (shown) {revealId = crypto.randomUUID(); observed = false; emit('reveal');}
    else {emit('hide');}
    sync();
  }
  function alignWithSearch() {
    if (!host?.isConnected || !button) return;
    // Autocomplete can make #center/yt-searchbox hundreds of pixels tall. Align
    // only our button with the input row, keeping its horizontal space in the header.
    // The host stays at the row's top so collapsing suggestions during a click cannot move it.
    const input=layoutSearch?.querySelector('input[name="search_query"], input[role="combobox"], input#search');
    const row=input || layoutSearch?.querySelector('form') || layoutSearch;
    const rowBox=row?.getBoundingClientRect(), hostBox=host.getBoundingClientRect();
    const offset=rowBox?.width && rowBox.height ? rowBox.top+rowBox.height/2-hostBox.top-hostBox.height/2 : 0;
    const top=`${Math.round(offset*100)/100}px`;
    if (button.style.top!==top) button.style.top=top;
    // Use the stable outer input wrapper: the inner input box shifts when search gains focus.
    const edge=layoutSearch?.querySelector('.ytSearchboxComponentInputWrapper') || layoutSearch;
    const edgeBox=edge?.getBoundingClientRect();
    const left=`${Math.round((edgeBox?.width ? Math.max(0,edgeBox.left-hostBox.right-8) : 0)*100)/100}px`;
    if (button.style.left!==left) button.style.left=left;
  }
  function scheduleAlignment() {
    if(disposed)return;
    if (!alignmentFrame) alignmentFrame=requestAnimationFrame(()=>{alignmentFrame=0;alignWithSearch();});
  }
  function watchSearchLayout(target,search) {
    if (target!==layoutTarget || search!==layoutSearch) {
      layoutResize.disconnect();searchChanges.disconnect();
      layoutTarget=target;layoutSearch=search;
      if (target) layoutResize.observe(target);
      if (search) {
        layoutResize.observe(search);
        searchChanges.observe(search,{attributes:true,childList:true,subtree:true});
      }
    }
    alignWithSearch();
  }
  function mount() {
    if(disposed)return;
    if (!preferences.showHeaderButton) {host?.remove();watchSearchLayout(null,null);return;}
    const center = document.querySelector('ytd-masthead #center');
    const search = center?.querySelector('yt-searchbox, ytd-searchbox, #search-form');
    const target = center || document.querySelector('ytd-masthead #start');
    // Wait for the real header. Never fall back to an overlay over the video.
    if (!target) {host?.remove();watchSearchLayout(null,null);return;}
    let anchor = search;
    while (anchor && anchor.parentElement !== target) anchor = anchor.parentElement;
    if (!host) {
      host = document.createElement('div'); host.id='youtube-ledger-control';
      const root=host.attachShadow({mode:'open'});
      const style=document.createElement('style');
      style.textContent=`
        :host{all:initial!important;display:inline-flex!important;position:static!important;
          flex:0 0 auto!important;align-self:flex-start!important;margin:0 8px 0 0!important;
          padding:0!important;width:40px!important;height:40px!important;opacity:1!important;
          visibility:visible!important;transform:none!important;filter:none!important}
        button{all:initial;box-sizing:border-box;display:inline-flex;position:relative;align-items:center;justify-content:center;
          width:40px;height:40px;padding:0;border:0;border-radius:50%;
          background:transparent;color:var(--yt-spec-text-primary,#fff);cursor:pointer}
        button::before{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;pointer-events:none}
        button:hover::before{opacity:.1}
        button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
        svg{display:block;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
        .eye-on{display:none}button[aria-pressed="true"] .eye-on{display:inline}button[aria-pressed="true"] .eye-off{display:none}
        p{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        @media(max-width:850px){:host{margin-right:4px!important}}
      `;
      button=document.createElement('button');button.type='button';button.addEventListener('click',toggle);
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
      icon.innerHTML='<g class="eye-on"><path d="M2.5 12C4.4 7.8 7.8 5.5 12 5.5s7.6 2.3 9.5 6.5c-1.9 4.2-5.3 6.5-9.5 6.5S4.4 16.2 2.5 12Z"/><circle cx="12" cy="12" r="3"/></g><g class="eye-off"><path d="M9.7 5.8c.7-.2 1.5-.3 2.3-.3 4.2 0 7.6 2.3 9.5 6.5a16 16 0 0 1-3.1 4.1M6.1 6.9A16 16 0 0 0 2.5 12c1.9 4.2 5.3 6.5 9.5 6.5 1.7 0 3.3-.4 4.7-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></g>';
      button.append(icon);
      note=document.createElement('p');note.id='ledger-recommendations-status';
      button.setAttribute('aria-describedby',note.id);
      root.append(style,button,note);
    }
    if (host.parentElement !== target || (anchor && host.nextSibling !== anchor)) {
      target.insertBefore(host,anchor || target.firstChild);
      sync();
    }
    watchSearchLayout(target,search);
  }
  function guardHome() {
    // YouTube can show a reused browse element before it assigns page-subtype.
    // Guard its destination early; Ledger's own group feed is a separate div.
    document.documentElement?.toggleAttribute('data-ledger-home',destinationHome ?? location.pathname==='/');
  }
  function navigationStarted(event) {
    const endpoint=event.detail?.endpoint;
    const url=event.detail?.url || endpoint?.commandMetadata?.webCommandMetadata?.url;
    destinationHome=null;
    if (typeof url==='string') {
      try {const target=new URL(url,location.href);if(target.origin===location.origin)destinationHome=target.pathname==='/';}catch{}
    } else if (endpoint?.browseEndpoint?.browseId==='FEwhat_to_watch') destinationHome=true;
    resetVisibility();guardHome();
  }
  function navigation() {
    if(disposed)return;
    const next=location.pathname+location.search;
    if (next!==route) {route=next;destinationHome=null;resetVisibility();}
    guardHome();
  }
  function navigationFinished() {
    destinationHome=null;navigation();
  }
  function check() {
    if(disposed)return;
    navigation(); mount();
    if (shown && revealId && !observed && enabled && document.hasFocus() && document.visibilityState==='visible' && visibleRecommendations()) {
      observed=true;emit('visible');
      setNote('Recommendations detected on screen.');
    } else if (shown && revealId && !observed) {
      setNote('No visible recommendations detected. Another blocker may still be hiding them, or they may be loading/off-screen.');
    }
  }
  // This extension owns its switch, not DF YouTube's internal settings.
  document.addEventListener('yt-navigate-start',navigationStarted,true);
  document.addEventListener('yt-navigate-finish',navigationFinished,true);
  document.addEventListener('yt-page-data-updated',navigation,true);
  window.addEventListener('popstate',navigationFinished,true);
  window.addEventListener('pageshow',navigationFinished);
  // URL updates and cached-page mutations can precede the finish event. Apply
  // the route guard in the same mutation turn, before the next browser paint.
  const pageChanges=new MutationObserver(navigation);
  pageChanges.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['page-subtype','tab-identifier','hidden']});
  document.addEventListener('DOMContentLoaded',mount,{once:true});
  window.addEventListener('resize',scheduleAlignment);
  const timer=setInterval(check,1000);
  function dispose(){
    if(disposed)return;disposed=true;
    clearInterval(timer);cancelAnimationFrame(alignmentFrame);
    layoutResize.disconnect();searchChanges.disconnect();pageChanges.disconnect();
    document.removeEventListener('yt-navigate-start',navigationStarted,true);
    document.removeEventListener('yt-navigate-finish',navigationFinished,true);
    document.removeEventListener('yt-page-data-updated',navigation,true);
    window.removeEventListener('popstate',navigationFinished,true);
    window.removeEventListener('pageshow',navigationFinished);
    document.removeEventListener('DOMContentLoaded',mount);
    document.removeEventListener(disposeEvent,dispose);
    window.removeEventListener('resize',scheduleAlignment);
    // The previous extension context may already be invalidated on reload.
    try{browser.storage.onChanged.removeListener(settingsChanged);}catch{}
    button?.removeEventListener('click',toggle);host?.remove();
  }
  document.addEventListener(disposeEvent,dispose,{once:true});
  mount();sync();
})();
