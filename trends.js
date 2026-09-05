let trendPeriod=7, trendMetric='playback', trendData=null, trendVersion=0;
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
async function renderTrends(){
  const revision=++trendVersion,end=trendEnd.value, count=trendPeriod;
  const days=Ledger.datesEnding(end,count*2);
  if(!days.length || end>Ledger.dayKey(Date.now())) return;
  const keys=days.flatMap(day=>['day:'+day,'recommendations:'+day]);
  const data=await browser.storage.local.get(keys);
  if(revision!==trendVersion) return;
  trendData=Ledger.trendReport(data,end,count);
  const current=trendData.days,previous=trendData.previousDays;
  document.getElementById('trend-range').textContent=`${trendDay(current[0].day)}–${trendDay(end)} · ${count} days ending ${end}`;
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
  drawTrends();
}
function drawTrends(){
  if(!trendData) return;
  const days=trendData.days;
  const max=Math.max(1,...days.map(day=>day[trendMetric]));
  const chart=document.getElementById('trend-chart');chart.replaceChildren();
  document.getElementById('trend-scale').textContent=`Scale: 0–${trendValue(trendMetric,max)}`;
  const legend=document.getElementById('trend-legend');legend.replaceChildren();
  for(const [kind,label] of (trendMetric==='playback' ? [['foreground','Foreground'],['audio','Background audio'],['silent','Silent background']] : [[trendMetric,trendMetric==='reveals'?'Show clicks':'Browsing']])){
    const item=document.createElement('span');item.className='legend-item';const dot=document.createElement('i');dot.className='bar-'+kind;item.append(dot,document.createTextNode(label));legend.append(item);
  }
  days.forEach((day,index)=>{
    const button=document.createElement('button');button.type='button';button.className='trend-day';
    const title=`${day.day}: ${trendTime(day.playback)} playback, ${trendTime(day.browsing)} browsing, ${day.reveals} reveals`;
    button.title=title;button.setAttribute('aria-label',title);
    const track=document.createElement('span');track.className='trend-track';
    const stack=document.createElement('span');stack.className='trend-stack';stack.style.height=`${day[trendMetric]/max*100}%`;
    const components=trendMetric==='playback' ? [['foreground',day.foreground],['audio',day.backgroundAudio],['silent',day.backgroundSilent]] : [[trendMetric,day[trendMetric]]];
    for(const [kind,value] of components){const segment=document.createElement('span');segment.className='bar-'+kind;segment.style.flexGrow=String(value);stack.append(segment);}
    track.append(stack);
    const label=document.createElement('span');label.className='trend-date';label.textContent=days.length===7||index%5===0||index===days.length-1 ? trendDay(day.day) : '·';
    button.append(track,label);button.addEventListener('click',()=>{date.value=day.day;render();document.querySelector('.toolbar').scrollIntoView({behavior:'auto',block:'start'});});
    chart.append(button);
  });
}
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
