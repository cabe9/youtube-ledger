/* Pure aggregation shared by the extension and tests. */
globalThis.Ledger = (() => {
  const states = ['foreground', 'backgroundAudio', 'backgroundSilent', 'paused', 'browsing', 'ad'];
  const labels = ['Unsorted', 'Work', 'Learning', 'Leisure', 'Background', 'Unplanned'];
  const defaults = {theme:'dark-green', animateRetrowave:true, hideRecommendations:true, resetOnNavigate:true, showHeaderButton:true, showPausedOnly:false, backgroundGroupChecks:true, groupDebugMode:false, reviewPreference:''};
  const groupSorts={
    newest:{metric:'date',descending:true,label:'Newest first'},oldest:{metric:'date',descending:false,label:'Oldest first'},
    'views-desc':{metric:'views',descending:true,label:'Most views first'},'views-asc':{metric:'views',descending:false,label:'Fewest views first'},
    'rate-desc':{metric:'rate',descending:true,label:'Highest views per hour first'},'rate-asc':{metric:'rate',descending:false,label:'Lowest views per hour first'},
    'length-desc':{metric:'length',descending:true,label:'Longest first'},'length-asc':{metric:'length',descending:false,label:'Shortest first'}
  };
  const groupSort=value=>Object.hasOwn(groupSorts,value)?groupSorts[value]:groupSorts.newest;
  const groupSortKey=(metric,descending)=>Object.keys(groupSorts).find(key=>groupSorts[key].metric===metric&&groupSorts[key].descending===descending)||'newest';
  function validVideoViews(value){return !!value&&Number.isSafeInteger(value.count)&&value.count>=0&&Number.isFinite(value.checkedAt)&&value.checkedAt>=0;}
  function videoViewsDue(entry,now=Date.now()){
    const checked=Math.max(validVideoViews(entry?.views)?entry.views.checkedAt:0,entry?.details?.viewsAttemptedAt||0);
    return !checked||checked>now||now-checked>=3600000;
  }
  function avatarURL(value) {
    if (typeof value !== 'string' || value.length > 2000) return '';
    try { const u=new URL(value); return u.protocol==='https:' && ['yt3.googleusercontent.com','yt3.ggpht.com'].includes(u.hostname) && !u.username && !u.password && !u.port ? u.href : ''; } catch { return ''; }
  }
  function channelURL(value) {
    if (typeof value !== 'string' || value.length > 2000) return '';
    try { const u=new URL(value); return u.protocol==='https:' && ['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname) && !u.username && !u.password && !u.port && /^\/(channel\/UC[A-Za-z0-9_-]{22}|@[^/]+)\/?$/.test(u.pathname) ? 'https://www.youtube.com'+u.pathname.replace(/\/$/,'') : ''; } catch { return ''; }
  }
  function channelMedia(value) {
    const url=channelURL(value?.channelUrl),avatar=avatarURL(value?.channelAvatarUrl);
    return url ? {channelUrl:url,...(avatar?{channelAvatarUrl:avatar}:{})} : {};
  }
  function videoLength(seconds) {
    if(!Number.isFinite(seconds)||seconds<=0||seconds>604800)return '';
    const n=Math.max(1,Math.round(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=String(n%60).padStart(2,'0');
    return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;
  }
  function validVideoDetails(value){
    return !!value&&['available','live','upcoming','unavailable'].includes(value.status)&&Number.isFinite(value.checkedAt)&&value.checkedAt>=0&&
      (value.status==='available'?Number.isInteger(value.duration)&&value.duration>0&&value.duration<=604800:value.duration===undefined)&&
      (value.shorts===undefined||typeof value.shorts==='boolean'||value.shorts==='unknown')&&
      (value.viewsAttemptedAt===undefined||Number.isFinite(value.viewsAttemptedAt)&&value.viewsAttemptedAt>=0);
  }
  function videoDetailsDue(value,now=Date.now(),checkShorts=false){
    if(!validVideoDetails(value)||value.checkedAt>now)return true;
    if(checkShorts&&value.shorts===undefined)return true; // Upgrade cached lengths when the filter is first used.
    const ttl={available:7*86400000,live:60000,upcoming:300000,unavailable:3600000}[value.status];
    return now-value.checkedAt>=(checkShorts&&value.shorts==='unknown'?Math.min(ttl,3600000):ttl);
  }
  function settings(value = {}) {
    const result = {...defaults};
    if (['retrowave','classic','dark-green','frutiger-aero'].includes(value?.theme)) result.theme=value.theme;
    for (const key of ['animateRetrowave','hideRecommendations','resetOnNavigate','showHeaderButton','showPausedOnly','backgroundGroupChecks','groupDebugMode']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
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
      row = {id:e.id, videoId:e.videoId, title:e.title, channel:e.channel, url:e.url, start:e.start, end:e.end, source:source(e.source), journey:journey(e.journey), label:'Unsorted', seconds:Object.fromEntries(states.map(s=>[s,0]))};
      rows.push(row);
    }
    row.start = Math.min(row.start,e.start);row.end = Math.max(row.end,e.end);
    if (e.title) row.title = e.title;
    if (e.channel) row.channel = e.channel;
    const media=channelMedia(e);
    if(media.channelUrl && row.channelUrl && media.channelUrl!==row.channelUrl)delete row.channelAvatarUrl;
    Object.assign(row,media);
    row.seconds[e.state] += (e.end-e.start)/1000;
    if (['foreground','backgroundAudio','backgroundSilent'].includes(e.state)) {
      // Wall-clock coverage, not the visit's bounding span: pauses are not playback.
      const ranges=[...(row.playbackIntervals || []),[e.start,e.end]].sort((a,b)=>a[0]-b[0]),merged=[];
      for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
      // Keep gaps intact even for unusually fragmented visits. Older discarded
      // intervals cease to be evidence for matching imported watches.
      row.playbackIntervals=merged.slice(-2048);
    }
  }
  function source(value){
    const kind=['group','recommendations','search','subscriptions','watchLater','channel','autoplay'].includes(value?.kind)?value.kind:'unknown';
    const result={kind,evidence:typeof value?.evidence==='string'?value.evidence.slice(0,80):'not-observed'};
    if(kind==='group'&&typeof value.groupId==='string'&&typeof value.groupName==='string'){result.groupId=value.groupId.slice(0,100);result.groupName=value.groupName.slice(0,80);}
    else if(kind==='group')result.kind='unknown';
    if(kind==='group'&&typeof value?.queueId==='string'&&/^[-\w]{36}$/.test(value.queueId))result.queueId=value.queueId;
    return result;
  }
  const playbackSeconds=value=>['foreground','backgroundAudio','backgroundSilent'].reduce((n,s)=>n+(value?.[s]||0),0);
  const sourceKey=value=>{const s=source(value);return s.kind==='group'?'group:'+s.groupId:s.kind;};
  const sourceLabel=value=>{const s=source(value);return s.kind==='group'?'Group: '+s.groupName:({recommendations:'Recommendations',search:'Search',subscriptions:'Subscriptions',watchLater:'Watch Later',channel:'Channel page',autoplay:'Autoplay',unknown:'Source not captured'})[s.kind];};
  function journey(value){
    if(!value||typeof value.previousVisitId!=='string'||!/^[-\w]{36}$/.test(value.previousVisitId)||!/^[-\w]{11}$/.test(value.previousVideoId||'')||!['click','autoplay','queue-next','queue-previous','queue-select','queue-auto'].includes(value.transition))return null;
    return {previousVisitId:value.previousVisitId,previousVideoId:value.previousVideoId,transition:value.transition};
  }
  function sourceTotals(rows){
    const origins=new Map();
    for(const row of rows){const seconds=playbackSeconds(row.seconds);if(!row.videoId||!seconds)continue;const s=source(row.source),key=sourceKey(s);
      const item=origins.get(key)||{key,source:s,names:[],seconds:0,sessionIds:[]};
      if(s.kind==='group'&&!item.names.includes(s.groupName))item.names.push(s.groupName);
      item.seconds+=seconds;if(!item.sessionIds.includes(row.id))item.sessionIds.push(row.id);origins.set(key,item);
    }
    return [...origins.values()].sort((a,b)=>b.seconds-a.seconds||a.key.localeCompare(b.key));
  }
  function journeys(rows){
    const visits=new Map();
    for(const row of rows){if(!row.videoId)continue;const old=visits.get(row.id);
      if(old){old.start=Math.min(old.start,row.start);old.end=Math.max(old.end,row.end);old.playbackSeconds+=playbackSeconds(row.seconds);}
      else visits.set(row.id,{id:row.id,videoId:row.videoId,title:row.title,channel:row.channel,start:row.start,end:row.end,playbackSeconds:playbackSeconds(row.seconds),source:source(row.source),predecessor:journey(row.journey)});
    }
    return [...visits.values()].filter(v=>v.playbackSeconds>0).sort((a,b)=>a.start-b.start).map(v=>({...v,predecessorRecorded:!!v.predecessor&&visits.get(v.predecessor.previousVisitId)?.videoId===v.predecessor.previousVideoId}));
  }
  function relativeTime(at,now=Date.now()){
    const seconds=(at-now)/1000,abs=Math.abs(seconds);
    if(!Number.isFinite(seconds))return '';
    if(abs<60)return seconds>0?'In a moment':'Just now';
    if(abs<30*86400){const unit=abs<3600?'minute':abs<86400?'hour':'day',size={minute:60,hour:3600,day:86400}[unit];return new Intl.RelativeTimeFormat(undefined,{numeric:'always'}).format(Math.trunc(seconds/size),unit);}
    return new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }
  function group(rows, purposes = {}, options = {}) {
    const groups = new Map();
    for (const row of rows) {
      const playback = row.seconds.foreground + row.seconds.backgroundAudio + row.seconds.backgroundSilent;
      if (row.videoId ? (playback <= 0 && !options.showPausedOnly) : row.seconds.browsing <= 0) continue;
      const key = row.videoId ? 'video:'+row.videoId : 'browsing';
      let item = groups.get(key);
      if (!item) {
        item = {...row, key, title:row.videoId ? row.title : 'Browsing YouTube', channel:row.videoId ? row.channel : '', seconds:Object.fromEntries(states.map(s=>[s,0])), sources:[], sessionIds:[], purposes:new Set()};
        delete item.source;
        groups.set(key,item);
      }
      item.start=Math.min(item.start,row.start); item.end=Math.max(item.end,row.end);
      const media=channelMedia(row);
      if(media.channelUrl && (!item.channelUrl || row.end>=item.end || item.channelUrl===media.channelUrl&&!item.channelAvatarUrl)){
        if(item.channelUrl!==media.channelUrl)delete item.channelAvatarUrl;
        Object.assign(item,media);
      }
      item.sessionIds.push(row.id);
      const entry=source(row.source), sourceKey=JSON.stringify(entry);
      let origin=item.sources.find(s=>JSON.stringify(s.source)===sourceKey);
      if(!origin){origin={source:entry,sessionIds:[],seconds:Object.fromEntries(states.map(s=>[s,0]))};item.sources.push(origin);}
      origin.sessionIds.push(row.id);
      for(const state of states)origin.seconds[state]+=row.seconds[state]||0;
      if (row.label && row.label !== 'Unsorted') item.purposes.add(row.label);
      for (const state of states) item.seconds[state] += row.seconds[state] || 0;
    }
    return [...groups.values()].map(item=>{
      item.label=purposes[item.key] || (item.purposes.size>1 ? 'Mixed' : [...item.purposes][0] || 'Unsorted');
      delete item.purposes;
      return item;
    });
  }
  function datesEnding(end, count) {
    const [y,m,d]=end.split('-').map(Number);
    const cursor=new Date(y,m-1,d,12);
    if (!Number.isFinite(cursor.getTime()) || dayKey(cursor)!==end) return [];
    const days=[];
    for(let i=0;i<count;i++){days.unshift(dayKey(cursor));cursor.setDate(cursor.getDate()-1);}
    return days;
  }
  function trendReport(data, end, count) {
    const dates=datesEnding(end,count*2);
    const days=dates.map(day=>{
      const rows=group(data['day:'+day] || [],data['purposes:'+day] || {},{showPausedOnly:false});
      const seconds=Object.fromEntries(states.map(state=>[state,rows.reduce((n,row)=>n+(row.seconds[state] || 0),0)]));
      const events=data['recommendations:'+day] || [];
      return {day,foreground:seconds.foreground,backgroundAudio:seconds.backgroundAudio,backgroundSilent:seconds.backgroundSilent,playback:seconds.foreground+seconds.backgroundAudio+seconds.backgroundSilent,browsing:seconds.browsing,reveals:events.filter(e=>e.kind==='reveal').length,recorded:rows.length>0 || events.length>0,sources:sourceTotals(data['day:'+day] || [])};
    });
    function sum(list) {
      return {playback:list.reduce((n,d)=>n+d.playback,0),browsing:list.reduce((n,d)=>n+d.browsing,0),reveals:list.reduce((n,d)=>n+d.reveals,0),recordedDays:list.filter(d=>d.recorded).length};
    }
    const previous=days.slice(0,count),current=days.slice(count);
    return {end,dayCount:count,days:current,previousDays:previous,totals:sum(current),previousTotals:sum(previous),sources:sourceTotals(current.flatMap(d=>data['day:'+d.day]||[])),previousSources:sourceTotals(previous.flatMap(d=>data['day:'+d.day]||[]))};
  }
  return {groupSorts,groupSort,groupSortKey,validVideoViews,videoViewsDue,videoLength,validVideoDetails,videoDetailsDue,avatarURL,channelURL,channelMedia,journey,journeys,sourceTotals,relativeTime,playbackSeconds,sourceKey,sourceLabel,states, labels, dayKey, pieces, add, group, source, defaults, settings, datesEnding, trendReport};
})();
