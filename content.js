(() => {
  let prior, session, identity, queue = [], enabled = true;
  browser.storage.local.get('paused').then(x => { enabled = !x.paused; });
  browser.storage.onChanged.addListener(changes => {
    if (changes.paused) { enabled = !changes.paused.newValue; prior = undefined; }
  });
  function snapshot() {
    const u = new URL(location.href);
    const videoId = u.searchParams.get('v') || (/^\/shorts\/([^/?]+)/.exec(u.pathname)||[])[1] || '';
    const v = document.querySelector('video');
    const key = videoId || 'browse';
    if (identity !== key) { identity = key; session = crypto.randomUUID(); }
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const ad = !!document.querySelector('.ad-showing');
    return {
      id:session, videoId,
      title:videoId ? (document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '')) : 'Browsing YouTube',
      channel:document.querySelector('ytd-watch-metadata #channel-name a, #owner #channel-name a')?.textContent?.trim() || '',
      url: videoId ? `https://www.youtube.com/${u.pathname.startsWith('/shorts/') ? 'shorts/'+encodeURIComponent(videoId) : 'watch?v='+encodeURIComponent(videoId)}` : 'https://www.youtube.com/',
      wall:Date.now(), mono:performance.now(), position:v?.currentTime || 0,
      playing:!!v && !v.paused && !v.ended && !v.seeking && v.readyState >= 3,
      rate:v?.playbackRate || 1, audio:!!v && !v.muted && v.volume > 0, focused, ad
    };
  }
  function tick() {
    const now = snapshot();
    if (enabled && prior && prior.id === now.id) {
      const elapsed = now.mono-prior.mono;
      const delta = now.position-prior.position;
      // Ignore sleep, suspended timers, seeking and intervals without playback progress.
      if (elapsed > 0 && elapsed <= 5000 && Math.abs(now.wall-prior.wall-elapsed) < 1000) {
        const progressed = prior.playing && delta > 0 && delta <= elapsed/1000*prior.rate+0.75;
        let state = prior.ad ? 'ad' : !prior.videoId ? 'browsing' : !progressed ? 'paused' : prior.focused ? 'foreground' : prior.audio ? 'backgroundAudio' : 'backgroundSilent';
        // A parked, paused tab is not activity. Actual background playback still counts.
        if (!(['browsing','paused','ad'].includes(state) && !prior.focused)) queue.push({...prior, start:now.wall-elapsed, end:now.wall, state});
      }
    }
    prior = now;
    if (queue.length >= 5) flush();
  }
  function flush() {
    if (!queue.length) return;
    const events = queue; queue = [];
    browser.runtime.sendMessage({type:'events', events}).catch(() => {
      // A reload/uninstall can invalidate this script. Do not retry and double count.
    });
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {tick(); flush();});
  window.addEventListener('pagehide', () => {tick(); flush();});
  window.addEventListener('focus', tick);
  window.addEventListener('blur', tick);
  document.addEventListener('yt-navigate-finish', () => {tick(); flush();});
  tick();
})();
