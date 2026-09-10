/* This view reads extension storage through the background; it never refreshes YouTube. */
(()=>{
  const section=document.createElement('section');section.className='settings-block';section.id='request-log';
  section.innerHTML=`<div class="request-log-heading"><div><h3>YouTube requests</h3><p class="note">Ledger’s feed, video-detail and channel lookups in this browser profile.</p></div><label>Period <select id="request-log-period"><option value="today">Today</option><option value="week">Last 7 days</option></select></label></div>
    <div class="request-log-stats" id="request-log-stats"></div>
    <p id="request-log-queue" class="note"></p>
    <div class="table-wrap"><table><caption class="request-log-caption">Requests started, by purpose</caption><thead><tr><th>Purpose</th><th>Started</th><th>Background</th><th>Failed</th></tr></thead><tbody id="request-log-kinds"></tbody></table></div>
    <p id="request-log-results" class="note"></p><p id="request-log-skips" class="note"></p>
    <details><summary>Daily totals</summary><div class="table-wrap"><table><thead><tr><th>Day</th><th>Started</th><th>Background</th><th>Failed</th></tr></thead><tbody id="request-log-days"></tbody></table></div></details>
    <details open><summary>Recent requests</summary><p class="note" id="request-log-recent-note"></p><div class="table-wrap"><table class="request-log-recent"><thead><tr><th>Time</th><th>Purpose</th><th>Priority</th><th>Channel / video</th><th>Result</th><th>Elapsed</th></tr></thead><tbody id="request-log-rows"></tbody></table></div></details>
    <p class="note">Counts start after this update. Background means Ledger queued the lookup at background priority; foreground work can also run automatically. Playback, thumbnails, YouTube’s own traffic and other extensions are excluded. Each fetch counts once, including any redirects or browser-cache reuse.</p>
    <p class="note">Keeps 7 days of totals and up to 1,000 recent requests locally. Firefox and Chrome have separate logs. Logs are excluded from profile backups; exported logs include the public channel and video addresses requested.</p>
    <div class="actions"><button type="button" class="secondary" id="request-log-export">Export request log</button><button type="button" class="secondary" id="request-log-clear">Clear request log</button><span id="request-log-message" role="status"></span></div><p id="request-log-warning" role="status"></p>`;
  document.querySelector('[data-view="settings"]').append(section);
  const byId=id=>section.querySelector('#request-log-'+id),names={feed:'Upload checks',video:'Video details and views',channel:'Channel lookups',other:'Other lookups'};
  const reasons={'group-refresh':'Group uploads','background-refresh':'Background uploads','manual-refresh':'Manual upload refresh','uploads-page-fallback':'Uploads-page fallback',shorts:'Shorts check','video-details':'Video details','views-and-details':'Views / video details','channel-lookup':'Channel lookup','channel-portrait':'Channel portrait lookup'};
  let latest,channels={},videos=new Map(),revision=0,timer;
  const count=value=>(value||0).toLocaleString(),empty=()=>({started:0,failed:0,background:0,cache:0,cooldown:0,reused:0,cancelled:0,statuses:{}});
  function add(total,value){for(const k of Object.keys(empty()))if(k!=='statuses')total[k]+=value[k]||0;for(const [status,n]of Object.entries(value.statuses||{}))total.statuses[status]=(total.statuses[status]||0)+n;return total;}
  function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
  function row(body,values){const tr=document.createElement('tr');for(const value of values)cell(tr,value);body.append(tr);return tr;}
  function target(entry){try{const u=new URL(entry.url),id=u.searchParams.get('channel_id')||(/^UU[A-Za-z0-9_-]{22}$/.test(u.searchParams.get('list')||'')?'UC'+u.searchParams.get('list').slice(2):null)||u.pathname.match(/^\/channel\/(UC[^/]+)$/)?.[1],video=u.searchParams.get('v');return channels[id]?.name||videos.get(video)||id||video||decodeURI(u.pathname);}catch{return 'Lookup';}}
  function render(){
    if(!latest)return;const today=Ledger.dayKey(Date.now()),selected=Object.entries(latest.days).filter(([day])=>byId('period').value==='week'||day===today),total=empty(),types={};
    for(const [,values]of selected)for(const [kind,value]of Object.entries(values)){add(total,value);add(types[kind]||(types[kind]=empty()),value);}
    const stats=byId('stats');stats.replaceChildren();for(const [label,n]of [['Requests started',total.started],['Background requests',total.background],['Failed requests',total.failed],['Stopped by cooldown',total.cooldown]]){const box=document.createElement('div'),number=document.createElement('strong'),caption=document.createElement('span');number.textContent=count(n);caption.textContent=label;box.append(number,caption);stats.append(box);}
    const kinds=byId('kinds');kinds.replaceChildren();for(const kind of ['feed','video','channel',...(types.other?['other']:[])]){const v=types[kind]||empty();row(kinds,[names[kind],count(v.started),count(v.background),count(v.failed)]);}
    byId('results').textContent='Completed responses: '+(Object.entries(total.statuses).map(([status,n])=>(/^\d+$/.test(status)?'HTTP '+status:status==='timeout'?'Timed out':'Network error')+' × '+count(n)).join(' · ')||'None yet.');
    byId('skips').textContent='No request sent: '+count(total.cooldown)+' cooldown stops · '+count(total.cache)+' feed/channel cache checks · '+count(total.reused)+' shared in-flight feed lookups · '+count(total.cancelled)+' cancelled jobs. These counts are separate from requests started; they do not count every cached card displayed.';
    const queue=latest.queue||{};byId('queue').textContent=(queue.pauseMessage||'No active YouTube cooldown.')+' '+count(queue.queued)+' queued lookups. Logging since '+new Date(latest.since).toLocaleString()+'.';
    const days=byId('days');days.replaceChildren();for(const [day,values]of Object.entries(latest.days).sort(([a],[b])=>b.localeCompare(a))){const v=Object.values(values).reduce(add,empty());row(days,[day,count(v.started),count(v.background),count(v.failed)]);}
    if(!days.children.length)row(days,['No requests recorded yet.','','','']);
    const entries=latest.recent.filter(e=>byId('period').value==='week'||Ledger.dayKey(e.at)===today).slice(-100).reverse(),body=byId('rows');body.replaceChildren();
    for(const entry of entries){
      const result={ok:'HTTP '+entry.status,'http-error':'HTTP '+entry.status,unusable:'HTTP '+entry.status+' · unreadable data',network:'Network error',timeout:entry.status?'HTTP '+entry.status+' · timed out reading response':'Timed out',pending:'In progress',unfinished:'Response not recorded'}[entry.result]||'Response not recorded';
      const tr=row(body,[new Date(entry.at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}),reasons[entry.reason]||names[entry.kind]||names.other,entry.mode==='background'?'Background':'Foreground','',result,entry.ms===undefined?'—':(entry.ms/1000).toFixed(1)+'s']);
      const td=tr.children[3];if(/^https:\/\/(www|m)\.youtube\.com\//.test(entry.url)){const a=document.createElement('a');a.href=entry.url;a.target='_blank';a.rel='noreferrer noopener';a.textContent=target(entry);a.title=entry.url;td.append(a);}else td.textContent='Lookup';
      if(['http-error','network','timeout','unusable'].includes(entry.result))tr.className='request-log-failed';
    }
    if(!entries.length)row(body,['No requests recorded in this period.','','','','','']);
    byId('recent-note').textContent='Showing the latest '+entries.length+' requests in this period. New request timings start when sent and include reading the response, excluding queue and log-saving time. Totals include older requests even after their detail rows expire. “Response not recorded” means the extension stopped before the result was saved.';
    byId('warning').textContent=latest.storageWarning||'';
  }
  async function read(){
    const current=++revision;
    try{const [result,data]=await Promise.all([browser.runtime.sendMessage({type:'requestLog:get'}),browser.storage.local.get(['channelGroups:v1','channelUploads:v1'])]);if(current!==revision)return;if(result?.error)throw Error(result.error);if(!result?.days)throw Error('Reload the extension to enable the request log.');latest=result;channels=data['channelGroups:v1']?.channels||{};videos=new Map(Object.values(data['channelUploads:v1']?.channels||{}).flatMap(c=>(c.entries||[]).map(e=>[e.videoId,e.title])));render();}catch(error){byId('warning').textContent=error.message;}
  }
  const visible=()=>!section.closest('[data-view]').hidden&&document.visibilityState==='visible';
  function schedule(){if(!visible())return;clearTimeout(timer);timer=setTimeout(read,250);}
  new MutationObserver(schedule).observe(section.closest('[data-view]'),{attributes:true,attributeFilter:['hidden']});
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes['youtubeRequestLog:v1']||changes['youtubeRequests:v1']))schedule();});
  document.addEventListener('visibilitychange',schedule);setInterval(()=>{if(visible())void read();},5000);
  byId('period').onchange=render;
  byId('export').onclick=async()=>{try{const result=await browser.runtime.sendMessage({type:'requestLog:get'});if(!result?.days||result.error)throw Error(result?.error||'Could not read request log.');download('ledger-requests-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify({format:'youtube-ledger-request-log',extensionVersion:browser.runtime.getManifest().version,...result},null,2),'application/json');byId('message').textContent='Request log exported.';}catch(error){byId('message').textContent=error.message;}};
  byId('clear').onclick=async()=>{byId('clear').disabled=true;try{const result=await browser.runtime.sendMessage({type:'requestLog:clear'});if(result?.error)throw Error(result.error);await read();byId('message').textContent='Log cleared. New requests will still be recorded; cooldowns are unchanged.';}catch(error){byId('message').textContent=error.message;}finally{byId('clear').disabled=false;}};
  if(visible())void read();
})();
