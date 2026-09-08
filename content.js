(() => {
  document.dispatchEvent(new Event('ledger-recorder-dispose'));
  document.getElementById('ledger-recording-warning')?.remove();
  let prior, session, identity, enabled = true, disposed = false, lastProblem = -Infinity;
  const listeners=[];
  function listen(target,name,fn,capture=false){target.addEventListener(name,fn,capture);listeners.push(()=>target.removeEventListener(name,fn,capture));}
  function warning(message){
    if(disposed)return;
    let host=document.getElementById('ledger-recording-warning');
    if(!host){
      host=document.createElement('div');host.id='ledger-recording-warning';
      host.style.cssText='position:fixed;bottom:16px;left:16px;z-index:2147483647;max-width:min(430px,calc(100vw - 32px))';
      const root=host.attachShadow({mode:'open'}),style=document.createElement('style');
      style.textContent=':host{color-scheme:dark}aside{background:#202020;color:#fff;border:1px solid #a5a5a5;border-radius:12px;padding:14px;font:14px/1.5 system-ui;box-shadow:0 4px 20px #0008}p{margin:0 0 8px}button{font:inherit;color:#fff;background:transparent;border:1px solid #aaa;border-radius:6px;padding:4px 10px;cursor:pointer}button:focus-visible{outline:2px solid #fff;outline-offset:3px}';
      const box=document.createElement('aside'),text=document.createElement('p'),open=document.createElement('button');
      text.setAttribute('role','status');open.textContent='Open Ledger';open.addEventListener('click',()=>{try{browser.runtime.sendMessage({type:'recording:open'}).catch(()=>{});}catch{}});
      box.append(text,open);root.append(style,box);(document.body||document.documentElement).append(host);
    }
    host.shadowRoot.querySelector('p').textContent=message;
  }
  function report(lostSeconds=0){
    if(Date.now()-lastProblem<30000)return;lastProblem=Date.now();
    try{browser.runtime.sendMessage({type:'recording:problem',lostSeconds}).catch(()=>{});}catch{}
  }
  const buffer=RecordingBuffer({send:message=>browser.runtime.sendMessage(message),onError:error=>{
    if(disposed)return;
    if(/extension context invalidated/i.test(error.message)){warning('Ledger was reloaded. Refresh this YouTube tab to resume recording.');dispose();return;}
    warning('Ledger could not save recent activity. Keep this tab open while it retries.');
    if(!error.reported)report(buffer.lostSeconds);
  },onRecovery:()=>{if(!disposed)document.getElementById('ledger-recording-warning')?.remove();},onLoss:seconds=>{
    warning('Ledger’s recording buffer is full. Some activity could not be saved. Keep this tab open and check storage in Ledger.');report(seconds);
  }});
  browser.storage.local.get('paused').then(x => { if(!disposed)enabled = !x.paused; }).catch(()=>{});
  const storageChanged=changes=>{
    if(changes.paused){enabled=!changes.paused.newValue;prior=undefined;if(!enabled)buffer.clear();}
  };
  browser.storage.onChanged.addListener(storageChanged);
  function dispose(){disposed=true;clearInterval(timer);buffer.stop();for(const remove of listeners)remove();try{browser.storage.onChanged.removeListener(storageChanged);}catch{}}
  function snapshot() {
    const u = new URL(location.href);
    const videoId = u.searchParams.get('v') || (/^\/shorts\/([^/?]+)/.exec(u.pathname)||[])[1] || '';
    const v = document.querySelector('video');
    const entry=globalThis.PlaybackSource?.read(videoId);
    if(entry===null)return null;
    const key = (videoId || 'browse')+'|'+(entry?.id||'');
    if (identity !== key) { identity = key; session = entry?.id||crypto.randomUUID(); }
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const ad = !!document.querySelector('.ad-showing');
    // Use only this watch page's owner, never avatars from recommendation cards.
    const watch=document.querySelector('ytd-watch-flexy'),matchesWatch=u.pathname==='/watch'&&(!watch||watch.getAttribute('video-id')===videoId);
    const owner=matchesWatch?document.querySelector('ytd-watch-metadata #owner'):null;
    const channelUrl=Ledger.channelURL(owner?.querySelector('#channel-name a')?.href);
    const channelAvatarUrl=channelUrl?Ledger.avatarURL(owner?.querySelector('#avatar img')?.src):'';
    return {
      id:session, videoId, source:entry?.source, journey:entry?.journey,
      ...(channelUrl?{channelUrl,...(channelAvatarUrl?{channelAvatarUrl}:{})}:{}),
      title:videoId ? (document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '')) : 'Browsing YouTube',
      channel:document.querySelector('ytd-watch-metadata #channel-name a, #owner #channel-name a')?.textContent?.trim() || '',
      url: videoId ? `https://www.youtube.com/${u.pathname.startsWith('/shorts/') ? 'shorts/'+encodeURIComponent(videoId) : 'watch?v='+encodeURIComponent(videoId)}` : 'https://www.youtube.com/',
      wall:Date.now(), mono:performance.now(), position:v?.currentTime || 0, duration:Number.isFinite(v?.duration)?v.duration:null,
      playing:!!v && !v.paused && !v.ended && !v.seeking && v.readyState >= 3,
      rate:v?.playbackRate || 1, audio:!!v && !v.muted && v.volume > 0, focused, ad
    };
  }
  function tick() {
    if(disposed)return;
    const now = snapshot();
    if(!now){prior=undefined;return;}
    if (enabled && prior && prior.id === now.id) {
      const elapsed = now.mono-prior.mono;
      const delta = now.position-prior.position;
      // Ignore sleep, suspended timers, seeking and intervals without playback progress.
      if (elapsed > 0 && elapsed <= 5000 && Math.abs(now.wall-prior.wall-elapsed) < 1000) {
        const progressed = prior.playing && delta > 0 && delta <= elapsed/1000*prior.rate+0.75;
        let state = prior.ad ? 'ad' : !prior.videoId ? 'browsing' : !progressed ? 'paused' : prior.focused ? 'foreground' : prior.audio ? 'backgroundAudio' : 'backgroundSilent';
        // A parked, paused tab is not activity. Actual background playback still counts.
        if (!(['browsing','paused','ad'].includes(state) && !prior.focused)) buffer.add({...prior, start:now.wall-elapsed, end:now.wall, positionEnd:now.position, state});
      }
    }
    prior = now;
    void buffer.flush();
  }
  const flush=()=>void buffer.flush(true);
  listen(document,'ended',()=>{tick();flush();},true);
  listen(document,'ledger-queue-ended',()=>{tick();flush();});
  const timer=setInterval(tick,1000);
  listen(document,'visibilitychange',()=>{tick();flush();});
  listen(window,'pagehide',()=>{tick();flush();});
  listen(window,'focus',tick);
  listen(window,'blur',tick);
  listen(document,'yt-navigate-finish',()=>{tick();flush();});
  listen(document,'ledger-recorder-dispose',dispose);
  tick();
})();
