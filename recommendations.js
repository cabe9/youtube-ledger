(() => {
  let shown = false, revealId = null, observed = false, enabled = false, host, button, note;
  let preferences = Ledger.settings();
  let route = location.pathname + location.search;
  const surfaces = 'ytd-browse[page-subtype="home"] ytd-rich-item-renderer, ytd-watch-flexy #related ytd-compact-video-renderer, ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer, .ytp-endscreen-content a, .ytp-ce-element, ytm-browse[tab-identifier="FEwhat_to_watch"] ytm-video-with-context-renderer, ytm-item-section-renderer[section-identifier="related-items"] ytm-video-with-context-renderer';
  browser.storage.local.get(['paused','settings']).then(x => {enabled = !x.paused; applySettings(x.settings);});
  browser.storage.onChanged.addListener(changes => {
    if (changes.paused) enabled = !changes.paused.newValue;
    if (changes.settings) applySettings(changes.settings.newValue);
  });
  function applySettings(value) {
    preferences=Ledger.settings(value);shown=!preferences.hideRecommendations;revealId=null;observed=false;
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
    if (button) {
      button.textContent = shown ? 'Hide recommendations' : 'Show recommendations';
      button.setAttribute('aria-pressed',String(shown));
      setNote(shown ? (preferences.resetOnNavigate ? 'Recommendations shown. Your default is restored on navigation.' : 'Recommendations shown. This choice stays for this tab until reload.') : 'Recommendations hidden');
    }
  }
  function setNote(text) {
    if (note) note.textContent=text;
    if (button) button.title=text;
  }
  function toggle() {
    shown = !shown;
    if (shown) {revealId = crypto.randomUUID(); observed = false; emit('reveal');}
    else {emit('hide');}
    sync();
  }
  function mount() {
    if (!preferences.showHeaderButton) {host?.remove();return;}
    const center = document.querySelector('ytd-masthead #center');
    const search = center?.querySelector('yt-searchbox, ytd-searchbox, #search-form');
    const target = center || document.querySelector('ytd-masthead #start');
    // Wait for the real header. Never fall back to an overlay over the video.
    if (!target) return;
    let anchor = search;
    while (anchor && anchor.parentElement !== target) anchor = anchor.parentElement;
    if (!host) {
      host = document.createElement('div'); host.id='youtube-ledger-control';
      const root=host.attachShadow({mode:'open'});
      const style=document.createElement('style');
      style.textContent=`
        :host{all:initial!important;display:inline-flex!important;position:static!important;
          flex:0 0 auto!important;align-self:center!important;margin:0 12px 0 0!important;
          padding:0!important;width:auto!important;height:36px!important;opacity:1!important;
          visibility:visible!important;transform:none!important;filter:none!important}
        button{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;
          height:36px;padding:0 12px;border:0;border-radius:8px;
          background:transparent;color:#fff;font:700 12px/1 system-ui,sans-serif;
          white-space:nowrap;cursor:pointer;color-scheme:dark}
        button:hover{background:rgba(255,255,255,.10)}
        button:focus-visible{outline:3px solid #fef08a;outline-offset:2px}
        p{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        @media(max-width:850px){button{font-size:11px;padding:0 7px;gap:5px}:host{margin-right:6px!important}}
      `;
      button=document.createElement('button');button.type='button';button.addEventListener('click',toggle);
      note=document.createElement('p');note.id='ledger-recommendations-status';
      button.setAttribute('aria-describedby',note.id);
      root.append(style,button,note);
    }
    if (host.parentElement !== target || (anchor && host.nextSibling !== anchor)) {
      target.insertBefore(host,anchor || target.firstChild);
      sync();
    }
  }
  function navigation() {
    const next=location.pathname+location.search;
    if (next===route) return;
    route=next; resetVisibility();
  }
  function check() {
    navigation(); mount();
    if (shown && revealId && !observed && enabled && document.hasFocus() && document.visibilityState==='visible' && visibleRecommendations()) {
      observed=true;emit('visible');
      setNote('Recommendations detected on screen.');
    } else if (shown && revealId && !observed) {
      setNote('No visible recommendations detected. Another blocker may still be hiding them, or they may be loading/off-screen.');
    }
  }
  // This extension owns its switch, not DF YouTube's internal settings.
  document.addEventListener('yt-navigate-start',resetVisibility);
  document.addEventListener('yt-navigate-finish',navigation);
  document.addEventListener('DOMContentLoaded',mount,{once:true});
  setInterval(check,1000); mount();sync();
})();
