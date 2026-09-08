/* A quiet queue panel beside the native watch player, owned entirely by Ledger. */
(()=>{
  if(location.hostname!=='www.youtube.com')return;
  const disposeEvent='ledger-queue-dispose';document.dispatchEvent(new Event(disposeEvent));document.querySelectorAll('#ledger-group-queue').forEach(n=>n.remove());
  const initialURL=new URL(location.href);let initialHash=initialURL.pathname==='/watch'&&new URLSearchParams(initialURL.hash.slice(1)).has('ledger-queue')?initialURL.hash:'';
  let host,queue,context,route='',revision=0,disposed=false,busy=false,endedVideo=null,closed=false;
  let durationObserver,durationTimer,durationRequest;const visibleRows=new Set(),durationFailures=new Map();
  let playbackStart,playbackTimer,playbackPrompt=false;
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const button=(text,fn,attrs={})=>{const node=el('button',text,{type:'button',...attrs});node.onclick=fn;return node;};
  function navigationButton(forward,fn){
    const name=forward?'Next':'Previous',node=button('',fn,{class:'queue-arrow','aria-label':name+' queue video',title:name+' video','data-focus':forward?'next':'previous'});
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    path.setAttribute('d',forward?'m9 6 6 6-6 6':'m15 6-6 6 6 6');svg.append(path);node.append(svg);return node;
  }
  const css=`:host{display:block;margin-bottom:16px;color:var(--yt-spec-text-primary,#f1f1f1);font:14px/1.45 Roboto,Arial,sans-serif}*{box-sizing:border-box}.queue{border:1px solid var(--yt-spec-10-percent-layer,#8885);border-radius:12px;background:var(--yt-spec-raised-background,var(--yt-spec-base-background,#212121));overflow:hidden}header{padding:12px 14px;display:flex;align-items:center;gap:10px}header a{flex:1;min-width:0;font-weight:600}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}button,select,input{font:inherit;color:inherit}button{background:transparent;border:0;padding:8px;border-radius:50%;cursor:pointer}button:hover{background:#8883}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid currentColor;outline-offset:2px}button.current{font-weight:700;background:#8883}.controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 14px 10px}.queue-navigation{display:flex;align-items:center;gap:4px;flex-shrink:0}.queue-position{min-width:7ch;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}.queue-arrow{display:grid;place-items:center;width:36px;height:36px;padding:8px;flex-shrink:0}.queue-arrow svg{display:block;width:20px;height:20px;pointer-events:none}.controls label{display:flex;align-items:center;gap:6px;margin-left:auto;white-space:nowrap;font-size:12px;cursor:pointer}.note{font-size:12px;opacity:.8;padding:0 14px 8px;margin:0}details{border-top:1px solid #8883}summary{cursor:pointer;padding:10px 14px}ol{max-height:300px;overflow:auto;padding:0 8px 8px;margin:0;list-style:none}li button{text-align:left;width:100%;border-radius:6px;padding:10px;font-size:13px;display:grid;grid-template-columns:2.5ch minmax(64px,28%) minmax(0,1fr);align-items:center;gap:8px}.queue-preview{position:relative;display:block;min-width:0}.video-duration{position:absolute;right:3px;bottom:3px;z-index:1;padding:1px 4px;border-radius:3px;background:#000d;color:#fff;font:600 11px/1.3 Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none}.video-duration.is-live{background:#b90000}.queue-thumbnail{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#8882}.entry-copy{min-width:0}.entry-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}small{display:block;font-weight:400;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.error{color:var(--yt-spec-error-indicator,#f88)}`;
  const request=(type,extra={})=>browser.runtime.sendMessage({type,...context,...extra});
  function render(){
    if(!host||!queue)return;const root=host.shadowRoot,open=root.querySelector('details')?.open,scroll=root.querySelector('ol')?.scrollTop,focus=root.activeElement?.dataset.focus;
    const card=el('div',undefined,{class:'queue'}),header=el('header');header.append(el('a',queue.groupName,{href:'/feed/subscriptions#ledger-group='+encodeURIComponent(queue.groupId)}),button('×',async()=>{stopPlaybackStart();await request('groupQueue:close');closed=true;queue=null;stopDurations();host?.remove();},{'aria-label':'Close group queue'}));card.append(header);
    const controls=el('div',undefined,{class:'controls'}),navigation=el('div',undefined,{class:'queue-navigation',role:'group','aria-label':'Queue navigation'}),previous=navigationButton(false,()=>go(queue.index-1)),next=navigationButton(true,()=>go(queue.index+1));previous.disabled=busy||queue.index===0;next.disabled=busy||queue.index===queue.entries.length-1;
    const label=el('label',undefined,{title:'Play the next video in this group when the current video ends'}),auto=el('input',undefined,{type:'checkbox','data-focus':'auto'});auto.checked=queue.auto;auto.disabled=busy;auto.onchange=async()=>{const value=auto.checked;if(!value)stopPlaybackStart();auto.disabled=true;try{await request('groupQueue:auto',{auto:value});queue.auto=value;note(value?'Autoplay is on for this group queue.':'Autoplay is off. Select Next to continue.');}catch(error){auto.checked=queue.auto;note(error.message,true);}finally{auto.disabled=busy;}};label.append(auto,el('span','Autoplay'));
    navigation.append(previous,el('span',(queue.index+1)+' / '+queue.entries.length,{class:'queue-position'}),next);controls.append(navigation,label);card.append(controls,el('p',queue.auto?'Autoplay is on for this group queue.':'Autoplay is off. Select Next to continue.',{class:'note',role:'status'}));
    const details=el('details');details.open=open??true;details.append(el('summary','Queue videos'));const list=el('ol');
    queue.entries.forEach((entry,index)=>{
      const item=el('li',undefined,{'data-index':String(index)}),select=button('',()=>go(index),{class:index===queue.index?'current':'','data-focus':'video-'+index,title:entry.title});select.disabled=busy;if(index===queue.index)select.setAttribute('aria-current','true');
      const image=el('img',undefined,{class:'queue-thumbnail',src:'https://i.ytimg.com/vi/'+entry.videoId+'/hqdefault.jpg',alt:'',width:'480',height:'270',loading:'lazy',decoding:'async',referrerpolicy:'no-referrer'});
      image.addEventListener('error',()=>{image.style.visibility='hidden';},{once:true});
      const preview=el('span',undefined,{class:'queue-preview'});preview.append(image,el('span',undefined,{class:'video-duration'}));
      const copy=el('span',undefined,{class:'entry-copy'});copy.append(el('span',entry.title,{class:'entry-title'}),el('small',entry.channel));
      select.append(el('span',String(index+1)),preview,copy);item.append(select);updateDuration(item,entry);list.append(item);
    });details.append(list);card.append(details);
    root.querySelector('.queue')?.remove();root.append(card);if(playbackPrompt)note(playbackPrompt);if(focus)root.querySelector('[data-focus="'+focus+'"]')?.focus({preventScroll:true});
    stopDurations();durationObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visibleRows.add(entry.target);else visibleRows.delete(entry.target);}scheduleDurations();});
    for(const row of list.children)durationObserver.observe(row);
    requestAnimationFrame(()=>{if(!list.isConnected||!details.open)return;const current=list.querySelector('.current');if(scroll!==undefined)list.scrollTop=scroll;else if(current)list.scrollTop=current.getBoundingClientRect().top-list.getBoundingClientRect().top-(list.clientHeight-current.offsetHeight)/2;});
  }
  function updateDuration(row,entry){
    const badge=row.querySelector('.video-duration'),details=entry.details,length=Ledger.videoLength(details?.duration)||Ledger.videoLength(entry.recordedDuration);
    let text=length,title=length?'Video length: '+length:'';
    if(details?.status==='live'){text='Live';title='Live now';}
    else if(details?.status==='upcoming'){text='Upcoming';title='Scheduled video';}
    else if(!length){const unavailable=details?.status==='unavailable'||durationFailures.has(entry.videoId);text=unavailable?'—':'…';title=unavailable?'Video length unavailable':'Loading video length';}
    badge.textContent=text;badge.title=title;badge.classList.toggle('is-live',details?.status==='live');
  }
  function refreshDurationBadges(){for(const row of host?.shadowRoot.querySelectorAll('li[data-index]')||[]){const entry=queue?.entries[Number(row.dataset.index)];if(entry)updateDuration(row,entry);}}
  function applyDurationCache(cache,progress){
    if(!queue)return;
    const latest=cache?new Map(Object.values(cache.channels||{}).flatMap(channel=>channel.entries||[]).map(entry=>[entry.videoId,entry.details])):null;
    for(const entry of queue.entries){
      const details=latest?.get(entry.videoId);
      if(Ledger.validVideoDetails(details)&&(!Ledger.validVideoDetails(entry.details)||details.checkedAt>=entry.details.checkedAt)){entry.details=details;durationFailures.delete(entry.videoId);}
      if(progress)entry.recordedDuration=progress.videos?.[entry.videoId]?.duration;
    }
    refreshDurationBadges();scheduleDurations();
  }
  function stopDurations(){durationObserver?.disconnect();durationObserver=null;visibleRows.clear();clearTimeout(durationTimer);}
  function scheduleDurations(){clearTimeout(durationTimer);if(!disposed&&queue)durationTimer=setTimeout(loadDurations,100);}
  async function loadDurations(){
    if(disposed||!queue||closed||durationRequest?.queue===queue||document.visibilityState!=='visible')return;
    const ids=[...visibleRows].filter(row=>row.isConnected).map(row=>queue.entries[Number(row.dataset.index)]).filter(entry=>entry&&Date.now()-(durationFailures.get(entry.videoId)||0)>60000&&Ledger.videoDetailsDue(entry.details)).map(entry=>entry.videoId).slice(0,12);
    if(!ids.length)return;
    const current={queue};durationRequest=current;
    try{
      const result=await browser.runtime.sendMessage({type:'groupFeed:details',groupId:current.queue.groupId,videoIds:ids});
      if(disposed||queue!==current.queue)return;
      for(const id of ids){const details=result?.details?.[id];if(Ledger.validVideoDetails(details)){queue.entries.find(entry=>entry.videoId===id).details=details;durationFailures.delete(id);}else durationFailures.set(id,Date.now());}
    }catch{if(queue===current.queue)ids.forEach(id=>durationFailures.set(id,Date.now()));}
    finally{if(durationRequest===current)durationRequest=null;if(!disposed&&queue===current.queue){refreshDurationBadges();scheduleDurations();}}
  }
  function durationStorageChanged(changes,area){if(area!=='local'||!queue||!changes['channelUploads:v1']&&!changes['videoProgress:v1'])return;applyDurationCache(changes['channelUploads:v1']?.newValue,changes['videoProgress:v1']?changes['videoProgress:v1'].newValue||{}:null);}
  browser.storage.onChanged.addListener(durationStorageChanged);document.addEventListener('visibilitychange',scheduleDurations);
  const durationRefresh=setInterval(scheduleDurations,60000);
  function note(message,error=false){const p=host?.shadowRoot.querySelector('[role=status]');if(p){p.textContent=message;p.classList.toggle('error',error);}}
  function stopPlaybackStart(){clearTimeout(playbackTimer);playbackStart=null;}
  function playbackStartFailed(blocked){
    stopPlaybackStart();playbackPrompt=blocked?'Your browser blocked autoplay. Press Play on the video, or allow autoplay for YouTube in your browser.':'The video could not start automatically. Press Play on the video.';
    note(playbackPrompt);
  }
  async function startPlayback(){
    const attempt=playbackStart;if(!attempt)return;
    if(disposed||closed||queue!==attempt.queue||!queue.auto||new URL(location.href).searchParams.get('v')!==context.videoId){stopPlaybackStart();return;}
    if(Date.now()>attempt.deadline){playbackStartFailed(false);return;}
    const video=document.querySelector('#movie_player video, video');
    if(!video||!video.currentSrc&&!video.getAttribute('src')&&!video.querySelector('source[src]')){playbackTimer=setTimeout(startPlayback,250);return;}
    if(!video.paused&&!video.ended){stopPlaybackStart();return;}
    // play() respects browser autoplay permissions and preserves sound settings.
    // Its promise resolves only once playback actually begins.
    attempt.tries++;
    try{await video.play();if(playbackStart===attempt)stopPlaybackStart();}
    catch(error){
      if(playbackStart!==attempt)return;
      if(error.name==='AbortError'&&attempt.tries<3){playbackTimer=setTimeout(startPlayback,250);return;}
      playbackStartFailed(error.name==='NotAllowedError');
    }
  }
  function playbackInteraction(event){
    if(!playbackStart||!event.isTrusted)return;
    const path=event.composedPath(),inPlayer=path.some(node=>node?.id==='movie_player'||node?.tagName==='VIDEO');
    const typing=path.some(node=>node?.matches?.('input,textarea,select,[contenteditable="true"]'));
    if(event.type==='pointerdown'?inPlayer||path.includes(host):!typing&&[' ','k','K','MediaPlayPause'].includes(event.key))stopPlaybackStart();
  }
  window.addEventListener('pointerdown',playbackInteraction,true);window.addEventListener('keydown',playbackInteraction,true);
  function setBusy(value){
    busy=value;const root=host?.shadowRoot;if(!root||!queue)return;
    for(const button of root.querySelectorAll('li button'))button.disabled=value;
    root.querySelector('[data-focus=previous]').disabled=value||queue.index===0;
    root.querySelector('[data-focus=next]').disabled=value||queue.index===queue.entries.length-1;
    root.querySelector('[data-focus=auto]').disabled=value;
  }
  async function go(index,automatic=false){
    if(!queue||busy||index<0||index>=queue.entries.length)return;stopPlaybackStart();setBusy(true);
    try{const current=globalThis.PlaybackSource?.read(context.videoId),result=await request('groupQueue:step',{index,automatic,previousVisitId:current?.id});if(!result?.url)throw Error('This queue expired. Open the group to start it again.');document.querySelectorAll('video').forEach(v=>v.pause());location.assign(result.url);}
    catch(error){setBusy(false);note(error.message,true);}
  }
  function mount(){
    if(disposed||closed||!queue)return;
    const target=document.querySelector('ytd-watch-flexy #secondary-inner, ytd-watch-flexy #secondary')||document.querySelector('ytd-watch-metadata')?.parentElement;
    if(!target)return;
    if(!host){host=el('div',undefined,{id:'ledger-group-queue'});const root=host.attachShadow({mode:'open'});root.append(el('style',css));render();}
    if(host.parentElement!==target)target.prepend(host);
  }
  async function sync(event){
    if(disposed)return;
    if(initialHash){const here=new URL(location.href);if(here.pathname===initialURL.pathname&&here.searchParams.get('v')===initialURL.searchParams.get('v')&&(!here.hash||here.hash===initialHash)){if(!here.hash)history.replaceState(history.state,'',here.pathname+here.search+initialHash);}else initialHash='';}
    const u=new URL(location.href),hash=new URLSearchParams(u.hash.slice(1)),next=u.pathname+u.search+u.hash;
    if(next===route){mount();return;}route=next;const version=++revision;stopPlaybackStart();playbackPrompt=false;queue=null;busy=false;closed=false;endedVideo=null;stopDurations();durationFailures.clear();host?.remove();host=null;
    context={token:hash.get('ledger-queue'),step:hash.get('ledger-step'),videoId:u.searchParams.get('v')};
    if(u.pathname!=='/watch'||!context.token||!context.step)return;
    try{
      const result=await request('groupQueue:get');if(disposed||version!==revision)return;queue=result;mount();
      if(queue?.startPlayback){playbackStart={queue,tries:0,deadline:Date.now()+30000};playbackTimer=setTimeout(startPlayback,250);}
      if(queue){const stored=await browser.storage.local.get(['channelUploads:v1','videoProgress:v1']);if(!disposed&&version===revision)applyDurationCache(stored['channelUploads:v1'],stored['videoProgress:v1']||{});}
    }catch{}
  }
  function ended(event){
    if(!queue||closed||event.target?.tagName!=='VIDEO'||document.querySelector('.ad-showing')||event.target!==document.querySelector('#movie_player video, video')||event.target===endedVideo)return;
    // Handle this explicit queue before native end-of-video handlers select a recommendation.
    document.dispatchEvent(new Event('ledger-queue-ended'));event.stopImmediatePropagation();endedVideo=event.target;
    if(queue.auto&&queue.index+1<queue.entries.length)go(queue.index+1,true);
    else{event.target.pause();note(queue.index+1===queue.entries.length?'Queue finished.':'Video finished. Select Next to continue.');}
  }
  function playing(event){
    if(event.target===endedVideo&&!event.target.ended)endedVideo=null;
    if(queue&&event.target===document.querySelector('#movie_player video, video')){stopPlaybackStart();if(playbackPrompt){playbackPrompt=false;note(queue.auto?'Autoplay is on for this group queue.':'Autoplay is off. Select Next to continue.');}}
  }
  const active=()=>!!queue&&!closed;globalThis.LedgerQueueActive=active;
  window.addEventListener('ended',ended,true);window.addEventListener('playing',playing,true);
  document.addEventListener('yt-navigate-finish',sync);window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);
  const timer=setInterval(sync,1000);sync();
  document.addEventListener(disposeEvent,()=>{disposed=true;revision++;clearInterval(timer);stopPlaybackStart();window.removeEventListener('pointerdown',playbackInteraction,true);window.removeEventListener('keydown',playbackInteraction,true);stopDurations();clearInterval(durationRefresh);browser.storage.onChanged.removeListener(durationStorageChanged);document.removeEventListener('visibilitychange',scheduleDurations);host?.remove();window.removeEventListener('ended',ended,true);window.removeEventListener('playing',playing,true);document.removeEventListener('yt-navigate-finish',sync);window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync);if(globalThis.LedgerQueueActive===active)delete globalThis.LedgerQueueActive;},{once:true});
})();
