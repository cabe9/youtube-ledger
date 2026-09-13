/* User-selected Watch Later cleanup through YouTube's native menu. No account API or background deletion. */
(()=>{
  if(location.hostname!=='www.youtube.com')return;
  const disposeEvent='ledger-watch-later-dispose';document.dispatchEvent(new Event(disposeEvent));
  document.querySelectorAll('#ledger-watch-later-tools,#ledger-watch-later-style,.ledger-watch-later-choice').forEach(node=>node.remove());
  let disposed=false,host,styleNode,controls,selecting=false,anchor=null,job=null,timer,layoutFrame,progress={videos:{}},progressReady=false,loadingProgress=false,message='';
  const selected=new Set(),choices=new Map(),page=()=>location.pathname==='/playlist'&&new URL(location.href).searchParams.get('list')==='WL';
  const visible=node=>!!node?.isConnected&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
  const lists=()=>[...document.querySelectorAll('ytd-playlist-video-list-renderer')].filter(visible);
  const list=()=>page()?lists()[0]:null;
  function identity(row){
    const link=row.querySelector('a#video-title[href],a[href*="/watch?"]');
    try{const url=new URL(link.href);return url.origin===location.origin&&url.pathname==='/watch'&&/^[-\w]{11}$/.test(url.searchParams.get('v')||'')?url.searchParams.get('v'):null;}catch{return null;}
  }
  const rows=()=>[...(list()?.querySelectorAll('ytd-playlist-video-renderer')||[])].filter(row=>visible(row)&&identity(row));
  const thumbnail=row=>row?.querySelector('ytd-thumbnail,a#thumbnail,yt-thumbnail-view-model,img');
  // Match the native thumbnail/filter inset instead of guessing a desktop-only margin.
  // Checkboxes occupy the number gutter so enabling selection never shifts the videos.
  function align(){
    layoutFrame=null;if(disposed||!host?.isConnected)return;
    const first=rows()[0],thumb=thumbnail(first),box=host.getBoundingClientRect();
    if(thumb){const rect=thumb.getBoundingClientRect(),rtl=getComputedStyle(host).direction==='rtl';host.style.paddingInlineStart=Math.max(0,Math.min(box.width-32,rtl?box.right-rect.right:rect.left-box.left))+'px';}
    for(const [row,item] of choices){
      if(item.host.hidden)continue;
      const candidate=row.querySelector('#index'),indexRect=candidate?.getBoundingClientRect(),index=indexRect?.width&&indexRect.height?candidate:null,target=index||thumbnail(row);if(!target)continue;
      const rect=target.getBoundingClientRect(),rowRect=row.getBoundingClientRect();
      item.host.style.left=(rect.left-rowRect.left-row.clientLeft+(index?(rect.width-32)/2:getComputedStyle(row).direction==='rtl'?rect.width-36:4))+'px';
      item.host.style.top=(rect.top-rowRect.top-row.clientTop+(index?(rect.height-32)/2:4))+'px';
      item.host.classList.toggle('on-thumbnail',!index);
    }
  }
  function scheduleAlign(){if(!disposed&&!layoutFrame)layoutFrame=requestAnimationFrame(align);}
  const resizeObserver=new ResizeObserver(scheduleAlign);
  function clearSelection(){selected.clear();anchor=null;}
  function choose(id,checked,range){
    if(job)return;
    const ordered=rows().map(identity),start=ordered.indexOf(anchor),end=ordered.indexOf(id);
    if(end<0)return;
    const targets=range&&start>=0?ordered.slice(Math.min(start,end),Math.max(start,end)+1):[id];
    for(const target of targets)checked?selected.add(target):selected.delete(target);
    if(!range||start<0)anchor=id;
    for(const item of choices.values())item.input.checked=selected.has(item.id);
    updateTools();
  }
  function watched(row){
    const state=WatchStatus.entry(progress,identity(row));if(state?.manual==='unwatched')return false;
    if(WatchStatus.state(state)==='watched')return true;
    if(state?.externalIgnored)return false;
    const width=row.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress')?.style.width;
    return typeof width==='string'&&/^\d+(?:\.\d+)?%$/.test(width)&&parseFloat(width)>=90&&parseFloat(width)<=100;
  }
  const css=`:host{color:var(--yt-spec-text-primary,#0f0f0f);font:14px/1.4 Roboto,Arial,sans-serif}*{box-sizing:border-box}button{font:inherit;color:inherit;background:var(--yt-spec-badge-chip-background,rgba(128,128,128,.15));border:0;border-radius:20px;padding:9px 14px;cursor:pointer;white-space:nowrap}button:hover{background:var(--yt-spec-button-chip-background-hover,rgba(128,128,128,.25))}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid currentColor;outline-offset:3px}input{accent-color:var(--yt-spec-text-primary,#606060);cursor:pointer}button[hidden],[hidden]{display:none!important}`;
  function make(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  function button(text,action){const node=make('button',text);node.type='button';node.addEventListener('click',action);return node;}
  function ensureTools(container){
    if(!host){
      host=make('div');host.id='ledger-watch-later-tools';host.style.cssText='display:block;box-sizing:border-box;width:100%;margin:12px 0;';
      styleNode=make('style','ytd-playlist-video-renderer:has(> .ledger-watch-later-choice){position:relative}ytd-playlist-video-renderer:has(> .ledger-watch-later-choice:not([hidden])) #index{visibility:hidden}');styleNode.id='ledger-watch-later-style';document.documentElement.append(styleNode);
      const root=host.attachShadow({mode:'open'}),style=make('style',css+'.tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.count{font-size:13px;margin:0 4px}.note{font-size:12px;opacity:.8;margin:8px 4px 0}.status{margin:8px 4px 0;font-size:13px}.status:empty{display:none}');root.append(style);
      const tools=make('div');tools.className='tools';tools.setAttribute('role','group');tools.setAttribute('aria-label','Watch Later cleanup');
      controls={start:button('Select videos',()=>{selecting=true;message='';mount();}),watched:button('Select watched',()=>{selecting=true;anchor=null;for(const row of rows())if(watched(row))selected.add(identity(row));message=selected.size?'':'No watched videos found among the loaded rows.';mount();}),all:button('Select loaded',()=>{anchor=null;for(const row of rows())selected.add(identity(row));mount();}),clear:button('Clear selection',()=>{clearSelection();mount();}),remove:button('Remove selected',removeSelected),done:button('Done',()=>{selecting=false;clearSelection();message='';mount();}),cancel:button('Cancel',()=>cancel()),count:make('span'),status:make('p'),note:make('p','Click the first checkbox, then Shift-click the last to select a range. Scroll to load more videos.')};
      controls.watched.title='Select loaded videos marked watched in Ledger or at least 90% complete on YouTube. A manual Unwatched status takes priority.';
      controls.count.className='count';controls.status.className='status';controls.status.setAttribute('role','status');controls.note.className='note';
      tools.append(controls.start,controls.watched,controls.all,controls.clear,controls.count,controls.remove,controls.done,controls.cancel);root.append(tools,controls.note,controls.status);
    }
    if(host.parentElement!==container.parentElement||host.nextElementSibling!==container)container.before(host);
  }
  function updateTools(){
    if(!controls)return;
    controls.start.hidden=selecting||!!job;controls.watched.hidden=!!job;
    controls.watched.disabled=!progressReady;
    for(const name of ['all','clear','done','remove','count'])controls[name].hidden=!selecting||!!job;
    controls.cancel.hidden=!job;controls.note.hidden=!selecting||!!job;
    controls.count.textContent=selected.size+' selected';controls.remove.textContent='Remove selected'+(selected.size?' ('+selected.size+')':'');controls.remove.disabled=!selected.size;controls.clear.disabled=!selected.size;
    controls.status.textContent=message;
  }
  function mount(){
    if(disposed)return;const container=list();
    if(!container){cancel(true);host?.remove();resizeObserver.disconnect();for(const {host:choice} of choices.values())choice.remove();choices.clear();clearSelection();selecting=false;return;}
    if(!progressReady&&!loadingProgress){
      loadingProgress=true;
      browser.storage.local.get([WatchStatus.key,WatchEvidence.key]).then(value=>{if(!disposed){progress={...value[WatchStatus.key],evidence:value[WatchEvidence.key]?.videos||{}};progressReady=true;mount();}}).catch(()=>{if(!disposed){progressReady=true;message='Ledger watch status is unavailable. YouTube’s progress bars can still be used.';mount();}});
    }
    ensureTools(container);const current=rows(),ids=new Set(current.map(identity));
    for(const id of selected)if(!ids.has(id))selected.delete(id);
    if(!ids.has(anchor))anchor=null;
    for(const [row,item] of choices)if(!current.includes(row)||item.id!==identity(row)){item.host.remove();choices.delete(row);}
    for(const row of current){
      const id=identity(row);let item=choices.get(row);
      if(!item){
        const choice=make('span');choice.className='ledger-watch-later-choice';choice.style.cssText='position:absolute;z-index:1;width:32px;height:32px;';const root=choice.attachShadow({mode:'open'});
        root.append(make('style',css+':host{display:flex;align-items:center;justify-content:center}:host(.on-thumbnail){background:var(--yt-spec-base-background,#fff);border-radius:6px}:host([hidden]){display:none!important}input{width:18px;height:18px;margin:7px}'));
        const input=make('input');input.type='checkbox';input.title='Shift-click to select a range';input.addEventListener('click',event=>choose(id,input.checked,event.shiftKey));root.append(input);
        for(const type of ['click','keydown','keypress','keyup'])choice.addEventListener(type,event=>event.stopPropagation());
        row.prepend(choice);item={host:choice,input,id};choices.set(row,item);
      }
      item.host.hidden=!selecting;item.input.disabled=!!job;item.input.checked=selected.has(id);item.input.setAttribute('aria-label','Select '+(row.querySelector('#video-title')?.textContent.trim()||'video'));
    }
    updateTools();resizeObserver.disconnect();resizeObserver.observe(container);if(container.parentElement)resizeObserver.observe(container.parentElement);if(current[0])resizeObserver.observe(current[0]);if(thumbnail(current[0]))resizeObserver.observe(thumbnail(current[0]));scheduleAlign();
  }
  function cancel(leaveMenu=false){if(job){job.cancelled=true;if(leaveMenu)job.menu=null;}}
  function guard(current){if(disposed||job!==current||current.cancelled||!page()||document.visibilityState!=='visible')throw new Error('Stopped.');}
  const menus=()=>[...document.querySelectorAll('ytd-menu-popup-renderer,yt-list-view-model[role="menu"],[role="menu"]')].filter(visible);
  const normalize=text=>(text||'').replace(/[\u200e\u200f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  async function until(current,read,ms=6000){
    const end=Date.now()+ms;
    while(Date.now()<end){guard(current);const result=read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}
    throw new Error('YouTube did not confirm the change. Check the list before trying again.');
  }
  async function removeOne(current,id){
    guard(current);const row=rows().find(row=>identity(row)===id);if(!row)throw new Error('The list changed. Review the remaining selection before trying again.');
    if(menus().length)throw new Error('Close YouTube’s open menu, then try again.');
    const opener=row.querySelector('ytd-menu-renderer button, ytd-menu-renderer [role="button"]');
    if(!opener||!visible(opener))throw new Error('YouTube’s video menu is unavailable.');
    row.scrollIntoView({block:'nearest'});guard(current);opener.click();
    const menu=await until(current,()=>menus()[0]);current.menu=menu;
    const action=await until(current,()=>[...menu.querySelectorAll('ytd-menu-service-item-renderer,yt-list-item-view-model,[role="menuitem"]')].find(node=>visible(node)&&normalize(node.textContent)==='remove from watch later'),2000).catch(error=>{guard(current);throw new Error('Could not identify “Remove from Watch later.” The current YouTube layout or language is not supported.');});
    guard(current);if(!row.isConnected||identity(row)!==id||!visible(menu))throw new Error('The list changed. Nothing else was removed.');
    current.sent=id;action.click();await until(current,()=>!rows().some(row=>identity(row)===id));
    // YouTube owns the actual deletion and UI. Never hide a row to simulate success.
    await new Promise(resolve=>setTimeout(resolve,350));guard(current);
    if(rows().some(row=>identity(row)===id))throw new Error('YouTube restored that video. Check the list before trying again.');
    current.menu=null;current.sent=null;
  }
  async function removeSelected(){
    if(job||!page()||!selected.size)return;
    const current={cancelled:false,ids:[...selected],removed:0};job=current;const top=window.scrollY;
    try{
      for(const id of current.ids){message='Removing '+(current.removed+1)+' of '+current.ids.length+'…';mount();await removeOne(current,id);current.removed++;selected.delete(id);}
      message='Removed '+current.removed+' '+(current.removed===1?'video':'videos')+' from Watch Later.';
    }catch(error){
      if(current.sent&&page()&&list()&&!rows().some(row=>identity(row)===current.sent)){current.removed++;selected.delete(current.sent);current.sent=null;}
      message=(current.removed?'Removed '+current.removed+'. ':'')+(current.cancelled?'Stopped. No further removals will be started.':error.message)+(current.sent?' A removal was sent to YouTube; check its result before retrying.':'');
    }
    finally{
      if(current.menu&&visible(current.menu))document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
      if(job===current)job=null;if(!disposed){if(page()&&!current.cancelled)window.scrollTo({top,behavior:'instant'});mount();}
    }
  }
  function userInput(event){if(job&&event.isTrusted&&!event.composedPath().includes(host))cancel(true);}
  for(const type of ['pointerdown','keydown','wheel'])window.addEventListener(type,userInput,true);
  const heldKeys=new Set();
  function protectKeys(event){
    const inside=event.composedPath().some(node=>node===host||node?.classList?.contains('ledger-watch-later-choice')),key=event.code||event.key,protect=inside||heldKeys.has(key);
    if(inside&&event.type==='keydown'){heldKeys.add(key);if(event.key==='Escape')cancel();}
    if(event.type==='keyup')heldKeys.delete(key);if(protect)event.stopImmediatePropagation();
  }
  for(const type of ['keydown','keypress','keyup'])window.addEventListener(type,protectKeys,true);
  function schedule(){clearTimeout(timer);timer=setTimeout(mount,100);}
  const observer=new MutationObserver(schedule);observer.observe(document,{subtree:true,childList:true});
  function navigation(){cancel(true);clearSelection();selecting=false;message='';schedule();}
  document.addEventListener('yt-navigate-start',navigation);document.addEventListener('yt-navigate-finish',schedule);window.addEventListener('popstate',navigation);
  function visibility(){if(document.visibilityState!=='visible')cancel(true);}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('resize',scheduleAlign);
  function changed(changes,area){if(area==='local'&&(changes[WatchStatus.key]||changes[WatchEvidence.key])){progress={...(changes[WatchStatus.key]?changes[WatchStatus.key].newValue:progress),evidence:changes[WatchEvidence.key]?changes[WatchEvidence.key].newValue?.videos||{}:progress.evidence};progressReady=true;schedule();}}
  browser.storage.onChanged.addListener(changed);schedule();
  document.addEventListener(disposeEvent,()=>{
    disposed=true;cancel(true);clearTimeout(timer);cancelAnimationFrame(layoutFrame);observer.disconnect();resizeObserver.disconnect();host?.remove();styleNode?.remove();for(const item of choices.values())item.host.remove();choices.clear();
    for(const type of ['pointerdown','keydown','wheel'])window.removeEventListener(type,userInput,true);
    for(const type of ['keydown','keypress','keyup'])window.removeEventListener(type,protectKeys,true);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('resize',scheduleAlign);
    document.removeEventListener('yt-navigate-start',navigation);document.removeEventListener('yt-navigate-finish',schedule);window.removeEventListener('popstate',navigation);browser.storage.onChanged.removeListener(changed);
  },{once:true});
})();
