/* Pure aggregation shared by the extension and tests. */
globalThis.Ledger = (() => {
  const states = ['foreground', 'backgroundAudio', 'backgroundSilent', 'paused', 'browsing', 'ad'];
  const labels = ['Unsorted', 'Work', 'Learning', 'Leisure', 'Background', 'Unplanned'];
  const defaults = {theme:'retrowave', hideRecommendations:true, resetOnNavigate:true, showHeaderButton:true, showPausedOnly:false, shortMinutes:3, reviewPreference:''};
  function settings(value = {}) {
    const result = {...defaults};
    if (['retrowave','classic'].includes(value?.theme)) result.theme=value.theme;
    for (const key of ['hideRecommendations','resetOnNavigate','showHeaderButton','showPausedOnly']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
    if (Number.isInteger(value?.shortMinutes) && value.shortMinutes>=1 && value.shortMinutes<=30) result.shortMinutes=value.shortMinutes;
    // Clear the former built-in prompt; keep other saved prompts unchanged.
    const legacyPrompt='I want to avoid random YouTube recommendations and choose other activities for leisure. Help me be thoughtful about revealing recommendations.';
    if (typeof value?.reviewPreference === 'string' && value.reviewPreference !== legacyPrompt) result.reviewPreference=value.reviewPreference.slice(0,2000);
    return result;
  }
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function pieces(event) {
    const result = [];
    let start = event.start;
    while (start < event.end) {
      const next = new Date(start); next.setHours(24,0,0,0);
      const end = Math.min(event.end, next.getTime());
      result.push({...event, start, end, day: dayKey(start)}); start = end;
    }
    return result;
  }
  function add(rows, e) {
    if (!states.includes(e.state) || !Number.isFinite(e.start) || !Number.isFinite(e.end) || e.end <= e.start || e.end-e.start > 5000) return;
    let row = rows.find(r => r.id === e.id);
    if (!row) {
      row = {id:e.id, videoId:e.videoId, title:e.title, channel:e.channel, url:e.url, start:e.start, end:e.end, label:'Unsorted', seconds:Object.fromEntries(states.map(s=>[s,0]))};
      rows.push(row);
    }
    row.end = Math.max(row.end,e.end);
    if (e.title) row.title = e.title;
    if (e.channel) row.channel = e.channel;
    row.seconds[e.state] += (e.end-e.start)/1000;
  }
  function group(rows, purposes = {}, options = {}) {
    const groups = new Map();
    for (const row of rows) {
      const playback = row.seconds.foreground + row.seconds.backgroundAudio + row.seconds.backgroundSilent;
      if (row.videoId ? (playback <= 0 && !options.showPausedOnly) : row.seconds.browsing <= 0) continue;
      const key = row.videoId ? 'video:'+row.videoId : 'browsing';
      let item = groups.get(key);
      if (!item) {
        item = {...row, key, title:row.videoId ? row.title : 'Browsing YouTube', channel:row.videoId ? row.channel : '', seconds:Object.fromEntries(states.map(s=>[s,0])), sessionIds:[], purposes:new Set()};
        groups.set(key,item);
      }
      item.start=Math.min(item.start,row.start); item.end=Math.max(item.end,row.end);
      item.sessionIds.push(row.id);
      if (row.label && row.label !== 'Unsorted') item.purposes.add(row.label);
      for (const state of states) item.seconds[state] += row.seconds[state] || 0;
    }
    return [...groups.values()].map(item=>{
      item.label=purposes[item.key] || (item.purposes.size>1 ? 'Mixed' : [...item.purposes][0] || 'Unsorted');
      delete item.purposes;
      return item;
    });
  }
  return {states, labels, dayKey, pieces, add, group, defaults, settings};
})();
