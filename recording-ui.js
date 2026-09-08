/* Keep an acknowledged warning until the user has checked the recording gap. */
globalThis.RecordingHealthUI=(()=>{
  const key='recordingStatus:v1',banner=document.createElement('aside'),message=document.createElement('p'),actions=document.createElement('div');
  let health=null,isPaused=false,revision=0;
  banner.id='recording-warning';banner.hidden=true;banner.setAttribute('aria-label','Recording warning');message.setAttribute('role','status');
  for(const [label,view] of [['Review history','history'],['Back up or free storage','settings']]){
    const button=document.createElement('button');button.className='secondary';button.textContent=label;button.addEventListener('click',()=>openDashboardView(view));actions.append(button);
  }
  const dismiss=document.createElement('button');dismiss.className='secondary';dismiss.textContent='Dismiss warning';
  dismiss.addEventListener('click',async()=>{dismiss.disabled=true;try{const result=await browser.runtime.sendMessage({type:'recording:dismiss'});if(!result?.ok)throw Error('Could not dismiss warning.');await read();}catch(error){message.textContent=error.message;}finally{dismiss.disabled=false;}});
  actions.append(dismiss);banner.append(message,actions);document.querySelector('.masthead').after(banner);
  function render(paused=isPaused){
    isPaused=paused;banner.hidden=!health;document.documentElement.dataset.recordingWarning=String(!!health);
    if(health)message.textContent=health.message+(health.lostSeconds>0?' Some activity exceeded the retry buffer and was not saved.':'');
    document.getElementById('tracking-indicator').textContent=health?'Recording warning':paused?'Tracking paused':'Tracking active';
    document.getElementById('status').textContent=health?'Recording needs attention':paused?'Tracking paused':'Stored only in this browser profile';
  }
  async function read(){const current=++revision;const [local,session]=await Promise.all([browser.storage.local.get([key,'paused']),browser.storage.session.get(key)]);if(current!==revision)return;health=[local[key],session[key]].filter(Boolean).sort((a,b)=>b.at-a.at)[0]||null;render(!!local.paused);}
  browser.storage.onChanged.addListener((changes,area)=>{if(['local','session'].includes(area)&&(changes[key]||changes.paused))read().catch(console.error);});
  read().catch(console.error);return {render};
})();
