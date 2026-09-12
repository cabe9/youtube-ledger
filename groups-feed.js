/* Group navigation and a feed owned by Ledger inside YouTube's page area. */
(()=>{
  if(location.hostname!=='www.youtube.com')return;
  const disposeEvent='ledger-group-feed-dispose';
  const feedStyle='ytd-page-manager[data-ledger-group-view] > :not(#ledger-group-feed){display:none!important}';
  document.dispatchEvent(new Event(disposeEvent));
  // Retire live instances before removing orphan nodes from earlier versions.
  document.querySelectorAll('#ledger-groups-sidebar, #ledger-groups-mini, #ledger-group-feed, #ledger-group-icon-dialog, #ledger-group-actions').forEach(node=>{node.shadowRoot?.querySelector('dialog')?.close();node.remove();});
  for(const node of document.querySelectorAll('style'))if(node.id==='ledger-group-view-style'||node.textContent===feedStyle)node.remove();
  document.querySelectorAll('[data-ledger-group-view]').forEach(node=>node.removeAttribute('data-ledger-group-view'));
  let disposed=false;
  let saved={groups:[],channels:{}},theme=Ledger.settings().theme,nav,mini,host,style,active='',generation=0,data,refreshing=false,limit=48,restore=null;
  let navigationGroups,navigationActive,navigationCollapsed,cacheTimer,settingsReady=false,loadedGeneration=-1,lastPath=location.pathname,pendingGroup='',pendingPath='',nativeNavigation=false;
  let initialHash=location.pathname==='/feed/subscriptions'&&/^(?:#ledger-group=|#ledger-groups(?:$|&))/.test(location.hash)?location.hash:'';
  let videoMenu=null,menuRenderPending=false,groupMenu=null;
  let library={version:1,groups:{}},uploads={channels:{}},navigationNew='',query='',visitBoundary,visitAt=0,visitPromise=null,composing=false;
  const memberExpansionWrites=new Map();
  const expandedFilters=new Set();
  const durationCards=new Set(),visibleDurationCards=new Set(),durationPending=new Map(),durationFailures=new Map();
  let durationTimer,metadataRenderTimer,shortsBatch;const durationRequests=new Set();
  const durationObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.isIntersecting&&durationCards.has(entry.target))visibleDurationCards.add(entry.target);else visibleDurationCards.delete(entry.target);}
    scheduleDurations();
  });
  const storageKey='ledger:group-feed-positions';
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const button=(text,fn,attrs={})=>{const node=el('button',text,{type:'button',...attrs});node.addEventListener('click',fn);return node;};
  async function request(message){if(['groupFeed:get','groupFeed:refresh','groupFeed:retryCooldown'].includes(message.type))message={...message,visible:document.visibilityState==='visible'};const result=await browser.runtime.sendMessage(message);if(result?.groupFeedError||result?.channelGroupError)throw new Error(result.groupFeedError||result.channelGroupError);return result;}
  const groupURL=id=>'/feed/subscriptions#ledger-group='+encodeURIComponent(id);
  const channelURL=id=>'https://www.youtube.com/channel/'+id;
  const manage=()=>request({type:'channelGroups:open'}).catch(error=>showError(error.message));
  function route(){if(pendingGroup)return pendingGroup;if(location.pathname!=='/feed/subscriptions')return '';const hash=new URLSearchParams((initialHash||location.hash).slice(1));return hash.get('ledger-group')||(hash.has('ledger-groups')?'overview':'');}
  function readPositions(){try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}');}catch{return {};}}
  function remember(){if(!active||active==='overview'||!host?.isConnected)return;try{sessionStorage.setItem(storageKey,JSON.stringify({...readPositions(),[active]:{top:window.scrollY,limit,query}}));}catch{}}
  function enterSubscriptions(){
    if(!pendingGroup||nativeNavigation)return;
    // The guide's container can arrive before its native links on initial load.
    // Keep showing the selected group until YouTube's subscriptions link is ready.
    const subscriptions=document.querySelector('ytd-guide-renderer a[href="/feed/subscriptions"], ytd-mini-guide-renderer a[href="/feed/subscriptions"]');
    if(subscriptions){nativeNavigation=true;subscriptions.click();}
  }
  function chooseGroup(id){
    const url=id==='overview'?'/feed/subscriptions#ledger-groups':groupURL(id);
    initialHash=url.slice(url.indexOf('#'));
    remember();
    if(pendingGroup){pendingGroup=id;mount();return;}
    if(location.pathname!=='/feed/subscriptions'){
      // Let YouTube perform its native SPA transition (including leaving its player).
      // Keep our feed mounted while that transition fetches/reconciles the page.
      pendingGroup=id;pendingPath=location.pathname+location.search;document.querySelectorAll('video').forEach(video=>video.pause());enterSubscriptions();mount();return;
    }
    // YouTube also handles clicks on these links. Own the hash-only transition
    // so switching groups doesn't reload the entire YouTube document.
    if(location.pathname+location.hash!==url)history.pushState(history.state,'',url);
    mount();
  }
  function groupClick(event){
    if(disposed)return;
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.defaultPrevented)return;
    const path=event.composedPath();if(!path.includes(nav)&&!path.includes(mini)&&!path.includes(host)&&!path.some(node=>node?.id==='ledger-group-queue'))return;
    const link=path.find(node=>node?.tagName==='A'&&node.href);if(!link||link.target==='_blank')return;
    const url=new URL(link.href),hash=new URLSearchParams(url.hash.slice(1));
    if(url.origin!==location.origin||url.pathname!=='/feed/subscriptions'||(!hash.has('ledger-group')&&!hash.has('ledger-groups')))return;
    event.preventDefault();event.stopImmediatePropagation();chooseGroup(hash.get('ledger-group')||'overview');
  }
  function nativeExitIntent(event){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.composedPath().find(n=>n?.tagName==='A'&&n.href);if(!link||link.target==='_blank')return;
    try{const url=new URL(link.href);if(url.origin===location.origin&&(url.pathname!=='/feed/subscriptions'||!/^#ledger-group(?:=|s(?:$|&))/.test(url.hash)))initialHash='';}catch{}
  }
  window.addEventListener('click',nativeExitIntent,true);
  window.addEventListener('click',groupClick,true);
  function styleRoot(element,css){element.dataset.ledgerTheme=theme;const root=element.attachShadow({mode:'open'});root.append(el('style',ChannelGroupsUI.themeCss+LedgerMedia.css+GroupIcons.css+css));return root;}
  const navCss=`
    :host{display:block!important;background:transparent!important;color:var(--yt-spec-text-primary,var(--ink));font:14px/1.4 Roboto,Arial,sans-serif}
    *{box-sizing:border-box}section{padding:12px 8px;border-top:1px solid var(--yt-spec-10-percent-layer,var(--line));border-bottom:1px solid var(--yt-spec-10-percent-layer,var(--line));background:transparent}
    header{display:flex;align-items:center;gap:8px;padding:0 4px 8px;font-weight:600}
    .nav-toggle{display:flex;align-items:center;gap:6px;min-height:36px;padding:6px 8px;white-space:nowrap}
    .nav-toggle svg{width:14px;height:14px;flex-shrink:0}.nav-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
    .nav-header-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0}
    .nav-header-action{display:grid;place-items:center;width:36px;height:36px;padding:8px;border-radius:50%}
    .nav-header-action svg{width:20px;height:20px}header svg{display:block;pointer-events:none}
    a,button{color:inherit;font:inherit}a{text-decoration:none;display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:9px;min-height:40px;overflow-wrap:anywhere}a span{min-width:0}
    button{background:transparent;border:0;cursor:pointer;border-radius:6px;padding:6px}button:hover,.compact:hover,.nav-item:hover{background:#8882}
    a:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:-3px}
    .nav-item{position:relative;display:flex;align-items:center;border-radius:9px}.nav-item>a{flex:1;min-width:0;gap:16px}
    .nav-item:has(a[aria-current=page]){background:#8883;box-shadow:inset 3px 0 currentColor}.nav-item a[aria-current=page]{font-weight:600}
    .group-name{flex:1;min-width:0}
    .nav-options{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:32px;height:32px;padding:4px}
    .nav-options svg{width:24px;height:24px;pointer-events:none;opacity:0}
    .nav-options:hover svg,.nav-options[aria-expanded=true] svg{opacity:1}
    .nav-item:has(.nav-options:hover)>a>.group-icon,.nav-item:has(.nav-options[aria-expanded=true])>a>.group-icon{opacity:0}
    @media(hover:none){.nav-item>a{padding-right:48px}.nav-options{left:auto;right:8px}.nav-options svg{opacity:1}.nav-item>a>.group-icon{opacity:1!important}}
    small{display:block;color:var(--yt-spec-text-secondary,var(--quiet));padding:5px 12px;font-size:12px}
    .compact{padding:16px 3px;display:grid;justify-items:center;gap:9px;border-radius:10px;font-size:10px;background:transparent}
    .compact:hover{background:#8882}.new-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 6px}
  `;
  const feedCss=`:host{display:block!important;box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:none!important;align-self:stretch!important;color:var(--ink)!important;background:var(--page-bg)!important;font:14px/1.45 Roboto,Arial,sans-serif!important;padding:28px 32px!important;min-height:calc(100vh - 64px)!important}*{box-sizing:border-box}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}button,select{font:inherit;color:inherit}button,select{background:var(--group-control-bg);border:1px solid var(--control-border);padding:9px 13px;border-radius:9px}button{cursor:pointer}button:hover{background:var(--control-hover)}button:disabled{opacity:.6;cursor:wait}button:focus-visible,a:focus-visible,summary:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}h1{font-size:28px;line-height:1.2;overflow-wrap:anywhere;margin:0 0 8px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:18px}.heading{min-width:0;flex:1}.group-title{display:flex;align-items:center;gap:12px}.group-title>span:last-child{min-width:0}.directory-label{display:flex;align-items:center;gap:14px;min-width:0}.directory-label>span:last-child{min-width:0}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sort{color:var(--quiet);white-space:nowrap;font-size:13px;margin-right:8px}.status{color:var(--quiet);margin:0 0 20px;font-size:13px}.fallback-note{color:var(--quiet);font-size:12px;margin:0 0 16px}.error{color:var(--danger-ink)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:28px 18px}article{min-width:0}.thumbnail{position:relative;display:block;aspect-ratio:16/9;background:var(--panel);border-radius:12px;overflow:hidden}.thumbnail img{display:block;width:100%;height:100%;object-fit:cover}.video-duration{position:absolute;right:8px;bottom:8px;z-index:1;padding:2px 5px;border-radius:4px;background:#000d;color:#fff;font:600 12px/1.3 Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none}.video-duration.is-live{background:#b90000}.video-title{display:block;margin:10px 0 6px;font-size:16px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}.channel{display:flex;gap:7px;align-items:center;color:var(--quiet);width:fit-content;max-width:100%;overflow-wrap:anywhere}.avatar{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--panel);border:1px solid var(--line);font-size:11px;flex-shrink:0;color:var(--ink)}time{display:block;color:var(--quiet);font-size:12px;margin:4px 0 0 31px}details{margin-bottom:22px}summary{width:fit-content;cursor:pointer;color:var(--quiet)}.group-members summary{min-height:32px;padding:4px 0;color:var(--ink);font-weight:500}.member-count{margin-left:8px;color:var(--quiet);font-weight:400}.members{list-style:none;margin:12px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:2px 16px;background:transparent}.members li{display:grid;align-content:start;gap:4px;min-width:0}.members .channel{width:100%;min-height:44px;padding:2px 8px;gap:10px;border-radius:7px;color:var(--ink);line-height:20px;overflow-wrap:normal}.members .channel:hover{background:var(--control-hover)}.members .ledger-avatar{width:28px;height:28px;flex-basis:28px}.members .channel>span:last-child{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-width:0;overflow:hidden}.members .channel-cadence{font-size:12px;color:var(--quiet);margin:0 8px 4px 46px}.members small{color:var(--danger-ink);margin:0 8px 4px 46px;overflow-wrap:anywhere}.empty{padding:32px 0;color:var(--quiet)}.empty p{max-width:560px}.empty a{color:var(--accent);text-decoration:underline}.more{display:block;margin:28px auto 0}.coverage{margin:30px 0 0;padding-top:15px;border-top:1px solid var(--line);font-size:12px;color:var(--quiet)}.group-directory{display:grid;gap:8px;max-width:480px}.group-directory a{display:flex;justify-content:space-between;gap:15px;background:var(--panel);border:1px solid var(--line);padding:15px;border-radius:10px;overflow-wrap:anywhere}.group-directory small{white-space:nowrap;color:var(--quiet)}.group-switch{display:none;width:min(100%,400px);margin-bottom:8px}:host([data-compact]) .group-switch{display:block}:host([data-compact]) h1{display:none}@media(max-width:700px){:host{padding:20px 16px!important}.grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.actions{width:100%}.sort{margin-right:auto}.video-title{font-size:15px}.group-switch{display:block}h1{display:none}}@media(max-width:380px){.grid{grid-template-columns:minmax(0,1fr)}button{padding:8px 10px}}`;
  const videoMenuCss=`
    .actions [data-focus=refresh]{min-width:calc(12ch + 28px)}
    .shorts-filter{display:flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;padding:9px 5px}.shorts-filter input{margin:0;width:16px;height:16px;accent-color:var(--accent);cursor:pointer}.shorts-filter input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
    .search-group{min-width:120px;width:200px;max-width:100%;font:inherit;color:var(--ink);background:var(--field-bg);border:1px solid var(--control-border);border-radius:9px;padding:9px 12px}.search-group:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.search-group::placeholder{color:var(--quiet)}
    .thumbnail{position:relative}.playback-progress{position:absolute;bottom:0;left:0;right:0;height:3px;background:#0006;pointer-events:none}.playback-progress i{display:block;height:100%;background:var(--accent)}.new-divider{grid-column:1/-1;display:flex;align-items:center;gap:12px;color:var(--quiet);font-size:12px}.new-divider::after{content:'';height:1px;background:var(--line);flex:1}.new-upload{font-size:11px;color:var(--accent);font-weight:600}.play-group{white-space:nowrap}.freshness{font-size:12px;color:var(--quiet);margin:-12px 0 16px}
    .video-heading{display:flex;align-items:flex-start;gap:6px;margin:10px 0 6px}
    .video-heading .video-title{flex:1;min-width:0;margin:0}
    .video-options{display:grid;place-items:center;flex:0 0 28px;width:28px;height:32px;padding:4px;border:0;border-radius:50%;background:transparent;color:var(--quiet)}
    .video-options:hover,.video-options[aria-expanded=true]{background:var(--control-hover);color:var(--ink)}
    .video-options svg{width:20px;height:20px;pointer-events:none}
    .video-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:4px 0 0 31px;color:var(--quiet);font-size:12px}
    .video-meta time{display:inline;margin:0;font:inherit}.watch-badge{font:inherit;color:inherit}.watch-badge::before{content:'·';margin-right:6px}.watch-badge[hidden]{display:none}
    .video-menu{position:fixed;z-index:10000;box-sizing:border-box;width:220px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:6px;border:1px solid var(--control-border);border-radius:12px;background:var(--page-bg);box-shadow:0 8px 28px #0005}
    .video-menu button{display:block;width:100%;min-height:40px;text-align:left;border:0;border-radius:7px;background:transparent;padding:10px 12px;font-size:14px;line-height:1.35}
    .video-menu button:hover,.video-menu button:focus-visible{background:var(--control-hover)}.video-menu .reset-watch{border-top:1px solid var(--line);border-radius:0 0 7px 7px;margin-top:4px}
    .video-menu .menu-error{font-size:12px;color:var(--danger-ink);margin:8px 10px}
  `;
  const headerCss=`
    .feed-header{display:block;margin-bottom:22px}.feed-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
    .feed-heading h1{margin:0}.feed-heading .group-switch{margin:0}.feed-heading .group-switch:focus-visible{outline-offset:1px}
    .group-meta{font-size:13px;color:var(--quiet);margin:8px 0 0}.header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
    .header-actions button{height:40px;display:flex;align-items:center;justify-content:center;gap:8px}.header-actions svg,.browse-tools svg,.refresh-line svg,.active-filters svg{width:16px;height:16px;flex-shrink:0;pointer-events:none}
    .play-controls{display:flex}.play-controls button{background:var(--group-primary-bg);color:var(--button-ink);border-color:var(--accent);font-weight:600}.play-controls button:hover{background:var(--accent-hover)}
    .play-controls .play-group{border-radius:8px 0 0 8px}.play-controls .play-options{border-radius:0 8px 8px 0;border-left-color:currentColor;width:34px;padding:8px}
    .header-actions .group-options{width:40px;padding:8px}.header-actions button:disabled{cursor:default}
    .refresh-line{display:flex;align-items:center;gap:5px;margin-top:10px;min-height:28px;color:var(--quiet)}.refresh-line .freshness{font-size:12px;margin:0}
    .refresh-line button{display:grid;place-items:center;width:30px;height:30px;padding:6px;background:transparent;border:0;color:var(--quiet)}.refresh-line button:hover{background:var(--control-hover)}
    .upload-progress{width:min(420px,100%);margin-top:8px;font-size:12px;color:var(--quiet)}.upload-progress[hidden]{display:none}.upload-progress-label{color:var(--ink);margin:0 0 5px}.upload-progress-note{margin:5px 0 0}.upload-progress progress{display:block;width:100%;height:5px;appearance:none;border:0;border-radius:5px;overflow:hidden;background:var(--line);color:var(--accent)}.upload-progress progress::-webkit-progress-bar{background:var(--line)}.upload-progress progress::-webkit-progress-value{background:var(--accent);border-radius:5px}.upload-progress progress::-moz-progress-bar{background:var(--accent);border-radius:5px}
    .browse-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:18px;margin-top:14px;border-top:1px solid var(--line)}
    .browse-tools .search-group{flex:1;max-width:560px;min-width:min(240px,100%);width:auto}.browse-tools select{max-width:100%}.browse-tools .filter-toggle{display:flex;gap:8px;align-items:center}
    .sort-controls{display:flex;align-items:center;gap:4px;min-width:0}.sort-controls select{min-width:0}.sort-direction{display:grid;place-items:center;width:40px;height:40px;padding:9px;flex-shrink:0}.sort-note,.shorts-note{font-size:12px;color:var(--quiet);margin:10px 0 0}.sort-note:empty,.shorts-note:empty{display:none}.video-stats{font:inherit;color:var(--quiet)}.video-stats::before{content:'·';margin-right:6px}.video-stats[hidden]{display:none}
    .filter-toggle[aria-expanded=true]{background:var(--control-hover)}.filter-count{color:var(--accent)}
    .watch-filters{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}.watch-filters button{border:0;background:transparent;color:var(--quiet);padding:7px 11px}
    .watch-filters button:hover{background:var(--panel)}.watch-filters button[aria-pressed=true]{background:var(--control-hover);color:var(--ink)}
    .extra-filters{background:var(--panel);border-radius:10px;padding:16px;margin-top:14px}.extra-filters[hidden],.active-filters[hidden]{display:none}
    .filter-fields{display:grid;grid-template-columns:repeat(2,minmax(0,240px));gap:14px}.filter-field{display:grid;gap:6px;min-width:0;font-size:12px;color:var(--quiet)}.filter-field select{width:100%;min-width:0;font-size:14px;color:var(--ink)}
    .filter-checks{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:8px}.length-note,.hidden-channels-note{font-size:12px;color:var(--quiet);margin:10px 0 0}
    .hidden-channels{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:6px 18px;margin:12px 0 0;padding:0}
    .hidden-channels li{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}.hidden-channel-name{min-width:0;overflow-wrap:anywhere}.hidden-channels button{font-size:12px;padding:6px 10px;flex-shrink:0}
    .active-filters{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:14px}.filter-chip{display:flex;align-items:center;gap:7px;padding:4px 9px;min-height:29px;font-size:12px;border-radius:6px;color:var(--quiet);background:transparent;max-width:100%;overflow-wrap:anywhere}.filter-chip span{min-width:0;text-align:left}.filter-chip svg{width:13px;height:13px}
    .clear-filters{font-size:12px;color:var(--accent);padding:5px 8px;border:0;background:transparent}.status:empty{display:none}
    .status button{font-size:12px;padding:5px 9px;margin:6px 0 0 8px;color:var(--ink)}
    @media(max-width:700px){.browse-tools .search-group{flex-basis:100%;max-width:none}.header-actions{margin-left:auto}.filter-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:420px){.filter-fields{grid-template-columns:1fr}.feed-heading .heading{flex-basis:100%}.header-actions{margin-left:0}.browse-tools select{flex:1}}
    @media(pointer:coarse){.header-actions button,.watch-filters button,.filter-chip,.refresh-line button,.filter-checks label{min-height:44px}.refresh-line button{width:44px}.browse-tools input{font-size:16px}}
  `;
  function outlineIcon(path){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS(svg.namespaceURI,'path');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    shape.setAttribute('d',path);svg.append(shape);return svg;
  }
  function updateNavigation(){
    if(!nav){
      nav=el('div',undefined,{id:'ledger-groups-sidebar'});styleRoot(nav,navCss);
      mini=el('div',undefined,{id:'ledger-groups-mini'});const root=styleRoot(mini,navCss),link=el('a',undefined,{class:'compact',href:'/feed/subscriptions#ledger-groups'});link.append(GroupIcons.create(),el('span','Groups'));root.append(link);
    }
    const counts=Object.fromEntries(saved.groups.map(g=>[g.id,g.id===active?0:FeedLibrary.newCount(g.channelIds.flatMap(id=>uploads.channels?.[id]?.entries||[]),library.groups[g.id])]));
    const newSignature=JSON.stringify(counts);
    if(navigationGroups!==saved.groups||navigationActive!==active||navigationCollapsed!==saved.collapsed||navigationNew!==newSignature){
      navigationNew=newSignature;
      navigationGroups=saved.groups;navigationActive=active;navigationCollapsed=saved.collapsed;
      const section=el('section',undefined,{'aria-label':'Ledger groups'}),header=el('header');
      const toggle=button('',()=>request({type:'channelGroups:change',action:'collapse',collapsed:!saved.collapsed}).catch(e=>showError(e.message)),{class:'nav-toggle','aria-expanded':String(!saved.collapsed),'aria-label':'Toggle groups'});
      toggle.append(outlineIcon('m9 5 7 7-7 7'),el('span','Groups'));
      const actions=el('div',undefined,{class:'nav-header-actions'}),add=button('',()=>ChannelGroupsUI.bulk(undefined,theme),{class:'nav-header-action','aria-label':'Add multiple channels',title:'Add multiple channels'}),settings=button('',manage,{class:'nav-header-action','aria-label':'Manage groups',title:'Manage groups'});
      add.append(outlineIcon('M12 5v14M5 12h14'));
      settings.append(outlineIcon('m9 3-.5 2-1.4.8L5 5.2 2 10l1.5 1.4v1.2L2 14l3 4.8 2.1-.6 1.4.8.5 2h6l.5-2 1.4-.8 2.1.6 3-4.8-1.5-1.4v-1.2L22 10l-3-4.8-2.1.6-1.4-.8L15 3H9Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'));
      actions.append(add,settings);header.append(toggle,actions);section.append(header);
      for(const group of saved.collapsed?[]:saved.groups){
        const row=el('div',undefined,{class:'nav-item','data-group-id':group.id}),link=el('a',undefined,{href:groupURL(group.id)});if(group.id===active)link.setAttribute('aria-current','page');link.append(GroupIcons.create(group.icon),el('span',group.name,{class:'group-name'}));if(counts[group.id]){link.append(el('span','',{class:'new-dot','aria-hidden':'true'}));link.title=counts[group.id]+' new uploads available since your last visit';}
        const menu=button('',()=>openGroupMenu(group,menu),{class:'nav-options','aria-label':'Options for '+group.name,title:'Group options','aria-haspopup':'menu','aria-expanded':'false'});
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
        for(const cx of [5,12,19]){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy','12');dot.setAttribute('r','1.8');dot.setAttribute('fill','currentColor');svg.append(dot);}menu.append(svg);row.append(link,menu);section.append(row);
      }
      if(!saved.groups.length)section.append(el('small','Organize channels into groups.'),button('Create a group',manage));
      // A save reply can restore focus before its storage event replaces this row.
      const focusedOptions=nav.shadowRoot.activeElement;
      const focusedGroup=groupMenu?.groupId||(focusedOptions?.matches('.nav-options')?focusedOptions.closest('.nav-item')?.dataset.groupId:null);closeGroupMenu(false);
      nav.shadowRoot.querySelector('section')?.remove();nav.shadowRoot.append(section);
      if(focusedGroup)focusGroupOptions(focusedGroup);
    }
    nav.dataset.ledgerTheme=mini.dataset.ledgerTheme=theme;if(groupMenu)groupMenu.host.dataset.ledgerTheme=theme;
    const guide=document.querySelector('ytd-guide-renderer #sections');
    if(guide){
      const subscribed=[...guide.querySelectorAll('ytd-guide-entry-renderer a[href]')].find(a=>/^\/(?:channel\/UC|@)/.test(a.getAttribute('href')))?.closest('ytd-guide-section-renderer');
      const anchor=subscribed&&subscribed.parentElement===guide?subscribed:null;
      if(anchor){if(anchor.previousElementSibling!==nav)anchor.before(nav);}else if(nav.parentElement!==guide)guide.append(nav);
    }
    const small=document.querySelector('ytd-mini-guide-renderer #items');if(small&&mini.parentElement!==small)small.append(mini);
  }
  function focusGroupOptions(id){[...nav.shadowRoot.querySelectorAll('.nav-item')].find(row=>row.dataset.groupId===id)?.querySelector('.nav-options')?.focus({preventScroll:true});}
  function closeGroupMenu(returnFocus=true){
    if(!groupMenu)return;const opened=groupMenu;groupMenu=null;cancelAnimationFrame(opened.frame);opened.trigger.setAttribute('aria-expanded','false');opened.host.remove();if(returnFocus)focusGroupOptions(opened.groupId);
  }
  function openGroupMenu(group,trigger){
    if(groupMenu?.trigger===trigger){closeGroupMenu();return;}closeGroupMenu(false);closeVideoMenu(false);
    // Mount outside YouTube's scrolling guide so the menu is not clipped by it.
    const menuHost=el('div',undefined,{id:'ledger-group-actions'}),root=styleRoot(menuHost,`
      :host{position:fixed!important;inset:0!important;z-index:2200!important;pointer-events:none!important;font:14px/1.4 Roboto,Arial,sans-serif;color:var(--yt-spec-text-primary,var(--ink))}
      *{box-sizing:border-box}.group-menu{position:absolute;pointer-events:auto;width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:6px;border:1px solid var(--yt-spec-10-percent-layer,var(--line));border-radius:12px;background:var(--yt-spec-menu-background,var(--page-bg));box-shadow:0 8px 28px #0005}
      button{display:block;width:100%;min-height:40px;padding:10px 12px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}button:hover,button:focus-visible{background:#8883}button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
    `),panel=el('div',undefined,{class:'group-menu',role:'menu','aria-label':'Options for '+group.name});
    const focus=()=>focusGroupOptions(group.id),item=(label,action)=>button(label,()=>{closeGroupMenu();action();},{role:'menuitem',tabindex:'-1'});
    panel.append(item('Edit icon',()=>ChannelGroupsUI.editIcon(group,theme,focus)),item('Manage group',()=>ChannelGroupsUI.manageGroup(group,theme,focus)),item('Share group',()=>ChannelGroupsUI.shareGroup(group.id,theme,focus)));
    root.append(panel);document.body.append(menuHost);groupMenu={host:menuHost,panel,trigger,groupId:group.id};trigger.setAttribute('aria-expanded','true');
    positionGroupMenu();panel.querySelector('button').focus({preventScroll:true});
  }
  function positionGroupMenu(){
    if(!groupMenu)return;const {trigger,panel}=groupMenu,box=trigger.getBoundingClientRect(),rect=panel.getBoundingClientRect();
    if(!trigger.isConnected||!box.width||!box.height||box.right<=0||box.left>=innerWidth||box.bottom<=0||box.top>=innerHeight){closeGroupMenu(false);return;}
    panel.style.left=Math.max(8,Math.min(box.left,innerWidth-rect.width-8))+'px';panel.style.top=Math.max(8,Math.min(box.bottom+4+rect.height<=innerHeight-8?box.bottom+4:box.top-rect.height-4,innerHeight-rect.height-8))+'px';
    // YouTube can finish laying out the guide after this menu opens.
    groupMenu.frame=requestAnimationFrame(positionGroupMenu);
  }
  function groupMenuKey(event){
    if(event.type!=='keydown'||event.isComposing)return false;
    if(!groupMenu){const trigger=event.composedPath().find(node=>node?.classList?.contains('nav-options'));if(!trigger||!['ArrowDown','ArrowUp'].includes(event.key))return false;const group=saved.groups.find(g=>g.id===trigger.closest('.nav-item').dataset.groupId);if(!group)return false;openGroupMenu(group,trigger);if(event.key==='ArrowUp')groupMenu.panel.lastElementChild.focus({preventScroll:true});return true;}
    if(event.key==='Escape'){closeGroupMenu();return true;}if(event.key==='Tab'){closeGroupMenu();return false;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return false;
    const items=[...groupMenu.panel.querySelectorAll('button')],current=items.indexOf(groupMenu.host.shadowRoot.activeElement),index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[index]?.focus({preventScroll:true});return true;
  }
  globalThis.LedgerGroupMenuKeyboard=groupMenuKey;
  function dismissGroupMenu(event){if(groupMenu&&!event.composedPath().includes(groupMenu.panel)&&!event.composedPath().includes(groupMenu.trigger))closeGroupMenu(false);}
  function leaveGroupMenu(){closeGroupMenu(false);}
  window.addEventListener('pointerdown',dismissGroupMenu,true);window.addEventListener('focusin',dismissGroupMenu,true);window.addEventListener('scroll',dismissGroupMenu,true);window.addEventListener('resize',leaveGroupMenu);
  function mount(){
    if(disposed||!settingsReady)return;
    // YouTube can canonicalize its URL more than once during initial hydration.
    // Keep our selected route until an actual link or history navigation leaves it.
    if(initialHash&&location.pathname==='/feed/subscriptions'&&!location.hash&&!pendingGroup)history.replaceState(history.state,'',location.pathname+location.search+initialHash);
    const next=route();
    if(next!==active){if(active)request({type:'groupFeed:leave'}).catch(()=>{});clearDurationCards();closeVideoMenu(false,false);remember();generation++;active=next;data=null;refreshing=false;restore=readPositions()[active]||null;limit=restore?.limit||48;query=restore?.query||'';visitBoundary=undefined;visitAt=0;visitPromise=null;composing=false;}
    updateNavigation();
    const manager=document.querySelector('ytd-page-manager');
    if(!active){host?.remove();document.querySelectorAll('[data-ledger-group-view]').forEach(n=>n.removeAttribute('data-ledger-group-view'));return;}
    if(!manager)return;
    if(!style){style=el('style',feedStyle,{id:'ledger-group-view-style'});document.documentElement.append(style);}
    manager.setAttribute('data-ledger-group-view','');
    if(!host){host=el('div',undefined,{id:'ledger-group-feed'});styleRoot(host,feedCss+videoMenuCss+headerCss);}
    const mounted=host.parentElement!==manager;if(mounted)manager.append(host);
    host.dataset.ledgerTheme=theme;
    const navBox=nav.getBoundingClientRect();host.toggleAttribute('data-compact',!navBox.width||!navBox.height||navBox.right<=0||navBox.left>=innerWidth);
    if(host.dataset.group!==active){host.dataset.group=active;render();}
    if(active!=='overview'&&loadedGeneration!==generation){loadedGeneration=generation;load(true);}
    enterSubscriptions();
  }
  function channelLink(channel){const link=LedgerMedia.channelLink(channel);link.classList.add('channel');link.removeAttribute('target');return link;}
  function showError(message){const status=host?.shadowRoot.querySelector('[role=status]');if(status){status.textContent=message;status.classList.add('error');}}
  function clearDurationCards(){shortsBatch=null;durationObserver.disconnect();durationCards.clear();visibleDurationCards.clear();clearTimeout(durationTimer);}
  function observeDurations(){
    const cards=new Set(host?.shadowRoot.querySelectorAll('article[data-video-id]')||[]);
    for(const card of durationCards)if(!cards.has(card)){durationObserver.unobserve(card);durationCards.delete(card);visibleDurationCards.delete(card);}
    for(const card of cards)if(!durationCards.has(card)){durationCards.add(card);durationObserver.observe(card);}
    scheduleDurations();
  }
  function updateDuration(card){
    const id=card.dataset.videoId,entry=data?.entries.find(v=>v.videoId===id),details=entry?.details;
    const length=Ledger.videoLength(details?.duration)||Ledger.videoLength(data?.progress?.videos?.[id]?.duration);
    let text=length,title=length?'Video length: '+length:'';
    if(details?.status==='live'){text='Live';title='Live now';}
    else if(details?.status==='upcoming'){text='Upcoming';title='Scheduled video';}
    else if(!length){const unavailable=details?.status==='unavailable'||durationFailures.has(id);text=unavailable?'—':'…';title=unavailable?'Video length unavailable':'Loading video length';}
    let badge=card.querySelector('.video-duration');
    if(!badge){badge=el('span',undefined,{class:'video-duration',id:'ledger-duration-'+id});const thumbnail=card.querySelector('.thumbnail');thumbnail.append(badge);thumbnail.setAttribute('aria-describedby',badge.id);}
    badge.textContent=text;badge.title=title;badge.classList.toggle('is-live',details?.status==='live');
  }
  function scheduleDurations(){clearTimeout(durationTimer);if(!disposed)durationTimer=setTimeout(loadDurations,100);}
  function shortsCandidates(group,byId,now){
    if(!group?.hideShorts)return [];
    // Read current positions rather than the observer's insertion order. The first
    // visible row wins, then the next screenful, regardless of background sorting.
    return [...durationCards].filter(card=>card.isConnected).map(card=>({card,box:card.getBoundingClientRect()}))
      .filter(({box})=>box.bottom>0&&box.top<innerHeight*1.75)
      .sort((a,b)=>a.box.top-b.box.top||a.box.left-b.box.left).map(({card})=>card.dataset.videoId)
      .filter(id=>typeof byId.get(id)?.details?.shorts!=='boolean'&&Ledger.videoDetailsDue(byId.get(id)?.details,now,true)&&now-(durationFailures.get(id)||0)>60000);
  }
  function finishShortsBatch(){
    if(!shortsBatch)return;
    const group=saved.groups.find(g=>g.id===active),byId=new Map((data?.entries||[]).map(e=>[e.videoId,e])),now=Date.now();
    if(shortsBatch.groupId!==active||!group?.hideShorts){shortsBatch=null;return;}
    for(const id of shortsBatch.ids){const card=host?.shadowRoot.querySelector('article[data-video-id="'+id+'"]'),box=card?.getBoundingClientRect();if(!box||box.bottom<=0||box.top>=innerHeight*1.75)shortsBatch.ids.delete(id);}
    if([...shortsBatch.ids].every(id=>!byId.has(id)||!Ledger.videoDetailsDue(byId.get(id).details,now,true)||now-(durationFailures.get(id)||0)<=60000))shortsBatch=null;
  }
  async function loadDurations(){
    if(disposed||!data||!active||active==='overview'||document.visibilityState!=='visible'||data.pausedUntil>Date.now())return;
    finishShortsBatch();
    const group=saved.groups.find(g=>g.id===active),metric=Ledger.groupSort(group?.sort).metric,now=Date.now(),byId=new Map(data.entries.map(e=>[e.videoId,e]));
    const candidates=shortsCandidates(group,byId,now);
    if(!shortsBatch&&candidates.length)shortsBatch={groupId:active,ids:new Set(candidates.slice(0,8)),requested:new Set()};
    const shortsFirst=!!shortsBatch,requests=[...durationRequests].filter(request=>request.groupId===active&&request.shortsFirst===shortsFirst);
    if(requests.length>=2)return;
    const visibleIds=[...visibleDurationCards].filter(card=>card.isConnected).map(card=>card.dataset.videoId).filter(id=>Ledger.videoDetailsDue(byId.get(id)?.details,now,group?.hideShorts===true)||Ledger.videoViewsDue(byId.get(id),now));
    // Fill missing counts across the matching feed first, once nearby Shorts are
    // checked. Keep already known offscreen counts available without refetching.
    const missing=metric==='date'?[]:visibleEntries(group).filter(entry=>['views','rate'].includes(metric)?!Ledger.validVideoViews(entry.views)&&Ledger.videoViewsDue(entry,now):FeedLibrary.metric(entry,data.progress,'length')===undefined&&Ledger.videoDetailsDue(entry.details,now,group?.hideShorts===true)).map(e=>e.videoId);
    const missingVisible=visibleIds.filter(id=>!Ledger.validVideoViews(byId.get(id)?.views));
    const ids=(shortsFirst?[...shortsBatch.ids].filter(id=>!shortsBatch.requested.has(id)&&Ledger.videoDetailsDue(byId.get(id)?.details,now,true)):[...new Set([...missingVisible,...missing,...visibleIds])].filter(id=>!durationPending.has(id)))
      .filter(id=>now-(durationFailures.get(id)||0)>60000).slice(0,4);
    if(!ids.length){updateShortsStatus();return;}
    const batch=shortsBatch,current={groupId:active,shortsFirst,views:!shortsFirst&&ids.some(id=>Ledger.videoViewsDue(byId.get(id),now))};
    durationRequests.add(current);ids.forEach(id=>{durationPending.set(id,(durationPending.get(id)||0)+1);if(shortsFirst)batch.requested.add(id);});
    updateSortStatus();updateShortsStatus();scheduleDurations();
    try{
      const result=await request({type:'groupFeed:details',groupId:current.groupId,videoIds:ids,visibleVideoIds:shortsFirst?ids:ids.filter(id=>visibleIds.includes(id)),checkViews:!shortsFirst,shortsFirst});
      for(const id of ids){const details=result?.details?.[id],entry=data?.entries.find(v=>v.videoId===id);if(Ledger.validVideoDetails(details)){if(entry)entry.details=details;durationFailures.delete(id);}else durationFailures.set(id,Date.now());if(entry&&Ledger.validVideoViews(result?.views?.[id]))entry.views=result.views[id];}
    }catch{ids.forEach(id=>durationFailures.set(id,Date.now()));}
    finally{
      ids.forEach(id=>{const remaining=(durationPending.get(id)||1)-1;remaining?durationPending.set(id,remaining):durationPending.delete(id);if(shortsFirst)batch.requested.delete(id);});durationRequests.delete(current);
      if(!disposed){finishShortsBatch();updateMetadataView();scheduleDurations();}
    }
  }
  function displayEntries(group){
    finishShortsBatch();
    // Hold newly identified Shorts until this small nearby batch settles. Queue
    // actions still use the latest classifications, independently of presentation.
    const entries=shortsBatch?data.entries.map(entry=>shortsBatch.ids.has(entry.videoId)&&entry.details?.shorts===true?{...entry,details:{...entry.details,shorts:undefined}}:entry):data?.entries||[];
    return FeedLibrary.visible(entries,data?.progress,{uploadedFilter:'week',...library.groups[active]},{filter:group?.watchFilter||'all',sort:group?.sort||'newest',hideShorts:group?.hideShorts===true,query,visitBoundary});
  }
  function updateShortsStatus(){
    const node=host?.shadowRoot.querySelector('.shorts-note');if(node)node.textContent=shortsBatch?.groupId===active?'Checking nearby videos for Shorts…':'';
  }
  function updateMetadataView(){
    const group=saved.groups.find(g=>g.id===active),grid=host?.shadowRoot.querySelector('.grid');
    const metadataSort=Ledger.groupSort(group?.sort).metric!=='date';
    finishShortsBatch();updateSortStatus();updateShortsStatus();
    if((group?.hideShorts||metadataSort||library.groups[active]?.lengthFilter&&library.groups[active].lengthFilter!=='all')&&data&&grid){
      const shown=[...grid.querySelectorAll('article')].map(card=>card.dataset.videoId).join(',');
      const wanted=displayEntries(group).slice(0,limit).map(entry=>entry.videoId).join(',');
      // Reconcile only if classification changes the visible list. Other thumbnails stay attached.
      if(shown!==wanted){render();return;}
    }
    for(const card of durationCards){updateDuration(card);updateViews(card);}
  }
  function uploadView(cache){
    return JSON.stringify((saved.groups.find(g=>g.id===active)?.channelIds||[]).map(id=>{
      const c=cache.channels?.[id];return c?{...c,entries:c.entries?.map(({details,views,...entry})=>entry)}:null;
    }));
  }
  function updateCard(card){
    const value=data?.progress?.videos?.[card.dataset.videoId],state=WatchStatus.state(value),badge=card.querySelector('.watch-badge');
    if(badge){badge.hidden=state==='unwatched';badge.textContent=state==='watched'?'Watched':'Started';badge.title=value?.manual?'Marked manually':'Based on recorded playback';}
    let progress=card.querySelector('.playback-progress');const fraction=WatchStatus.fraction(value);
    if(fraction>0){if(!progress){progress=el('span',undefined,{class:'playback-progress'});progress.append(el('i'));card.querySelector('.thumbnail').append(progress);}progress.firstChild.style.width=(fraction*100)+'%';progress.setAttribute('aria-label',Math.round(fraction*100)+'% recorded playback');}else progress?.remove();
    const fresh=card.querySelector('.new-upload');if(fresh)fresh.hidden=!(visitBoundary&&Number(card.dataset.publishedAt)>visitBoundary&&Number(card.dataset.publishedAt)<=Date.now());
    const time=card.querySelector('time');if(time){
      const estimated=data?.entries.find(e=>e.videoId===card.dataset.videoId)?.publishedAtEstimated===true;
      time.textContent=(estimated?'~':'')+Ledger.relativeTime(Number(card.dataset.publishedAt));
      time.title=(estimated?'Approximate upload time from YouTube’s rounded age: ':'')+new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(Number(card.dataset.publishedAt)));
    }
    updateDuration(card);
    updateViews(card);
  }
  function updateViews(card){
    const group=saved.groups.find(g=>g.id===active),kind=Ledger.groupSort(group?.sort).metric,entry=data?.entries.find(e=>e.videoId===card.dataset.videoId);
    let label=card.querySelector('.video-stats');if(!entry){if(label)label.hidden=true;return;}
    if(!label){label=el('span',undefined,{class:'video-stats'});card.querySelector('.video-meta time').after(label);}label.hidden=false;
    const count=FeedLibrary.metric(entry,data.progress,'views'),rate=FeedLibrary.metric(entry,data.progress,'rate'),format=new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1});
    label.textContent=(count===undefined?'—':(entry.views?.approximate?'~':'')+format.format(count))+' views'+(kind==='rate'?' · '+(rate===undefined?'—':(entry.views?.approximate||entry.publishedAtEstimated?'~':'')+(rate>0&&rate<1?'<1':format.format(rate)))+' views/hour':'');
    label.title=Ledger.validVideoViews(entry.views)?(entry.views.approximate?'Approximate count from YouTube’s rounded label: ':'')+entry.views.count.toLocaleString()+' views · checked '+new Date(entry.views.checkedAt).toLocaleString()+(kind==='rate'?'. Average from upload until that check; not current viewing activity.'+(entry.publishedAtEstimated?' Upload time is approximate.':''):''):'View count unavailable. Unknown values sort last.';
  }
  function updateSortStatus(){
    const note=host?.shadowRoot.querySelector('.sort-note'),group=saved.groups.find(g=>g.id===active);if(!note||!group)return;
    const kind=Ledger.groupSort(group.sort).metric;if(kind==='date'){note.textContent='';return;}
    const entries=visibleEntries(group),known=entries.filter(e=>FeedLibrary.metric(e,data?.progress,kind)!==undefined).length;
    note.textContent=(kind==='rate'?'Average views per hour since upload, measured at the last count check. ':'')+(known<entries.length?known+' of '+entries.length+' '+(kind==='length'?'lengths':'view counts')+' available. Unknown values sort last. ':'')+([...durationRequests].some(request=>request.groupId===active&&(kind==='length'||request.views))?(kind==='length'?'Loading video lengths…':'Updating view counts…'):'');
  }
  function closeVideoMenu(returnFocus=true,flush=true){
    const opened=videoMenu;if(!opened)return;videoMenu=null;opened.trigger.setAttribute('aria-expanded','false');opened.trigger.removeAttribute('aria-controls');opened.panel.remove();
    if(returnFocus&&opened.trigger.isConnected)opened.trigger.focus({preventScroll:true});
    const pending=menuRenderPending;menuRenderPending=false;if(flush&&pending)setTimeout(render,0);
  }
  function positionVideoMenu(){
    if(!videoMenu)return;
    const {trigger,panel}=videoMenu,box=trigger.getBoundingClientRect(),rect=panel.getBoundingClientRect();
    panel.style.left=Math.max(8,Math.min(box.right-rect.width,innerWidth-rect.width-8))+'px';
    panel.style.top=Math.max(8,Math.min(box.bottom+4+rect.height<=innerHeight-8?box.bottom+4:box.top-rect.height-4,innerHeight-rect.height-8))+'px';
  }
  function openVideoMenu(card,trigger){
    if(videoMenu?.trigger===trigger){closeVideoMenu();return;}closeVideoMenu(false);
    const videoId=card.dataset.videoId,value=data?.progress?.videos?.[videoId],state=WatchStatus.state(value),panel=el('div',undefined,{class:'video-menu',id:'ledger-video-menu',role:'menu','aria-label':'Watch options'});
    const opened={videoId,trigger,panel};videoMenu=opened;trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',panel.id);
    async function save(status){
      for(const item of panel.querySelectorAll('button'))item.disabled=true;
      try{const result=await request({type:'watchStatus:set',videoId,status});if(videoMenu===opened)closeVideoMenu();LedgerUndoUI.show(host.shadowRoot,status==='recorded'?'Using recorded playback.':'Marked '+status+'.',result.undoToken);}
      catch(error){if(videoMenu!==opened)return;let note=panel.querySelector('.menu-error');if(!note){note=el('p','',{class:'menu-error',role:'alert'});panel.append(note);}note.textContent=error.message;positionVideoMenu();}
      finally{for(const item of panel.querySelectorAll('button'))item.disabled=false;}
    }
    const choice=(label,status,attrs={})=>button(label,()=>save(status),{role:'menuitem',tabindex:'-1',...attrs});
    panel.append(choice(state==='watched'?'Mark unwatched':'Mark watched',state==='watched'?'unwatched':'watched'));
    if(state==='started')panel.append(choice('Mark unwatched','unwatched'));
    if(value?.manual)panel.append(choice('Use recorded playback','recorded',{class:'reset-watch'}));
    const resume=WatchStatus.resume(value);
    if(resume)panel.append(button('Resume at '+playhead(resume),()=>playGroup(videoId,resume),{role:'menuitem',tabindex:'-1'}));
    const groupId=active,hidden=library.groups[groupId]?.hidden?.includes(videoId);
    panel.append(button(hidden?'Restore to feed':'Hide from this group',async()=>{
      for(const item of panel.querySelectorAll('button'))item.disabled=true;
      try{const result=await request({type:'feedLibrary:hide',groupId,videoId,hidden:!hidden});if(videoMenu===opened)closeVideoMenu();LedgerUndoUI.show(host.shadowRoot,hidden?'Video restored.':'Video hidden from this group.',result.undoToken);}
      catch(error){if(videoMenu===opened){panel.append(el('p',error.message,{class:'menu-error',role:'alert'}));positionVideoMenu();}}finally{for(const item of panel.querySelectorAll('button'))item.disabled=false;}
    },{role:'menuitem',tabindex:'-1'}));
    const entry=data?.entries.find(v=>v.videoId===videoId),channelHidden=library.groups[groupId]?.hiddenChannels?.includes(entry?.channelId);
    if(entry)panel.append(button(channelHidden?'Restore channel to this group':'Hide this channel',async()=>{
      for(const item of panel.querySelectorAll('button'))item.disabled=true;
      try{await hideChannel(groupId,entry.channelId,!channelHidden);if(videoMenu===opened)closeVideoMenu();}
      catch(error){if(videoMenu===opened){panel.append(el('p',error.message,{class:'menu-error',role:'alert'}));positionVideoMenu();}}
      finally{for(const item of panel.querySelectorAll('button'))item.disabled=false;}
    },{role:'menuitem',tabindex:'-1',title:(channelHidden?'Restore ':'Hide ')+(entry.channel||'this channel')+' in this group only'}));
    host.shadowRoot.append(panel);positionVideoMenu();panel.querySelector('button').focus({preventScroll:true});
  }
  function videoMenuKey(event){
    if(event.type!=='keydown'||event.isComposing)return false;
    if(!videoMenu){const trigger=event.composedPath().find(node=>node?.matches?.('.video-options,.feed-menu-trigger'));if(!trigger||!['ArrowDown','ArrowUp'].includes(event.key))return false;if(trigger.classList.contains('video-options'))openVideoMenu(trigger.closest('article'),trigger);else trigger.click();if(event.key==='ArrowUp')videoMenu?.panel.querySelector('button:last-of-type')?.focus({preventScroll:true});return true;}
    if(event.key==='Escape'){closeVideoMenu();return true;}
    if(event.key==='Tab'){closeVideoMenu();return false;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return false;
    const items=[...videoMenu.panel.querySelectorAll('button:not(:disabled)')],current=items.indexOf(host.shadowRoot.activeElement);
    const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[index]?.focus({preventScroll:true});return true;
  }
  // The document-start shortcut shield forwards menu keys before stopping YouTube's handlers.
  globalThis.LedgerFeedKeyboard=videoMenuKey;
  function dismissVideoMenu(event){if(videoMenu&&!event.composedPath().includes(videoMenu.panel)&&!event.composedPath().includes(videoMenu.trigger))closeVideoMenu(false);}
  function leaveVideoMenu(){closeVideoMenu(false);}
  window.addEventListener('pointerdown',dismissVideoMenu,true);window.addEventListener('focusin',dismissVideoMenu,true);
  window.addEventListener('scroll',dismissVideoMenu,true);window.addEventListener('resize',leaveVideoMenu);
  const playhead=seconds=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  function visibleEntries(group){return FeedLibrary.visible(data?.entries||[],data?.progress,{uploadedFilter:'week',...library.groups[active]},{filter:group?.watchFilter||'all',sort:group?.sort||'newest',hideShorts:group?.hideShorts===true,query,visitBoundary});}
  function prepareQueue(videoId,shuffle=false){
    const group=saved.groups.find(g=>g.id===active),visible=shuffle?FeedLibrary.shuffle(visibleEntries(group)):visibleEntries(group);
    if(!group||group.watchFilter==='hidden'||!visible.length)return null;
    const index=videoId?visible.findIndex(entry=>entry.videoId===videoId):0;if(index<0)return null;
    // A large feed uses blocks of 500 so even a card beyond the first block can
    // start a queue. Earlier items in that block remain available via Previous.
    const offset=Math.floor(index/500)*500,videoIds=visible.slice(offset,offset+500).map(entry=>entry.videoId);
    const token=crypto.randomUUID(),step=crypto.randomUUID(),startVideoId=visible[index].videoId;
    const url='https://www.youtube.com/watch?v='+startVideoId+'#ledger-queue='+token+'&ledger-step='+step;
    return {url,ready:request({type:'groupQueue:create',groupId:active,videoIds,startVideoId,token,step})};
  }
  async function playGroup(videoId,position,shuffle=false){
    try{
      const prepared=prepareQueue(typeof videoId==='string'?videoId:undefined,shuffle);
      // Hidden videos can still be opened individually from their management view.
      let url;if(prepared)url=(await prepared.ready).url;
      else if(typeof videoId==='string')url='https://www.youtube.com/watch?v='+videoId+'#ledger-launch='+encodeURIComponent(data.launchToken);
      else return;
      const target=new URL(url);if(position)target.searchParams.set('t',position+'s');remember();location.assign(target.href);
    }catch(error){showError(error.message);}
  }
  function queueVideoClick(event){
    if(disposed||event.defaultPrevented||event.type==='click'&&event.button!==0||event.type==='auxclick'&&event.button!==1)return;
    const path=event.composedPath();if(!path.includes(host))return;
    const link=path.find(node=>node?.matches?.('a.thumbnail,a.video-title'));if(!link)return;
    const videoId=link.closest('article')?.dataset.videoId;
    if(event.type==='click'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&link.target!=='_blank'){
      event.preventDefault();event.stopImmediatePropagation();playGroup(videoId);return;
    }
    // Keep the browser's normal modified-click, middle-click and context menu.
    // The background serializes queue creation ahead of destination lookups.
    const prepared=prepareQueue(videoId);if(!prepared)return;link.href=prepared.url;
    prepared.ready.catch(error=>showError(error.message));remember();
  }
  for(const type of ['click','auxclick','contextmenu'])window.addEventListener(type,queueVideoClick,true);
  function updateTimes(){for(const card of host?.shadowRoot.querySelectorAll('article')||[])updateCard(card);updateFreshness();updateNavigation();if(data?.pausedUntil&&data.pausedUntil<=Date.now()&&!refreshing)load();}
  function updateFreshness(){const node=host?.shadowRoot.querySelector('.freshness');if(!node)return;const checked=(data?.channels||[]).filter(c=>c.fetchedAt).map(c=>c.fetchedAt);node.textContent=refreshing||data?.refresh?.running?'Checking uploads…':checked.length?'Uploads checked '+Ledger.relativeTime(Math.min(...checked)).toLocaleLowerCase():'Uploads not checked yet';node.title=checked.length?'Oldest successful channel refresh: '+new Date(Math.min(...checked)).toLocaleString():'';updateRefreshProgress();}
  function updateRefreshProgress(){
    const node=host?.shadowRoot.querySelector('.upload-progress');if(!node)return;
    const state=data?.refresh;node.hidden=!state?.total;if(node.hidden)return;
    const caption=state.checked+' of '+state.total+' '+(state.failedOnly?'failed channels':'channels')+' checked';
    const notes=[...(state.refreshed?[state.refreshed+' refreshed']:[]),...(state.cached?[state.cached+' already cached']:[]),...(state.failed?[state.failed+' failed']:[])];
    if(!state.running&&state.checked<state.total)notes.push((state.paused?'Paused · ':'')+(state.total-state.checked)+' remaining');
    node.querySelector('.upload-progress-label').textContent=caption;
    node.querySelector('.upload-progress-note').textContent=notes.join(' · ')||(state.running?'Starting checks…':'');
    const bar=node.querySelector('progress');bar.max=state.total;bar.value=state.checked;bar.setAttribute('aria-valuetext',caption+(notes.length?'. '+notes.join(', '):''));
  }
  function reconcileChildren(parent,children){
    const keep=new Set(children);
    for(const node of [...parent.childNodes])if(!keep.has(node))node.remove();
    let cursor=parent.firstChild;
    for(const node of children){
      if(node===cursor){cursor=cursor.nextSibling;continue;}
      // A no-op refresh never detaches the grid or its decoded images. Where
      // supported, a real sort also preserves browser state while moving cards.
      if(node.isConnected&&parent.isConnected&&typeof parent.moveBefore==='function')parent.moveBefore(node,cursor);
      else parent.insertBefore(node,cursor);
    }
  }
  const membersExpanded=id=>memberExpansionWrites.get(id)?.expanded??(library.groups[id]?.channelsExpanded===true);
  async function saveMembersExpanded(id,expanded){
    const write={expanded};memberExpansionWrites.set(id,write);
    try{
      await request({type:'feedLibrary:channels',groupId:id,expanded});
      if(!disposed&&memberExpansionWrites.get(id)===write)library.groups[id]={...library.groups[id],channelsExpanded:expanded};
    }catch(error){
      if(!disposed&&memberExpansionWrites.get(id)===write&&active===id)showError('Could not save the channel list preference. '+error.message);
    }finally{
      if(memberExpansionWrites.get(id)===write){memberExpansionWrites.delete(id);const details=host?.shadowRoot.querySelector('.group-members');if(!disposed&&active===id&&details)details.open=membersExpanded(id);}
    }
  }
  function renderMembers(root,group,sameView){
    let details=sameView&&root.querySelector('.group-members');
    if(!details){
      details=el('details',undefined,{class:'group-members'});
      const summary=el('summary');summary.append(el('span','Channels'),el('span','',{class:'member-count'}));
      details.append(summary,el('ul',undefined,{class:'members','aria-label':'Channels in '+group.name}));
      summary.addEventListener('click',event=>{
        if(disposed||!details.isConnected||active!==group.id||event.defaultPrevented||event.button>0)return;
        // Record intent before a storage update can render. The native toggle
        // event is asynchronous and can otherwise lose a fast second click.
        // Keyboard activation also clicks summary; open retains its semantics.
        event.preventDefault();const expanded=!details.open;
        saveMembersExpanded(group.id,expanded);details.open=expanded;
      });
    }
    details.open=membersExpanded(group.id);details.querySelector('.member-count').textContent=String(data.channels.length);
    const members=details.querySelector('.members');members.setAttribute('aria-label','Channels in '+group.name);
    const existing=new Map([...members.children].map(row=>[row.dataset.channelId,row])),rows=[];
    for(const channel of data.channels){
      let row=existing.get(channel.id);
      if(!row){row=el('li',undefined,{'data-channel-id':channel.id});row.append(channelLink(channel));}
      else LedgerMedia.updateChannels(row,{[channel.id]:channel});
      row.querySelector('.ledger-channel').title=channel.name||'YouTube channel';
      let error=row.querySelector('small');
      if(channel.error){if(!error){error=el('small');row.append(error);}error.textContent=channel.error;error.title=channel.retryAt?'Retry available after '+new Date(channel.retryAt).toLocaleTimeString():'';}else error?.remove();
      let cadence=row.querySelector('.channel-cadence');
      if(channel.dailyChecks){if(!cadence){cadence=el('span','Checked daily',{class:'channel-cadence',title:'No known uploads for at least 90 days at the last successful check. Manual Refresh can check sooner.'});row.append(cadence);}}else cadence?.remove();
      rows.push(row);
    }
    reconcileChildren(members,rows);return details;
  }
  async function hideChannel(groupId,channelId,hidden){
    const result=await request({type:'feedLibrary:hideChannel',groupId,channelId,hidden});
    const name=saved.channels[channelId]?.name||'Channel';
    if(host?.isConnected)LedgerUndoUI.show(host.shadowRoot,hidden?name+' hidden from this group.':name+' restored to this group.',result.undoToken);
    return result;
  }
  async function saveHeader(message){
    try{await request(message);}catch(error){render();showError(error.message);}
  }
  function openFeedMenu(trigger,label,items){
    if(videoMenu?.trigger===trigger){closeVideoMenu();return;}closeVideoMenu(false);closeGroupMenu(false);
    const panel=el('div',undefined,{class:'video-menu',id:'ledger-feed-menu',role:'menu','aria-label':label});
    for(const [text,action,disabled] of items){const item=button(text,()=>{closeVideoMenu();action();},{role:'menuitem',tabindex:'-1'});item.disabled=!!disabled;panel.append(item);}
    videoMenu={trigger,panel};trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',panel.id);
    host.shadowRoot.append(panel);positionVideoMenu();panel.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function updateHiddenChannelChip(chip){
    const id=chip.dataset.channelId,name=saved.channels[id]?.name||id;
    chip.querySelector('span').textContent='Hidden: '+name;
    chip.setAttribute('aria-label','Restore channel: '+name);
    chip.title='Show videos from '+name+' again';
  }
  function renderFeedHeader(header,heading,group){
    header.classList.add('feed-header');
    const groupId=group.id,prefs={uploadedFilter:'week',...library.groups[groupId]},watch=group.watchFilter||'all',visible=visibleEntries(group),hiddenChannels=prefs.hiddenChannels||[];
    const groupChange=(action,values)=>saveHeader({type:'channelGroups:change',action,groupId,...values});
    const browsingChange=filters=>saveHeader({type:'feedLibrary:filters',groupId,filters});
    const meta=el('p',group.channelIds.length+' '+(group.channelIds.length===1?'channel':'channels')+(data?' · '+(visible.length!==data.entries.length?visible.length+' of '+data.entries.length+' videos':data.entries.length+' available '+(data.entries.length===1?'video':'videos')):''),{class:'group-meta'});heading.append(meta);
    const top=el('div',undefined,{class:'feed-heading'}),actions=el('div',undefined,{class:'header-actions'}),playControls=el('div',undefined,{class:'play-controls'});
    const play=button('',playGroup,{class:'play-group','data-focus':'play',title:'Queue up to 500 matching videos in the current order. Autoplay starts off.'});play.append(outlineIcon('m8 5 11 7-11 7V5Z'),el('span','Play group'));play.disabled=!visible.length||watch==='hidden';
    const playOptions=button('',()=>openFeedMenu(playOptions,'Playback options',[['Play in this order',()=>playGroup(),play.disabled],['Shuffle matching videos',()=>playGroup(undefined,undefined,true),play.disabled]]),{class:'play-options feed-menu-trigger','aria-label':'Playback options','aria-haspopup':'menu','aria-expanded':'false','data-focus':'play-options'});playOptions.append(outlineIcon('m6 9 6 6 6-6'));playOptions.disabled=play.disabled;
    playControls.append(play,playOptions);actions.append(playControls);
    const focusOptions=()=>host?.shadowRoot.querySelector('[data-focus=group-options]')?.focus({preventScroll:true});
    const options=button('',()=>openFeedMenu(options,'Group options',[
      ['Add channels',()=>ChannelGroupsUI.bulk(groupId,theme)],['Edit this group',()=>ChannelGroupsUI.manageGroup(group,theme,focusOptions)],
      ['Share group',()=>ChannelGroupsUI.shareGroup(groupId,theme,focusOptions)],['Manage all groups',manage]
    ]),{class:'group-options feed-menu-trigger','aria-label':'Group options','aria-haspopup':'menu','aria-expanded':'false','data-focus':'group-options',title:'Group options'});
    options.append(outlineIcon('M4 12h.01M12 12h.01M20 12h.01'));options.firstChild.setAttribute('stroke-width','4');actions.append(options);top.append(heading,actions);header.replaceChildren(top);
    const freshness=el('div',undefined,{class:'refresh-line'}),refresh=button('',()=>load(true,true),{'data-focus':'refresh','aria-label':refreshing?'Refreshing uploads':'Refresh uploads',title:'Refresh uploads'});refresh.append(outlineIcon('M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.2 3M4.7 14.9a8 8 0 0 0 13.2 3'));refresh.disabled=refreshing||data?.pausedUntil>Date.now();freshness.append(el('span','',{class:'freshness'}),refresh);header.append(freshness);
    const uploadProgress=el('div',undefined,{class:'upload-progress',hidden:''});uploadProgress.append(el('p','',{class:'upload-progress-label'}),el('progress',undefined,{max:'1',value:'0','aria-label':'Channel upload checks'}),el('p','',{class:'upload-progress-note'}));header.append(uploadProgress);
    const tools=el('div',undefined,{class:'browse-tools'}),search=el('input',undefined,{type:'search',class:'search-group',placeholder:'Search titles or channels','aria-label':'Search this group',maxlength:'200',title:'Search titles and channels in the available uploads'});search.value=query;
    search.addEventListener('compositionstart',()=>{composing=true;});search.addEventListener('compositionend',()=>{composing=false;query=search.value;limit=48;render();});search.addEventListener('input',()=>{query=search.value;limit=48;if(!composing)render();});tools.append(search);
    const order=Ledger.groupSort(group.sort),sortControls=el('div',undefined,{class:'sort-controls'}),sort=el('select',undefined,{'aria-label':'Sort uploads','data-focus':'sort',title:'Views per hour is the average since upload, not current activity.'});
    for(const [value,label] of [['date','Upload date'],['views','Views'],['rate','Views per hour'],['length','Video length']])sort.append(el('option',label,{value}));sort.value=order.metric;sort.addEventListener('change',()=>{const value=sort.value;sort.blur();groupChange('sort',{sort:Ledger.groupSortKey(value,value!=='length')});});
    const direction=button('',()=>groupChange('sort',{sort:Ledger.groupSortKey(order.metric,!order.descending)}),{class:'sort-direction','data-focus':'sort-direction','data-direction':order.descending?'descending':'ascending','aria-label':order.descending?'Sort ascending':'Sort descending',title:order.label+'. '+(order.descending?'Switch to ascending order':'Switch to descending order')});direction.append(outlineIcon(order.descending?'M12 5v14m-5-5 5 5 5-5':'M12 19V5m-5 5 5-5 5 5'));sortControls.append(sort,direction);tools.append(sortControls);
    const isExpanded=expandedFilters.has(groupId),extra=el('div',undefined,{class:'extra-filters',id:'ledger-extra-filters'});extra.hidden=!isExpanded;
    const extraCount=Number(group.hideShorts===true)+Number(watch==='hidden')+Number(!!prefs.uploadedFilter&&prefs.uploadedFilter!=='all')+Number(!!prefs.lengthFilter&&prefs.lengthFilter!=='all')+hiddenChannels.length;
    const toggle=button('',()=>{isExpanded?expandedFilters.delete(groupId):expandedFilters.add(groupId);render();},{class:'filter-toggle','aria-expanded':String(isExpanded),'aria-controls':extra.id,'data-focus':'filters'});toggle.append(outlineIcon('M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6M14 14v6'),el('span','Filters'));if(extraCount)toggle.append(el('span',String(extraCount),{class:'filter-count','aria-label':extraCount+' active filters'}));tools.append(toggle);header.append(tools);
    header.append(el('p','',{class:'sort-note'}),el('p','',{class:'shorts-note',role:'status'}));
    const watchFilters=el('div',undefined,{class:'watch-filters',role:'group','aria-label':'Filter by watch state'});
    for(const [value,label] of [['all','All videos'],['unwatched','Unwatched'],['started','Continue watching'],['watched','Watched']])watchFilters.append(button(label,()=>groupChange('filter',{filter:value}),{'aria-pressed':String(watch===value),'data-focus':'watch-'+value,title:value==='unwatched'?'Includes videos you have started':'Based on playback recorded by Ledger'}));header.append(watchFilters);
    const fields=el('div',undefined,{class:'filter-fields'}),chips=[];
    function addSelect(field,label,choices){
      const holder=el('label',label,{class:'filter-field'}),control=el('select',undefined,{'data-focus':field,'aria-label':label});
      for(const [value,text] of choices)control.append(el('option',text,{value}));control.value=prefs[field]||'all';control.addEventListener('change',()=>{const value=control.value;control.blur();limit=48;browsingChange({[field]:value});});holder.append(control);fields.append(holder);
      if(control.value!=='all')chips.push([control.selectedOptions[0].textContent,()=>browsingChange({[field]:'all'}),field]);
    }
    addSelect('uploadedFilter','Uploaded',[['all','Any time'],['visit','Since last visit'],['day','Last 24 hours'],['week','Last 7 days'],['month','Last 30 days']]);
    addSelect('lengthFilter','Video length',[['all','Any length'],['short','Under 10 minutes'],['medium','10–30 minutes'],['long','Over 30 minutes']]);extra.append(fields);
    if(prefs.lengthFilter&&prefs.lengthFilter!=='all')extra.append(el('p','Videos with unknown length stay visible until their length is checked.',{class:'length-note'}));
    const checks=el('div',undefined,{class:'filter-checks'}),shortsLabel=el('label',undefined,{class:'shorts-filter',title:'Known Shorts hide immediately; nearby uploads are checked first.'}),shorts=el('input',undefined,{type:'checkbox','data-focus':'hide-shorts'});shorts.checked=group.hideShorts===true;shorts.addEventListener('change',()=>groupChange('shorts',{hideShorts:shorts.checked}));shortsLabel.append(shorts,document.createTextNode('Hide Shorts'));checks.append(shortsLabel);
    const hiddenLabel=el('label',undefined,{class:'shorts-filter'}),hidden=el('input',undefined,{type:'checkbox','data-focus':'hidden-videos'});hidden.checked=watch==='hidden';hidden.addEventListener('change',()=>groupChange('filter',{filter:hidden.checked?'hidden':'all'}));hiddenLabel.append(hidden,document.createTextNode('Show hidden videos only'));checks.append(hiddenLabel);extra.append(checks);
    if(hiddenChannels.length){
      extra.append(el('p','Hidden channels · '+hiddenChannels.length,{class:'hidden-channels-note'}));const list=el('ul',undefined,{class:'hidden-channels','aria-label':'Hidden channels'});
      for(const id of hiddenChannels){const name=saved.channels[id]?.name||id,row=el('li');row.append(el('span',name,{class:'hidden-channel-name'}),button('Restore',async()=>{try{await hideChannel(groupId,id,false);}catch(error){showError(error.message);}},{'aria-label':'Restore '+name,'data-focus':'restore-'+id}));list.append(row);}extra.append(list);
    }
    header.append(extra);
    const activeFilters=el('div',undefined,{class:'active-filters','aria-label':'Active filters'});
    if(group.hideShorts)chips.push(['Hide Shorts',()=>groupChange('shorts',{hideShorts:false}),'shorts']);
    if(watch==='hidden')chips.push(['Hidden videos',()=>groupChange('filter',{filter:'all'}),'hidden']);
    for(const [label,clear,id] of chips){const chip=button('',clear,{class:'filter-chip','aria-label':'Remove filter: '+label,'data-focus':'chip-'+id});chip.append(el('span',label),outlineIcon('m6 6 12 12M6 18 18 6'));activeFilters.append(chip);}
    for(const id of hiddenChannels){
      const chip=button('',async()=>{chip.disabled=true;try{await hideChannel(groupId,id,false);}catch(error){chip.disabled=false;showError(error.message);}},{class:'filter-chip hidden-channel-chip','data-focus':'chip-channel-'+id,'data-channel-id':id});
      chip.append(el('span'),outlineIcon('m6 6 12 12M6 18 18 6'));updateHiddenChannelChip(chip);activeFilters.append(chip);
    }
    if(chips.length||query||watch!=='all')activeFilters.append(button('Clear filters',()=>{query='';limit=48;saveHeader({type:'feedLibrary:resetFilters',groupId});},{class:'clear-filters','data-focus':'clear-filters',title:'Reset search and browsing filters. Hidden channels and videos stay hidden until restored.'}));
    if(activeFilters.childElementCount)header.append(activeFilters);
  }
  function render(){
    if(disposed||!host?.isConnected||!active)return;
    if(composing)return;
    if(videoMenu&&host.dataset.renderedGroup===active){menuRenderPending=true;return;}
    const root=host.shadowRoot, focus=root.activeElement,focusCardId=focus?.closest('article')?.dataset.videoId,caret=focus?.classList.contains('search-group')?[focus.selectionStart,focus.selectionEnd]:null;
    if(focus?.tagName==='SELECT'&&host.dataset.renderedGroup===active){
      if(!focus.dataset.pendingRender){focus.dataset.pendingRender='true';focus.addEventListener('blur',()=>setTimeout(render,0),{once:true});}
      return;
    }
    const previousContent=root.querySelector('.content'),sameView=host.dataset.renderedGroup===active;let retainedGrid,gridSlot,retainedMembers,membersSlot;
    const content=el('div',undefined,{class:'content'}),header=el('header'),heading=el('div',undefined,{class:'heading'}),group=saved.groups.find(g=>g.id===active);
    const title=active==='overview'?'Groups':group?.name||'Group unavailable';const titleNode=el('h1',undefined,{class:'group-title'});if(group)titleNode.append(GroupIcons.create(group.icon));titleNode.append(el('span',title));heading.append(titleNode);
    const select=el('select',undefined,{class:'group-switch','aria-label':'Select a group'});select.append(el('option','Groups',{value:'overview'}));for(const g of saved.groups)select.append(el('option',g.name,{value:g.id}));select.value=active;select.addEventListener('change',()=>chooseGroup(select.value));heading.append(select);header.append(heading);
    if(group)renderFeedHeader(header,heading,group);
    else {const actions=el('div',undefined,{class:'actions'});actions.append(button('Manage groups',manage,{'data-focus':'manage'}));header.append(actions);}
    content.append(header);
    const status=el('p','',{class:'status',role:'status'});content.append(status);
    if(active==='overview'){
      const directory=el('nav',undefined,{class:'group-directory','aria-label':'Choose a group'});for(const g of saved.groups){const link=el('a',undefined,{href:groupURL(g.id)});const label=el('span',undefined,{class:'directory-label'});label.append(GroupIcons.create(g.icon),el('span',g.name));link.append(label,el('small',g.channelIds.length+' channels'));directory.append(link);}content.append(directory);
      if(!saved.groups.length)content.append(el('p','Create your first group, then add channels from their YouTube pages.',{class:'empty'}));
    }else if(!group){status.textContent='This group was deleted or is no longer available. Choose another group in the sidebar.';}
    else if(!data){status.textContent='Loading '+group.name+'…';}
    else{
      const members=renderMembers(root,group,sameView);
      if(members.isConnected){retainedMembers=members;membersSlot=el('div');content.append(membersSlot);}else content.append(members);
      const failed=data.channels.filter(c=>c.error).length,missing=data.channels.filter(c=>!c.fetchedAt).length,paused=data.pausedUntil>Date.now();
      status.textContent=paused?(data.pauseMessage||'YouTube checks are paused until '+new Date(data.pausedUntil).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.')+' Cached videos are still available.':refreshing?'Checking uploads in the background…':failed?failed+' '+(failed===1?'channel could':'channels could')+' not refresh. Available cached videos are shown. Ledger will retry automatically.':missing?'Some channels have not loaded yet.':'';
      if(failed)status.classList.add('error');
      if(paused&&data.pauseScope==='automatic'&&!refreshing)status.append(
        button('Retry now',()=>load(true,true,false,data.pausedUntil),{'data-focus':'retry-cooldown',title:'End Ledger’s cooldown and retry this group at a slower pace. If checks keep failing, Ledger will pause again.'})
      );
      if(failed&&!refreshing&&!paused)status.append(
        button('Retry failed channels',()=>load(true,true,true),{'data-focus':'retry-failed',title:'Retry affected channels. Recent attempts and YouTube’s retry limits are respected.'}),
        button('Show details',()=>{saveMembersExpanded(group.id,true);members.open=true;members.querySelector('summary').focus({preventScroll:true});},{'data-focus':'refresh-details'})
      );
      if(data.channels.some(c=>c.feedSource==='uploads-page'))content.append(el('p','Some uploads were recovered from YouTube’s public uploads pages. Only the first page is checked; ~ marks approximate dates or view counts.',{class:'note fallback-note'}));
      if(!data.entries.length){const empty=el('div',undefined,{class:'empty'});empty.append(el('p',!data.channels.length?'This group has no channels yet. Use “Add to group” on a channel or video page, or add a channel in Manage groups.':refreshing?'Fetching recent uploads from these channels.':'No uploads are available yet. Try Refresh to check these channels again.'));content.append(empty);}
      const grid=(sameView&&root.querySelector('.grid'))||el('div',undefined,{class:'grid'}),gridChildren=[],existing=new Map([...grid.querySelectorAll('article')].map(card=>[card.dataset.videoId,card]));
      const visible=displayEntries(group);let previousNew;
      const isNew=entry=>!!visitBoundary&&entry.publishedAt>visitBoundary&&entry.publishedAt<=Date.now();
      if(data.entries.length&&!visible.length)content.append(el('p',query?'No available uploads match your search.':group.watchFilter==='hidden'?'No hidden videos match these filters.':'No videos match these filters. Clear filters or restore a hidden channel to see more.',{class:'empty'}));
      for(const entry of visible.slice(0,limit)){
        const fresh=isNew(entry);if(Ledger.groupSort(group.sort).metric==='date'&&fresh!==previousNew&&(fresh||previousNew===true))gridChildren.push(el('div',fresh?'New since your last visit':'Previously available',{class:'new-divider'}));previousNew=fresh;
        const url='https://www.youtube.com/watch?v='+entry.videoId+'#ledger-launch='+encodeURIComponent(data.launchToken),channel=saved.channels[entry.channelId]||{id:entry.channelId,name:entry.channel};
        const signature=JSON.stringify([entry.title,entry.publishedAt,channel.id,channel.name,channel.avatarUrl]),previous=existing.get(entry.videoId);
        // Metadata and launch links can change without replacing the thumbnail.
        if(previous){
          if(previous.dataset.content!==signature){
            previous.dataset.content=signature;previous.dataset.publishedAt=String(entry.publishedAt);
            previous.querySelector('.thumbnail').setAttribute('aria-label','Watch '+entry.title);
            previous.querySelector('.video-title').textContent=entry.title;
            previous.querySelector('.video-options').setAttribute('aria-label','More options for '+entry.title);
            if(previous.querySelector('.channel').dataset.channelId===channel.id)LedgerMedia.updateChannels(previous,{[channel.id]:channel});
            else previous.querySelector('.channel').replaceWith(channelLink(channel));
            const time=previous.querySelector('time'),date=new Date(entry.publishedAt);time.dateTime=date.toISOString();time.title=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);
          }
          for(const link of previous.querySelectorAll('.thumbnail,.video-title'))link.href=url;
          updateCard(previous);gridChildren.push(previous);continue;
        }
        const card=el('article',undefined,{'data-video-id':entry.videoId,'data-published-at':String(entry.publishedAt),'data-content':signature});
        const thumb=el('a',undefined,{href:url,class:'thumbnail','aria-label':'Watch '+entry.title});const image=el('img',undefined,{src:'https://i.ytimg.com/vi/'+entry.videoId+'/hqdefault.jpg',alt:'',loading:'lazy',decoding:'sync',referrerpolicy:'no-referrer'});
        // Once decoded, keep the thumbnail out of Firefox's lazy-load cycle
        // if YouTube detaches and reattaches our host during native navigation.
        image.addEventListener('load',()=>{image.loading='eager';},{once:true});thumb.append(image);
        const titleLink=el('a',entry.title,{href:url,class:'video-title'});
        const date=new Date(entry.publishedAt),dateLabel=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);
        const time=el('time',Ledger.relativeTime(entry.publishedAt),{datetime:date.toISOString(),title:dateLabel}),meta=el('div',undefined,{class:'video-meta'}),badge=el('small','',{class:'watch-badge'}),heading=el('div',undefined,{class:'video-heading'});
        const options=button('',()=>openVideoMenu(card,options),{class:'video-options','aria-label':'More options for '+entry.title,'aria-haspopup':'menu','aria-expanded':'false',title:'More options'});
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'}))icon.setAttribute(key,value);
        for(const cy of [5,12,19]){const dot=document.createElementNS(icon.namespaceURI,'circle');for(const [key,value] of Object.entries({cx:12,cy,r:1.7,fill:'currentColor'}))dot.setAttribute(key,value);icon.append(dot);}options.append(icon);
        heading.append(titleLink,options);meta.append(time,badge,el('span','New',{class:'new-upload'}));card.append(thumb,heading,channelLink(channel),meta);updateCard(card);gridChildren.push(card);
      }
      reconcileChildren(grid,gridChildren);
      if(grid.isConnected){retainedGrid=grid;gridSlot=el('div');content.append(gridSlot);}else content.append(grid);
      if(visible.length>limit)content.append(button('Load more',()=>{limit+=48;render();},{class:'more','data-focus':'more'}));
      content.append(el('p','Recent uploads plus videos Ledger has saved locally. YouTube’s feed is limited; this is not a complete channel archive.'+(group.hideShorts?' Nearby uploads are checked for Shorts first; unclassified videos stay available.':''),{class:'coverage'}));
    }
    if(previousContent&&sameView)reconcileChildren(previousContent,[...content.childNodes].map(node=>node===gridSlot?retainedGrid:node===membersSlot?retainedMembers:node));
    else if(previousContent)previousContent.replaceWith(content);else root.append(content);host.dataset.renderedGroup=active;
    updateFreshness();
    updateSortStatus();updateShortsStatus();
    observeDurations();
    // Restore a control only when it actually held focus, never steal typing focus elsewhere.
    if(caret){const search=root.querySelector('.search-group');search?.focus({preventScroll:true});search?.setSelectionRange?.(...caret);}
    else if(focus?.classList.contains('video-options'))(root.querySelector('article[data-video-id="'+focusCardId+'"] .video-options')||root.querySelector('.watch-filters button[aria-pressed=true]')||root.querySelector('[data-focus=filters]'))?.focus({preventScroll:true});
    else if(focus?.dataset.focus)(root.querySelector('[data-focus="'+focus.dataset.focus+'"]')||root.querySelector('[data-focus=filters]'))?.focus({preventScroll:true});
    else if(focus?.tagName==='SUMMARY')root.querySelector('summary')?.focus({preventScroll:true});
    else if(focus?.tagName==='A'){
      const videoId=focus.closest('article')?.dataset.videoId;
      const replacement=videoId?root.querySelector('article[data-video-id="'+videoId+'"] .'+focus.className):[...root.querySelectorAll('.members a')].find(link=>link.href===focus.href);
      replacement?.focus({preventScroll:true});
    }
    if(restore&&data?.entries.length){
      const position=restore,version=generation,scroll=window.scrollY;restore=null;
      requestAnimationFrame(()=>{if(version===generation&&window.scrollY===scroll)window.scrollTo({top:position.top,behavior:'instant'});});
    }
  }
  async function load(refresh=false,force=false,failedOnly=false,retryUntil=0){
    if(disposed)return;
    const id=active,version=generation;if(!id||id==='overview')return;
    if(refreshing&&refresh)return;
    // Automatic checks announce actual work through the shared progress state.
    // A warm group visit should never flash "Checking uploads".
    if(refresh&&force){refreshing=true;render();}
    try{
      if(visitBoundary===undefined){if(!visitPromise)visitPromise=request({type:'feedLibrary:visit',groupId:id});const visit=await visitPromise;if(id!==active)return;visitBoundary=visit.previous;visitAt=visit.at;}
      const result=await request({type:'groupFeed:get',groupId:id});if(version!==generation||id!==active)return;data=result;render();if(refresh&&!retryUntil&&document.visibilityState==='visible')LedgerMedia.portraits(result.channels.map(c=>c.id));
      if(refresh){await request(retryUntil?{type:'groupFeed:retryCooldown',groupId:id,pausedUntil:retryUntil}:{type:'groupFeed:refresh',groupId:id,force,failedOnly,automatic:!force});if(version!==generation||id!==active)return;const latest=await request({type:'groupFeed:get',groupId:id});if(version!==generation||id!==active)return;data=latest;refreshing=false;render();}
    }catch(error){if(version===generation&&id===active){refreshing=false;if(data?.refresh)data.refresh.running=false;render();showError(error.message);}}
  }
  function storageChanged(changes,area){
    if(disposed||area!=='local')return;
    if(changes['groupRefreshProgress:v1']&&data){data.refresh=changes['groupRefreshProgress:v1'].newValue?.[active]||null;updateFreshness();}
    if(changes['youtubeRequests:v1']&&data){const next=changes['youtubeRequests:v1'].newValue||{},until=next.pausedUntil||0,message=next.pauseMessage||'',scope=next.pauseScope||'all';if(until!==(data.pausedUntil||0)||message!==(data.pauseMessage||'')||scope!==data.pauseScope){Object.assign(data,{pausedUntil:until,pauseMessage:message,pauseScope:scope,pauseReason:next.pauseReason||'unknown'});render();}}
    if(changes['videoProgress:v1']&&data){data.progress=changes['videoProgress:v1'].newValue||{version:1,videos:{}};render();}
    if(changes[FeedLibrary.key]){library=changes[FeedLibrary.key].newValue||{version:1,groups:{}};updateNavigation();render();}
    if(changes.settings){theme=Ledger.settings(changes.settings.newValue).theme;settingsReady=true;mount();if(changes.settings.oldValue?.backgroundGroupChecks===false&&changes.settings.newValue?.backgroundGroupChecks===true)checkAll();}
    if(changes['channelGroups:v1']){
      const previous=saved,group=previous.groups.find(g=>g.id===active);saved=changes['channelGroups:v1'].newValue||{groups:[],channels:{}};const next=saved.groups.find(g=>g.id===active);
      if(JSON.stringify(previous.groups)===JSON.stringify(saved.groups)&&previous.collapsed===saved.collapsed){
        // A portrait lookup only touches channel links; keep the guide, GIF icons,
        // feed header, open menus and thumbnail grid intact.
        saved.groups=previous.groups;
        if(data)data.channels=data.channels.map(c=>({...c,...saved.channels[c.id]}));
      if(host?.shadowRoot){LedgerMedia.updateChannels(host.shadowRoot,saved.channels);for(const link of host.shadowRoot.querySelectorAll('.members .ledger-channel'))link.title=link.lastElementChild.textContent;}
      host?.shadowRoot.querySelectorAll('.hidden-channel-chip').forEach(updateHiddenChannelChip);
      }else{
      // Appearance changes update in place; they don't invalidate uploads or launch context.
      const feedChanged=JSON.stringify([group?.name,group?.channelIds])!==JSON.stringify([next?.name,next?.channelIds]);
      if(feedChanged){generation++;refreshing=false;}
      if(data&&next&&!feedChanged)data.channels=data.channels.map(c=>({...c,...saved.channels[c.id]}));
      mount();if(!feedChanged||active==='overview')render();
      }
    }
    if(changes['channelUploads:v1']){
      const next=changes['channelUploads:v1'].newValue||{channels:{}},metadataOnly=uploadView(uploads)===uploadView(next);uploads=next;
      if(metadataOnly){
        const entries=new Map(Object.values(uploads.channels).flatMap(c=>c.entries||[]).map(v=>[v.videoId,v]));
        if(data)for(const entry of data.entries){const next=entries.get(entry.videoId);if(next?.details)entry.details=next.details;else delete entry.details;if(next?.views)entry.views=next.views;else delete entry.views;}
        // Show completed results without waiting for the slowest request in a batch.
        if(!metadataRenderTimer)metadataRenderTimer=setTimeout(()=>{metadataRenderTimer=null;updateMetadataView();},150);
        scheduleDurations();
      }else{updateNavigation();clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>load(),200);}
    }
  }
  browser.storage.onChanged.addListener(storageChanged);
  browser.storage.local.get(['settings','channelGroups:v1',FeedLibrary.key,'channelUploads:v1']).then(value=>{if(disposed)return;theme=Ledger.settings(value.settings).theme;library=value[FeedLibrary.key]||library;uploads=value['channelUploads:v1']||uploads;saved=value['channelGroups:v1']||saved;settingsReady=true;mount();}).catch(()=>{if(disposed)return;settingsReady=true;mount();});
  function navigationStarted(){
    if(initialHash&&location.pathname!=='/feed/subscriptions')initialHash='';
    closeGroupMenu(false);closeVideoMenu(false,false);remember();
    if(pendingGroup&&location.pathname!=='/feed/subscriptions'&&(nativeNavigation||location.pathname+location.search!==pendingPath)){pendingGroup='';nativeNavigation=false;}
  }
  document.addEventListener('yt-navigate-start',navigationStarted);
  function navigationFinished(){
    if(initialHash&&location.pathname==='/feed/subscriptions')history.replaceState(history.state,'',location.pathname+location.search+initialHash);
    if(pendingGroup&&nativeNavigation){
      const id=pendingGroup;pendingGroup='';nativeNavigation=false;
      // Complete the existing history entry; Back should go straight to the page we left.
      if(location.pathname==='/feed/subscriptions'){const url=id==='overview'?'/feed/subscriptions#ledger-groups':groupURL(id);initialHash=url.slice(url.indexOf('#'));history.replaceState(history.state,'',url);}
    }
    lastPath=location.pathname;mount();
  }
  document.addEventListener('yt-navigate-finish',navigationFinished);document.addEventListener('DOMContentLoaded',mount,{once:true});
  function historyChanged(event){
    if(event.type==='popstate'||location.pathname!=='/feed/subscriptions'||location.hash&&location.hash!==initialHash)initialHash=location.pathname==='/feed/subscriptions'&&/^#ledger-group(?:=|s(?:$|&))/.test(location.hash)?location.hash:'';
    pendingGroup='';nativeNavigation=false;
    // Back/Forward between Ledger groups also stays inside the existing page.
    if(lastPath==='/feed/subscriptions'&&location.pathname===lastPath&&(active||route()))event.stopImmediatePropagation();
    mount();
  }
  window.addEventListener('hashchange',historyChanged,true);window.addEventListener('popstate',historyChanged,true);window.addEventListener('pagehide',remember);
  function rememberClick(event){if(event.composedPath().includes(host))remember();}
  window.addEventListener('click',rememberClick,true);window.addEventListener('auxclick',rememberClick,true);
  // Reattach after YouTube replaces its children in the same mutation turn,
  // before the browser paints, instead of waiting for the one-second fallback.
  const pageChanges=new MutationObserver(()=>{
    if(disposed||!settingsReady)return;
    if((pendingGroup&&!nativeNavigation)||
       (active&&host&&!host.isConnected&&document.querySelector('ytd-page-manager'))||
       (nav&&!nav.isConnected&&document.querySelector('ytd-guide-renderer #sections'))||
       (mini&&!mini.isConnected&&document.querySelector('ytd-mini-guide-renderer #items')))mount();
  });
  pageChanges.observe(document,{childList:true,subtree:true});
  const checkAll=()=>{if(!disposed&&saved.groups.length)request({type:'groupFeed:checkAll'}).catch(()=>{});};
  const checkTimer=setInterval(checkAll,30*60*1000),initialCheck=setTimeout(checkAll,30000+Math.random()*30000);
  const timeTimer=setInterval(updateTimes,60000);
  const durationRefresh=setInterval(scheduleDurations,60000);
  const visibilityChanged=()=>{scheduleDurations();if(document.visibilityState!=='visible')request({type:'groupFeed:leave'}).catch(()=>{});else if(active&&active!=='overview'&&!refreshing)load();};
  document.addEventListener('visibilitychange',visibilityChanged);
  const mountTimer=setInterval(mount,1000),refreshTimer=setInterval(()=>{if(active&&active!=='overview'&&document.visibilityState==='visible')load(true);},30*60*1000);
  function dispose(){
    if(disposed)return;closeGroupMenu(false);closeVideoMenu(false,false);remember();disposed=true;generation++;
    clearInterval(checkTimer);clearTimeout(initialCheck);clearInterval(timeTimer);clearInterval(mountTimer);clearInterval(refreshTimer);clearTimeout(cacheTimer);pageChanges.disconnect();
    clearDurationCards();clearTimeout(metadataRenderTimer);clearInterval(durationRefresh);document.removeEventListener('visibilitychange',visibilityChanged);
    try{browser.storage.onChanged.removeListener(storageChanged);}catch{}
    document.removeEventListener('yt-navigate-start',navigationStarted);document.removeEventListener('yt-navigate-finish',navigationFinished);
    document.removeEventListener('DOMContentLoaded',mount);document.removeEventListener(disposeEvent,dispose);
    if(globalThis.LedgerGroupMenuKeyboard===groupMenuKey)delete globalThis.LedgerGroupMenuKeyboard;
    window.removeEventListener('pointerdown',dismissGroupMenu,true);window.removeEventListener('focusin',dismissGroupMenu,true);window.removeEventListener('scroll',dismissGroupMenu,true);window.removeEventListener('resize',leaveGroupMenu);
    if(globalThis.LedgerFeedKeyboard===videoMenuKey)delete globalThis.LedgerFeedKeyboard;
    window.removeEventListener('pointerdown',dismissVideoMenu,true);window.removeEventListener('focusin',dismissVideoMenu,true);window.removeEventListener('scroll',dismissVideoMenu,true);window.removeEventListener('resize',leaveVideoMenu);
    window.removeEventListener('click',nativeExitIntent,true);window.removeEventListener('click',groupClick,true);window.removeEventListener('click',rememberClick,true);window.removeEventListener('auxclick',rememberClick,true);
    for(const type of ['click','auxclick','contextmenu'])window.removeEventListener(type,queueVideoClick,true);
    window.removeEventListener('hashchange',historyChanged,true);window.removeEventListener('popstate',historyChanged,true);window.removeEventListener('pagehide',remember);
    document.getElementById('ledger-group-icon-dialog')?.shadowRoot?.querySelector('dialog')?.close();
    for(const node of [nav,mini,host,style])node?.remove();
    document.querySelectorAll('[data-ledger-group-view]').forEach(node=>node.removeAttribute('data-ledger-group-view'));
  }
  document.addEventListener(disposeEvent,dispose,{once:true});
})();
