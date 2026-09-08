/* Entry points are observations, never inferred from a channel's group membership. */
globalThis.PlaybackSource=(()=>{
  const disposeEvent='ledger-source-dispose';document.dispatchEvent(new Event(disposeEvent));
  let disposed=false;
  let current, route='', pendingResolution=false, revision=0,enabled=false,ready=false;
  const storageKey='ledger:watch-source', pendingKey='ledger:pending-source',autoplayKey='ledger:autoplay-source';
  const initialURL=new URL(location.href);
  const recommendations='ytd-browse[page-subtype="home"], #related, ytd-watch-next-secondary-results-renderer, .ytp-endscreen-content, .ytp-ce-element, ytm-browse[tab-identifier="FEwhat_to_watch"], ytm-item-section-renderer[section-identifier="related-items"]';
  function read(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
  function save(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
  function video(url){return url.pathname==='/watch'?url.searchParams.get('v'):/^\/shorts\/([\w-]{11})/.exec(url.pathname)?.[1];}
  const watchLater=url=>url.searchParams.get('list')==='WL'&&(['/watch','/playlist'].includes(url.pathname)||/^\/shorts\/[-\w]{11}\/?$/.test(url.pathname));
  function capture(event){
    if(!enabled)return;
    const link=event.composedPath().find(node=>node?.tagName==='A'&&node.href);
    if(!link||event.type==='auxclick'&&event.button!==1)return;
    let url;try{url=new URL(link.href);}catch{return;}const id=video(url);
    if(url.origin!==location.origin||!id||['ledger-launch','ledger-queue'].some(k=>new URLSearchParams(url.hash.slice(1)).has(k)))return;
    const fromWatchLater=watchLater(new URL(location.href))&&(watchLater(url)||!!link.closest('ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer'));
    const kind=link.closest(recommendations)?'recommendations':fromWatchLater?'watchLater':location.pathname==='/results'?'search':location.pathname==='/feed/subscriptions'?'subscriptions':/^\/(?:@|channel\/|c\/|user\/)/.test(location.pathname)?'channel':'unknown';
    const predecessor=current?.videoId===video(new URL(location.href))?Ledger.journey({previousVisitId:current.id,previousVideoId:current.videoId,transition:'click'}):null;
    const token=crypto.randomUUID(),source={kind,journey:predecessor,evidence:event.type==='contextmenu'?'observed-context-link':'observed-link'},hash=new URLSearchParams(url.hash.slice(1));
    hash.set('ledger-origin',token);url.hash=hash.toString();link.href=url.href;
    browser.runtime.sendMessage({type:'sourceContext:put',token,videoId:id,source}).catch(()=>{});
    if(event.type==='click'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0&&link.target!=='_blank')save(pendingKey,{videoId:id,at:Date.now(),source:{kind,journey:predecessor,evidence:'observed-click'}});
  }
  window.addEventListener('click',capture,true);window.addEventListener('auxclick',capture,true);window.addEventListener('contextmenu',capture,true);
  function ended(event){
    if(!enabled||globalThis.LedgerQueueActive?.()||event.target?.tagName!=='VIDEO'||document.querySelector('.ad-showing'))return;
    const toggle=document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]'),link=document.querySelector('a.ytp-next-button[href]');
    if(!link)return;let next,fromWatchLater;try{const url=new URL(link.href);next=video(url);fromWatchLater=watchLater(new URL(location.href))&&watchLater(url);}catch{return;}
    if(!toggle&&!fromWatchLater)return;
    if(next&&current?.videoId)save(autoplayKey,{videoId:next,from:current.videoId,previousVisitId:current.id,at:Date.now(),watchLater:fromWatchLater});
  }
  document.addEventListener('ended',ended,true);
  function sync(event){
    if(disposed||!ready)return;
    const url=new URL(location.href),id=video(url)||'',pending=read(pendingKey),pendingClick=pending?.videoId===id&&Date.now()-pending.at>=0&&Date.now()-pending.at<15000;
    let hash=new URLSearchParams(url.hash.slice(1));
    // YouTube can clean the URL before the first storage/message response returns.
    // Retain only the link marker observed on this document's initial URL, for this video.
    if(revision===0&&!pendingClick&&id&&id===video(initialURL)&&!['ledger-launch','ledger-origin','ledger-queue'].some(key=>hash.has(key)))hash=new URLSearchParams(initialURL.hash.slice(1));
    const token=hash.get('ledger-launch'),origin=hash.get('ledger-origin'),queue=hash.get('ledger-queue'),step=hash.get('ledger-step'),next=id+'|'+(queue?queue+'|'+step:token||origin||'');
    if(next===route&&!pendingClick)return;
    // Removing a marker during the same playback is URL cleanup, not a new entry point.
    // Keep an in-flight resolution too; a new observed click or Back/Forward still wins.
    if(id&&!token&&!origin&&!queue&&!pendingClick&&event?.type!=='popstate'&&route.startsWith(id+'|')&&route!==next&&(current?.videoId===id||pendingResolution)){route=next;return;}
    route=next;const version=++revision;pendingResolution=!!(token||origin||queue);const previous=current;current=null;
    try{sessionStorage.removeItem(pendingKey);}catch{}
    const autoplay=read(autoplayKey);try{sessionStorage.removeItem(autoplayKey);}catch{}
    const restored=read(storageKey), reload=performance.getEntriesByType('navigation')[0]?.type==='reload';
    function finish(source,visitId){if(disposed||version!==revision)return;current={videoId:id,id:visitId||crypto.randomUUID(),source:Ledger.source(source),journey:Ledger.journey(source?.journey),documentTimeOrigin:performance.timeOrigin};pendingResolution=false;if(enabled)save(storageKey,current);}
    // Reinjection during extension testing may restart this script without navigating.
    // The document timestamp prevents an old visit from being applied to a new page/tab.
    const sameDocument=revision===1&&restored?.videoId===id&&restored.documentTimeOrigin===performance.timeOrigin&&/^[-\w]{36}$/.test(restored.id||'');
    if(sameDocument&&!pendingClick&&!token&&!origin&&!queue){finish({...restored.source,journey:restored.journey},restored.id);return;}
    if(queue&&step&&id){
      browser.runtime.sendMessage({type:'groupQueue:source',token:queue,step,videoId:id}).then(result=>finish(result||{kind:'unknown',evidence:'unverified-link'})).catch(()=>finish({kind:'unknown',evidence:'unverified-link'}));
    }else if(token&&id){
      browser.runtime.sendMessage({type:'groupFeed:source',token,videoId:id}).then(result=>finish(result?.groupFeedError?{kind:'unknown',evidence:'unverified-link'}:result)).catch(()=>finish({kind:'unknown',evidence:'unverified-link'}));
    }else if(origin&&id){
      (async()=>{for(let i=0;i<4;i++){const result=await browser.runtime.sendMessage({type:'sourceContext:get',token:origin,videoId:id});if(result)return finish(result);await new Promise(resolve=>setTimeout(resolve,100*(i+1)));}finish({kind:'unknown',evidence:'unverified-link'});})().catch(()=>finish({kind:'unknown',evidence:'unverified-link'}));
    }else if(pendingClick)finish(pending.source);
    else if(autoplay?.videoId===id&&autoplay.from===previous?.videoId&&Date.now()-autoplay.at<15000)finish({kind:autoplay.watchLater?'watchLater':'autoplay',evidence:autoplay.watchLater?'observed-watch-later-next':'observed-autoplay-next',journey:{previousVisitId:autoplay.previousVisitId,previousVideoId:autoplay.from,transition:'autoplay'}});
    else if(reload&&restored?.videoId===id&&revision===1)finish(restored.source);
    else if(id&&watchLater(url))finish({kind:'watchLater',evidence:'watch-later-playlist'});
    else finish({kind:'unknown',evidence:'not-observed'});
  }
  document.addEventListener('yt-navigate-finish',sync);window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);
  browser.storage.local.get('paused').then(value=>{enabled=!value.paused;ready=true;route='';sync();});
  const changed=(changes,area)=>{if(area==='local'&&changes.paused){enabled=!changes.paused.newValue;revision++;route='';current=null;try{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(pendingKey);sessionStorage.removeItem(autoplayKey);}catch{}sync();}};
  browser.storage.onChanged.addListener(changed);
  document.addEventListener(disposeEvent,()=>{disposed=true;revision++;for(const type of ['click','auxclick','contextmenu'])window.removeEventListener(type,capture,true);document.removeEventListener('ended',ended,true);document.removeEventListener('yt-navigate-finish',sync);window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync);browser.storage.onChanged.removeListener(changed);},{once:true});
  return {read(id){if(!ready)return null;sync();return pendingResolution?null:current?.videoId===id?current:{source:{kind:'unknown',evidence:'not-observed'}};}};
})();
