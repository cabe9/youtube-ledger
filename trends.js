let trendPeriod=7, trendMetric='playback', trendData=null, trendVersion=0, trendBreakGroups=false;
const trendEnd=document.getElementById('trend-end');
trendEnd.value=Ledger.dayKey(Date.now());trendEnd.max=trendEnd.value;
const trendTime=seconds=>{const minutes=Math.round(seconds/60);return seconds<60 ? `${Math.round(seconds)}s` : minutes<60 ? `${minutes}m` : `${Math.floor(minutes/60)}h ${minutes%60}m`;};
const trendDay=day=>new Date(day+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
function trendValue(metric,value){return metric==='reveals'||metric==='recordedDays' ? String(value) : trendTime(value);}
function trendCompare(metric,current,previous){
  const delta=current-previous;
  if(!delta) return 'No change';
  const change=`${delta>0?'+':'−'}${trendValue(metric,Math.abs(delta))}`;
  return previous>0 ? `${change} (${delta>0?'+':'−'}${Math.round(Math.abs(delta)/previous*100)}%)` : `${change} from 0`;
}
function trendSourceRows(totals){
  const combined=new Map();
  for(const item of totals||[]){
    const grouped=item.source.kind==='group'&&!trendBreakGroups,key=grouped?'groups':item.key;
    const row=combined.get(key)||{key,kind:item.source.kind,label:grouped?'Groups':Ledger.sourceLabel(item.source),seconds:0,names:[]};
    row.seconds+=item.seconds;row.names.push(...(item.names||[]));combined.set(key,row);
  }
  return [...combined.values()].filter(row=>row.seconds>0).sort((a,b)=>b.seconds-a.seconds||a.key.localeCompare(b.key));
}
function trendSourceColor(item){
  if(item.key.startsWith('group:')){let hash=0;for(const c of item.key)hash=(hash*31+c.charCodeAt(0))>>>0;return `hsl(${hash%360} 52% var(--source-group-lightness))`;}
  return `var(--source-${item.kind})`;
}
const trendShare=(seconds,total)=>seconds>0&&seconds/total<.01?'<1%':Math.round(seconds/total*100)+'%';
function drawSourceSummary(items){
  const body=document.getElementById('source-summary-rows'),table=body.closest('.table-wrap'),focused=body.contains(document.activeElement)?document.activeElement.closest('tr')?.dataset.source:null;
  const end=trendData.end,period=trendData.dayCount;body.replaceChildren();
  table.hidden=!items.length;document.getElementById('source-summary-empty').hidden=!!items.length;
  const previous=new Map(trendSourceRows(trendData.previousSources).map(item=>[item.key,item.seconds]));
  const compare=trendData.previousTotals.recordedDays>0&&previous.size>0;
  document.getElementById('source-change-heading').hidden=!compare;
  for(const item of items){
    const row=document.createElement('tr');row.className='source-summary-row';row.dataset.source=item.key;
    const label=document.createElement('th');label.scope='row';const dot=document.createElement('i');dot.className='source-dot';dot.style.background=trendSourceColor(item);dot.setAttribute('aria-hidden','true');
    const link=document.createElement('a');link.className='source-history-link';link.href='#history?date='+end+'&source='+encodeURIComponent(item.key)+'&period='+period;
    link.setAttribute('aria-label','View '+item.label+' history for '+trendDay(trendData.days[0].day)+' – '+trendDay(end));
    const arrow=document.createElement('span');arrow.className='source-open';arrow.setAttribute('aria-hidden','true');arrow.textContent='→';
    link.append(dot,document.createTextNode(item.label),arrow);label.append(link);if(item.names.length>1)label.title='Names recorded in this period: '+[...new Set(item.names)].join(', ');
    link.addEventListener('click',event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();openDashboardView('history',end,{source:item.key,period});});
    row.addEventListener('click',event=>{if(event.target.closest('a')||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||getSelection()?.toString())return;openDashboardView('history',end,{source:item.key,period});});
    row.append(label);
    for(const value of [trendTime(item.seconds),trendShare(item.seconds,trendData.totals.playback)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    if(compare){const cell=document.createElement('td'),before=previous.get(item.key)||0;cell.className='source-change';cell.textContent=before?trendCompare('playback',item.seconds,before):'—';cell.title=before?'Compared with the previous period':'No playback recorded for this source in the previous period';row.append(cell);}
    body.append(row);
    if(item.key===focused)link.focus({preventScroll:true});
  }
}
function drawSourceDay(day,index,series,max){
  const column=document.createElement('div');column.className='trend-day source-day';column.dataset.day=day.day;column.setAttribute('role','group');column.setAttribute('aria-label',day.day+' playback sources');
  const track=document.createElement('span');track.className='trend-track';const stack=document.createElement('span');stack.className='trend-stack';stack.style.height=day.playback/max*100+'%';
  const tooltip=document.createElement('span');tooltip.className='trend-tooltip';tooltip.setAttribute('aria-hidden','true');const title=trendDay(day.day)+' · '+trendTime(day.playback)+' playback';tooltip.textContent=title;
  const values=new Map(trendSourceRows(day.sources).map(item=>[item.key,item.seconds]));
  for(const item of series){const seconds=values.get(item.key)||0;if(!seconds)continue;
    const segment=document.createElement('button');segment.type='button';segment.className='source-segment';segment.dataset.day=day.day;segment.dataset.source=item.key;segment.dataset.seconds=String(seconds);segment.style.flexGrow=String(seconds);segment.style.background=trendSourceColor(item);
    const text=`${trendDay(day.day)} · ${item.label}: ${trendTime(seconds)} (${trendShare(seconds,day.playback)})`;segment.title=text;segment.setAttribute('aria-label',text+' — open filtered history');
    for(const type of ['pointerenter','focus'])segment.addEventListener(type,()=>{tooltip.textContent=text;});
    segment.addEventListener('click',()=>openDashboardView('history',day.day,{source:item.key,period:1}));stack.append(segment);
  }
  track.append(stack);
  const label=document.createElement('button');label.type='button';label.className='trend-date';label.dataset.day=day.day;label.dataset.source='all';label.setAttribute('aria-pressed',String(day.day===date.value));label.setAttribute('aria-label',day.day+': '+trendTime(day.playback)+' playback — open all history');label.textContent=trendData.days.length===7||index%5===0||index===trendData.days.length-1?trendDay(day.day):'·';
  for(const type of ['pointerenter','focus'])label.addEventListener(type,()=>{tooltip.textContent=title;});
  label.addEventListener('click',()=>openDashboardView('history',day.day,{source:'all',period:1}));column.append(track,label,tooltip);return column;
}
async function renderTrends(){
  const revision=++trendVersion,end=trendEnd.value, count=trendPeriod;
  const days=Ledger.datesEnding(end,count*2);
  if(!days.length || end>Ledger.dayKey(Date.now())) return;
  const keys=days.flatMap(day=>['day:'+day,'recommendations:'+day]);
  const data=await browser.storage.local.get(keys);
  if(revision!==trendVersion) return;
  trendData=Ledger.trendReport(data,end,count);
  const current=trendData.days,previous=trendData.previousDays;
  document.getElementById('trend-range').textContent=`${trendDay(current[0].day)} – ${trendDay(end)} · ${new Date(end+'T12:00:00').getFullYear()} · ${count} days`;
  document.getElementById('trend-next').disabled=end>=Ledger.dayKey(Date.now());
  const totals=document.getElementById('trend-totals');totals.replaceChildren();
  for(const [key,label] of [['playback','Total playback'],['browsing','Browsing'],['reveals','Recommendation reveals'],['recordedDays','Days with activity']]){
    const card=document.createElement('div');card.className='card';
    const caption=document.createElement('span');caption.textContent=label;
    const number=document.createElement('strong');number.textContent=trendValue(key,trendData.totals[key]);
    const change=document.createElement('small');
    change.textContent=trendData.previousTotals.recordedDays ? trendCompare(key,trendData.totals[key],trendData.previousTotals[key])+' vs previous period' : 'No activity saved for previous period';
    card.append(caption,number,change);totals.append(card);
  }
  document.getElementById('trend-coverage').textContent=`Activity saved on ${trendData.totals.recordedDays}/${count} days; previous period (${trendDay(previous[0].day)}–${trendDay(previous.at(-1).day)}): ${trendData.previousTotals.recordedDays}/${count}. Days without saved activity appear as 0.`;
  const rows=document.getElementById('trend-details');rows.replaceChildren();
  for(const day of current){const row=document.createElement('tr');for(const value of [day.day,trendTime(day.playback),trendTime(day.browsing),String(day.reveals)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}rows.append(row);}
  globalThis.LedgerPeriodUI?.render(trendData);
  drawTrends();
}
function drawTrends(){
  if(!trendData) return;
  const days=trendData.days;
  const sources=trendMetric==='sources',metric=sources?'playback':trendMetric;
  const sourceRows=sources?trendSourceRows(trendData.sources):[],series=[...sourceRows.filter(row=>row.kind!=='unknown'),...sourceRows.filter(row=>row.kind==='unknown')];
  const peak=Math.max(0,...days.map(day=>day[metric]));
  const step=trendMetric==='reveals' ? Math.max(1,Math.ceil(peak/4)) : ([15,30,60,120,180,300,450,600,900,1200,1800,2700,3600,7200,14400,28800].find(value=>value*4>=peak) || Math.ceil(peak/14400)*3600);
  const max=step*4;
  const chart=document.getElementById('trend-chart');
  const focusedDay=chart.contains(document.activeElement) ? document.activeElement.dataset.day : null,focusedSource=document.activeElement?.dataset.source;
  chart.replaceChildren();chart.dataset.period=String(days.length);
  chart.setAttribute('aria-label',sources?'Daily playback by source':'Daily activity chart');chart.closest('.chart-panel').dataset.sourceView=String(sources);
  document.getElementById('trend-source-options').hidden=!sources;document.getElementById('trend-source-summary').hidden=!sources;
  document.getElementById('trend-group-breakdown').disabled=!trendData.sources.some(item=>item.source.kind==='group');
  document.querySelector('.chart-caption>span:first-child').textContent=sources?'Select a segment to open filtered history, or a date for all sources':'Select a day to open its history';
  document.getElementById('trend-scale').textContent=`Scale: 0–${trendValue(trendMetric,max)}`;
  const axis=document.getElementById('trend-axis');axis.replaceChildren();
  for(let tick=4;tick>=0;tick--){const label=document.createElement('span');label.textContent=trendValue(trendMetric,step*tick);axis.append(label);}
  const legend=document.getElementById('trend-legend');legend.replaceChildren();
  if(sources){for(const item of series){const label=document.createElement('span');label.className='legend-item';const dot=document.createElement('i');dot.style.background=trendSourceColor(item);label.append(dot,document.createTextNode(item.label));legend.append(label);}drawSourceSummary(sourceRows);}
  else for(const [kind,label] of (trendMetric==='playback' ? [['foreground','Foreground'],['audio','Background audio'],['silent','Silent background']] : [[trendMetric,trendMetric==='reveals'?'Show clicks':'Browsing']])){
    const item=document.createElement('span');item.className='legend-item';const dot=document.createElement('i');dot.className='bar-'+kind;item.append(dot,document.createTextNode(label));legend.append(item);
  }
  days.forEach((day,index)=>{
    if(sources){chart.append(drawSourceDay(day,index,series,max));return;}
    const button=document.createElement('button');button.type='button';button.className='trend-day';
    button.dataset.day=day.day;button.setAttribute('aria-pressed',String(day.day===date.value));
    const title=`${day.day}: ${trendTime(day.playback)} playback, ${trendTime(day.browsing)} browsing, ${day.reveals} reveals`;
    button.title=title;button.setAttribute('aria-label',title);
    const track=document.createElement('span');track.className='trend-track';
    const stack=document.createElement('span');stack.className='trend-stack';stack.style.height=`${day[trendMetric]/max*100}%`;
    const components=trendMetric==='playback' ? [['foreground',day.foreground],['audio',day.backgroundAudio],['silent',day.backgroundSilent]] : [[trendMetric,day[trendMetric]]];
    for(const [kind,value] of components){const segment=document.createElement('span');segment.className='bar-'+kind;segment.style.flexGrow=String(value);stack.append(segment);}
    track.append(stack);
    const label=document.createElement('span');label.className='trend-date';label.textContent=days.length===7||index%5===0||index===days.length-1 ? trendDay(day.day) : '·';
    const tooltip=document.createElement('span');tooltip.className='trend-tooltip';tooltip.setAttribute('aria-hidden','true');tooltip.textContent=`${trendDay(day.day)} · ${trendValue(trendMetric,day[trendMetric])}`;
    button.append(track,label,tooltip);button.addEventListener('click',()=>openDashboardView('history',day.day,{source:'all',period:1}));
    chart.append(button);
    if(day.day===focusedDay)button.focus({preventScroll:true});
  });
  if(sources&&focusedDay)[...chart.querySelectorAll('button')].find(button=>button.dataset.day===focusedDay&&button.dataset.source===focusedSource)?.focus({preventScroll:true});
}
document.getElementById('trend-group-breakdown').addEventListener('change',event=>{trendBreakGroups=event.target.checked;drawTrends();});
for(const button of document.querySelectorAll('[data-period]'))button.addEventListener('click',()=>{trendPeriod=Number(button.dataset.period);for(const b of document.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b===button));renderTrends().catch(console.error);});
for(const button of document.querySelectorAll('[data-metric]'))button.addEventListener('click',()=>{trendMetric=button.dataset.metric;for(const b of document.querySelectorAll('[data-metric]'))b.setAttribute('aria-pressed',String(b===button));drawTrends();});
function shiftTrend(direction){
  const d=new Date(trendEnd.value+'T12:00:00');d.setDate(d.getDate()+direction*trendPeriod);
  trendEnd.value=Ledger.dayKey(d)>Ledger.dayKey(Date.now()) ? Ledger.dayKey(Date.now()) : Ledger.dayKey(d);
  renderTrends().catch(console.error);
}
document.getElementById('trend-prev').addEventListener('click',()=>shiftTrend(-1));
document.getElementById('trend-next').addEventListener('click',()=>shiftTrend(1));
document.getElementById('trend-today').addEventListener('click',()=>{trendEnd.value=Ledger.dayKey(Date.now());renderTrends().catch(console.error);});
trendEnd.addEventListener('change',()=>renderTrends().catch(console.error));
document.getElementById('trend-export').addEventListener('click',()=>{if(trendData)download(`youtube-${trendData.dayCount}-days-${trendData.end}.json`,JSON.stringify({schemaVersion:1,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...trendData},null,2),'application/json');});
renderTrends().catch(console.error);setInterval(()=>renderTrends().catch(console.error),5000);
