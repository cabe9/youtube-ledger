/* Small additions to the existing dashboard; cached rendering never waits on a
 * history source. Sync only on view entry, visibility entry, manual action, or
 * review export. Existing five-second local rendering does not trigger sync. */
globalThis.AccountHistoryUI = (() => {
  const {keys,minute}=AccountHistory;
  const el=id=>document.getElementById(id);
  let config={},cache={},status={},refreshPromise=null,loadRevision=0;
  let dayProjection=AccountHistory.project(),periodProjection=AccountHistory.project();
  const stamp=value=>value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'Never';
  const time=value=>new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const estimate=value=>value===null ? 'Estimate unavailable' : `~${Math.round(value*10)/10} min`;
  function controls() {
    el('cross-device-enabled').checked=!!config.enabled;
    const busy=!!status.syncing && Date.now()-(status.startedAt || 0)<75000;
    const coolingDown=Date.now()<AccountHistory.nextAllowedAt(cache,status,true);
    el('cross-device-sync').disabled=!config.enabled || busy || !!refreshPromise || coolingDown;
    el('cross-device-check-missing').disabled=el('cross-device-sync').disabled;
    el('cross-history-progress').hidden=!busy;
    el('cross-history-phase').textContent=status.phase || 'Refreshing cross-device history…';
    el('cross-history-manual-note').textContent=coolingDown ? `Manual check available after ${stamp(AccountHistory.nextAllowedAt(cache,status,true))}.` : 'Checks up to 300 recent entries. Available once every 20 minutes.';
    const coverage=cache.coverage || {};
    el('cross-history-coverage').textContent=cache.lastSuccessfulSync ? `Checked ${coverage.googleCardCount || 0} entries in ${coverage.batchesRead || 1} ${coverage.batchesRead>1?'batches':'batch'}. ${coverage.stopReason==='source-ended'?'Google returned no continuation.':'Additional history may be available.'} ${coverage.overlapCount || 0} events matched earlier recovered imports.${coverage.unclassifiedCount?' '+coverage.unclassifiedCount+' watch entries could not be matched to YouTube’s recent history.':''} Google may delay or omit entries; this does not establish complete coverage.` : '';
    el('cross-device-last-sync').textContent=stamp(cache.lastSuccessfulSync);
    el('cross-device-last-count').textContent=String(cache.lastRecoveredCount || 0);
    const next=coolingDown ? ` Next eligible refresh: ${stamp(AccountHistory.nextAllowedAt(cache,status,true))}.` : '';
    const retryNote=status.manualRetry ? (coolingDown ? `Automatic sync stays paused. A manual retry is available after ${stamp(AccountHistory.nextAllowedAt(cache,status,true))}.` : 'Automatic sync stays paused. Use a manual check when you are ready to retry.') : `The next automatic check is eligible after ${stamp(AccountHistory.nextAllowedAt(cache,status))}.`;
    const warning=status.error ? `Cross-device history could not refresh. ${status.error} Cached history is kept. ${retryNote}` : '';
    el('cross-history-warning').hidden=!config.enabled || busy || !warning;
    el('cross-history-warning').textContent=warning;
    el('cross-device-status').textContent=busy ? 'Refreshing cross-device history…' : !config.enabled ? 'Off. Previously recovered history stays saved locally.' :
      warning || 'Checks at most once a day when History opens. Use a manual check after watching on another device.'+next;
  }
  async function reload(redraw=true) {
    const revision=++loadRevision;
    const data=await browser.storage.local.get(Object.values(keys));
    if (revision!==loadRevision) return;
    config=data[keys.config] || {};cache=data[keys.cache] || {};status=data[keys.status] || {};
    controls();
    if (redraw) await Promise.all([render(),renderTrends()]);
  }
  async function refresh(maxAgeMs=AccountHistory.minimumSyncInterval,force=false) {
    if (refreshPromise) return refreshPromise;
    refreshPromise=(async()=>{
      await reload(false);
      if (!config.enabled || (!force && !AccountHistory.stale(cache.lastSuccessfulSync,maxAgeMs))) return;
      const joining=!!status.syncing && Date.now()-(status.startedAt || 0)<75000;
      if (!joining && (Date.now()<AccountHistory.nextAllowedAt(cache,status,force) || (status.manualRetry && !force))) return;
      try {
        const response=await browser.runtime.sendMessage({type:'accountHistory:sync',force});
        if (response?.accountHistoryError) throw new Error(response.accountHistoryError);
        await reload();
        if (response?.error) { status.error=response.error;controls(); }
      } catch (error) {
        status={...status,syncing:false,error:String(error.message || error)};controls();
      }
    })().finally(()=>{refreshPromise=null;controls();});
    return refreshPromise;
  }
  function renderDay(selected,directRows) {
    controls();
    dayProjection=AccountHistory.project(cache,directRows,[selected]);
    const panel=el('cross-device-history');
    panel.hidden=!config.enabled && !dayProjection.events.length;
    el('cross-device-history-note').textContent=`Synced account history · last successful sync ${stamp(cache.lastSuccessfulSync)}. Shorts time is estimated; normal-video watch duration is unavailable.`;
    const body=el('cross-device-rows');
    const opened=new Set([...body.querySelectorAll('details[open]')].map(item=>item.dataset.session));
    // Preserve focus and expanded sessions across existing local refreshes.
    if (body.contains(document.activeElement) && document.activeElement.tagName==='A') return;
    const focused=body.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.session : null;
    body.replaceChildren();
    const events=new Map(dayProjection.events.map(event=>[event.id,event]));
    const items=[...dayProjection.sessions.map(session=>({at:session.startTime,session})),...dayProjection.events.filter(e=>e.mediaType==='video').map(event=>({at:event.watchedAt,event}))].sort((a,b)=>b.at-a.at);
    for (const item of items) {
      const row=document.createElement('tr');
      if (item.session) {
        const session=item.session,cell=document.createElement('td');cell.colSpan=3;
        const details=document.createElement('details');details.dataset.session=session.id;details.open=opened.has(session.id);
        const summary=document.createElement('summary');
        const title=document.createElement('span');title.textContent=`${session.eventCount} recovered ${session.eventCount===1?'Short':'Shorts'}`;
        const span=document.createElement('span');span.textContent=`${time(session.startTime)}–${time(session.endTime)}`;
        const value=document.createElement('span');value.textContent=`${estimate(session.estimatedActiveMinutes)} · estimated${session.device?' · '+session.device:''}`;
        summary.append(title,span,value);
        const note=document.createElement('p');note.className='note';note.textContent='Estimated from synced history using video lengths and minute-level timestamps. Seeking, quick skips, and replays can change actual watch time.';
        const list=document.createElement('ul');list.className='cross-short-list';
        for (const id of session.eventIds) {
          const event=events.get(id);if (!event) continue;
          const li=document.createElement('li'),link=videoLink(event),meta=document.createElement('small');
          meta.textContent=`${time(event.watchedAt)} · ${event.channelName || 'Channel unavailable'} · ${event.videoDurationSeconds==null?'Video length unavailable':'Video length '+duration(event.videoDurationSeconds)}${event.device?' · '+event.device:''}`;
          li.append(link,meta);list.append(li);
        }
        details.append(summary,note,list);cell.append(details);row.append(cell);
      } else {
        const event=item.event,cell=document.createElement('td'),meta=document.createElement('small');
        meta.textContent=event.channelName || 'Channel unavailable';cell.append(videoLink(event),meta);row.append(cell);
        for (const value of [time(event.watchedAt),'Watch duration unavailable'+(event.device?' · '+event.device:'')]) {
          const td=document.createElement('td');td.textContent=value;row.append(td);
        }
      }
      body.append(row);
    }
    el('cross-device-empty').hidden=items.length>0;
    if (focused) [...body.querySelectorAll('details')].find(item=>item.dataset.session===focused)?.querySelector('summary')?.focus({preventScroll:true});
  }
  function videoLink(event) {
    const link=document.createElement('a');link.textContent=event.title;link.href=event.url;link.target='_blank';link.rel='noopener noreferrer';return link;
  }
  function renderPeriod(directRows,days) {
    periodProjection=AccountHistory.project(cache,directRows,days);
    el('cross-device-overview').hidden=!config.enabled && !periodProjection.events.length;
    el('cross-device-shorts-total').textContent=estimate(periodProjection.recoveredShortCount>0 && periodProjection.unestimatedShortCount===periodProjection.recoveredShortCount ? null : periodProjection.estimatedShortsMinutes);
    el('cross-device-shorts-count').textContent=`${periodProjection.recoveredShortCount} recovered Shorts · estimated from synced history${periodProjection.unestimatedShortCount?' · '+periodProjection.unestimatedShortCount+' excluded from time estimate (missing lengths)':''}`;
    el('cross-device-videos-total').textContent=String(periodProjection.recoveredVideoCount);
    el('cross-device-videos-note').textContent='Recovered normal-video events · watch duration unavailable';
  }
  function report(projection=dayProjection) {
    return {trackingMethod:'account-history',experimental:true,minimumSyncIntervalMs:AccountHistory.minimumSyncInterval,manualSyncIntervalMs:AccountHistory.manualSyncInterval,nextEligibleRefresh:AccountHistory.nextAllowedAt(cache,status),enabled:!!config.enabled,lastSuccessfulSync:cache.lastSuccessfulSync || null,
      lastSuccessfulSyncISO:cache.lastSuccessfulSync ? new Date(cache.lastSuccessfulSync).toISOString() : null,
      lastRefreshError:status.error || null,coverage:cache.coverage || null,estimationModel:AccountHistory.model,
      recoveredEvents:projection.events,shortsSessions:projection.sessions,estimatedShortsMinutes:projection.estimatedShortsMinutes,
      unestimatedShortCount:projection.unestimatedShortCount,
      recoveredNormalVideoCount:projection.recoveredVideoCount,
      measurementNotes:['Direct playback totals remain authoritative and exclude these estimates.',
        'Only recovered Shorts receive an estimate. Consecutive Shorts join when the next timestamp is within previous video duration plus one minute. Normal videos and directly matched watches break sessions.',
        'Estimated active time is the union of full-video intervals starting at minute-rounded watch timestamps. Overlap is counted once; idle gaps are excluded. Missing lengths remain unestimated. This is not measured playback.',
        'Normal-video lengths are metadata only; watch duration is unavailable. Devices are recorded only when the source explicitly provides them. Minute-level overlap may hide an indistinguishable simultaneous rewatch.']};
  }
  async function refreshForReview() {
    await reload(false);
    const inProgress=refreshPromise || (status.syncing && Date.now()-(status.startedAt || 0)<75000);
    if (config.enabled && (inProgress || (AccountHistory.stale(cache.lastSuccessfulSync,5*minute) && Date.now()>=AccountHistory.nextAllowedAt(cache,status) && !status.manualRetry))) {
      el('cross-review-status').textContent='Refreshing cross-device history…';
      // Join a read already underway, even if its persisted daily budget would
      // block a new one. The background owns the single shared flight.
      await refresh(inProgress ? 0 : 5*minute);
    }
    el('cross-review-status').textContent=config.enabled && (status.error || AccountHistory.stale(cache.lastSuccessfulSync,5*minute)) ?
      `Using cached history. Last successful sync: ${stamp(cache.lastSuccessfulSync)}. ${status.error ? 'Refresh failed; see the warning in History or Settings.' : 'Automatic checks run at most daily; you can request a manual check in History.'}` : '';
  }
  el('cross-device-enabled').addEventListener('change',async event=>{
    const enabled=event.target.checked;
    event.target.disabled=true;
    try {
      // Request directly in the click's user gesture, before any async work.
      if (enabled && !await browser.permissions.request({origins:['https://myactivity.google.com/*']})) throw new Error('Permission was not granted. Cross-device history remains off.');
      const response=await browser.runtime.sendMessage({type:'accountHistory:configure',enabled});
      if (response?.accountHistoryError) throw new Error(response.accountHistoryError);
      await reload();
      if (enabled) await refresh(AccountHistory.minimumSyncInterval);
    } catch (error) {
      await reload(false);el('cross-device-status').textContent=String(error.message || error);
    } finally {event.target.disabled=false;}
  });
  el('cross-device-sync').addEventListener('click',()=>refresh(0,true));
  el('cross-device-check-missing').addEventListener('click',()=>refresh(0,true));
  const onEntry=()=>{if (activeView==='history') void refresh();};
  window.addEventListener('ledger:viewchange',onEntry);
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) onEntry();});
  browser.storage.onChanged?.addListener((changes,area)=>{
    if (area==='local' && Object.values(keys).some(key=>Object.hasOwn(changes,key))) void reload();
  });
  // This local read completes and draws cached data before requesting refresh.
  void reload().then(onEntry).catch(console.error);
  return {renderDay,renderPeriod,report,periodReport:()=>report(periodProjection),refreshForReview,refresh};
})();
