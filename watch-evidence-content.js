/* Read native cards already loaded by YouTube. This module never fetches pages. */
(()=>{
  const disposeEvent='ledger-watch-evidence-dispose';document.dispatchEvent(new Event(disposeEvent));
  document.getElementById('ledger-watch-check')?.remove();
  const cards='ytd-video-renderer,ytd-grid-video-renderer,ytd-rich-item-renderer,ytd-playlist-video-renderer,ytd-compact-video-renderer,yt-lockup-view-model,ytm-video-with-context-renderer,ytm-compact-video-renderer';
  let disposed=false,navigating=false,enabled=false,timer,busy=false,rescan=false,banner,count=0,revision=0;
  const sent=new Map(),historyCheck=()=>location.pathname==='/feed/history'&&location.hash==='#ledger-watch-check';
  const visible=node=>node.isConnected&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
  function identify(row){
    const link=row.querySelector('a#thumbnail[href],a.yt-lockup-view-model__content-image[href],a#video-title[href],a[href*="/watch?"],a[href*="/shorts/"]');
    const id=link?WatchEvidence.videoId(link.href):null,title=row.querySelector('a#video-title[href]'),titleId=title?WatchEvidence.videoId(title.href):null;
    // A recycled card may update its thumbnail and title links separately.
    return titleId&&titleId!==id?null:id;
  }
  function percent(row){
    const bar=row.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress');
    const width=bar?.style.width;return typeof width==='string'&&/^\d+(?:\.\d+)?%$/.test(width)&&+parseFloat(width)>0&&+parseFloat(width)<=100?parseFloat(width):null;
  }
  function showBanner(){
    if(!historyCheck()){banner?.remove();banner=null;return;}
    if(!banner&&document.body){
      banner=document.createElement('div');banner.id='ledger-watch-check';const root=banner.attachShadow({mode:'open'});
      const style=document.createElement('style');style.textContent=':host{position:fixed;bottom:20px;right:20px;z-index:2147483646;max-width:min(450px,calc(100vw - 40px));font:14px/1.5 system-ui;color:var(--yt-spec-text-primary,#fff)}aside{padding:16px 20px;border:1px solid #8888;border-radius:14px;box-shadow:0 8px 30px #0006;background:var(--yt-spec-base-background,#202020)}p{margin:6px 0}button{font:inherit;color:inherit;border:1px solid #8888;background:transparent;border-radius:8px;padding:7px 14px;margin-top:8px;cursor:pointer}';
      const panel=document.createElement('aside'),title=document.createElement('strong'),status=document.createElement('p'),help=document.createElement('p'),done=document.createElement('button');title.textContent='Updating Ledger watch status';status.setAttribute('role','status');help.textContent='Scroll to include older history. Group badges update in your other tab. This does not add watch time.';done.textContent='Done';done.onclick=()=>{history.replaceState(history.state,'',location.pathname+location.search);showBanner();};panel.append(title,status,help,done);root.append(style,panel);document.body.append(banner);
    }
    if(banner)banner.shadowRoot.querySelector('[role=status]').textContent=count+' videos recognized from this page.';
  }
  function schedule(){if(!disposed&&!timer)timer=setTimeout(scan,1200);}
  async function scan(){
    timer=null;if(disposed||navigating)return;showBanner();if(busy){rescan=true;return;}if(!enabled&&!historyCheck())return;
    const version=revision,records=[];
    for(const row of document.querySelectorAll(cards)){
      if(!visible(row))continue;const id=identify(row);if(!id)continue;
      const amount=percent(row),inHistory=location.pathname==='/feed/history'&&!!row.closest('ytd-browse[page-subtype="history"]');
      if(amount===null&&!inHistory)continue;
      const signature=amount||0;if(sent.has(id)&&sent.get(id)>=signature)continue;
      records.push({videoId:id,seenAt:Date.now(),...(amount!==null?{percent:amount}:{})});
      if(records.length===100)break;
    }
    if(!records.length)return;busy=true;
    try{
      const result=await browser.runtime.sendMessage({type:'watchEvidence:observe',source:location.pathname==='/feed/history'?'youtube-history':'youtube-progress',records});
      if(!result?.ok)throw Error(result?.error||'Could not save watch status.');
      if(disposed||version!==revision)return;
      for(const row of records){if(!sent.has(row.videoId))count++;sent.set(row.videoId,row.percent||0);}showBanner();
      // Bound memory while retaining enough fingerprints for long history pages.
      if(sent.size>20000)for(const id of [...sent.keys()].slice(0,sent.size-20000))sent.delete(id);
      if(records.length===100)schedule();
    }catch(error){if(banner)banner.shadowRoot.querySelector('[role=status]').textContent='Could not save watch status. Reload this page to try again.';}
    finally{busy=false;if(rescan){rescan=false;schedule();}}
  }
  async function settings(){const local=await browser.storage.local.get(['settings','paused']);if(disposed)return;enabled=!local.paused&&Ledger.settings(local.settings).learnYouTubeProgress;schedule();}
  const observer=new MutationObserver(schedule);observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['style','href','hidden']});
  const changed=(changes,area)=>{if(area==='local'&&(changes.settings||changes.paused)){sent.clear();void settings().catch(()=>{});}};
  const start=()=>{navigating=true;revision++;},finish=()=>{navigating=false;sent.clear();count=0;schedule();};
  function dispose(){disposed=true;revision++;clearTimeout(timer);observer.disconnect();banner?.remove();browser.storage.onChanged.removeListener(changed);document.removeEventListener(disposeEvent,dispose);document.removeEventListener('yt-navigate-start',start);document.removeEventListener('yt-navigate-finish',finish);window.removeEventListener('hashchange',schedule);}
  browser.storage.onChanged.addListener(changed);document.addEventListener(disposeEvent,dispose);document.addEventListener('yt-navigate-start',start);document.addEventListener('yt-navigate-finish',finish);window.addEventListener('hashchange',schedule);void settings().catch(()=>{});
})();
