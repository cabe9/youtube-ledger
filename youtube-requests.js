/* Pace Ledger's public metadata lookups. Playback and image loading are separate. */
globalThis.YouTubeRequests = (() => {
  const key='youtubeRequests:v1',queue=[];
  let state,loading,busy=false,timer;
  const cooldownError=()=>Object.assign(new Error('YouTube checks are cooling down. Cached videos are still available.'),{name:'YouTubeCooldownError',retryAfter:state.pausedUntil});
  async function ready(){
    if(!loading)loading=(async()=>{
      const saved=(await browser.storage.local.get(key))[key]||{},now=Date.now();
      const time=value=>Number.isFinite(value)&&value>=0?Math.min(value,now+86400000):0;
      state={lastStartedAt:Math.min(time(saved.lastStartedAt),now),pausedUntil:time(saved.pausedUntil),level:Math.min(4,Math.max(0,Number(saved.level)||0)),failures:Array.isArray(saved.failures)?saved.failures.filter(v=>typeof v.id==='string'&&Number.isFinite(v.at)&&now-v.at<300000).slice(-3):[],successes:0};
    })();
    await loading;
  }
  const save=()=>browser.storage.local.set({[key]:state});
  function checkResponse(response){
    if(response.ok)return;
    const raw=response.headers?.get('Retry-After'),now=Date.now();
    const retry=raw?(/^\d+$/.test(raw)?now+Number(raw)*1000:Date.parse(raw)):0;
    throw Object.assign(new Error('YouTube request failed (HTTP '+response.status+').'),{youtubeStatus:response.status,retryAfter:Number.isFinite(retry)?Math.max(0,Math.min(now+86400000,retry)):0});
  }
  function record(error,options){
    const now=Date.now();
    state.failures=state.failures.filter(v=>now-v.at<300000&&v.id!==options.id);
    if(!error){
      if(options.kind==='feed'&&++state.successes>=3){state.level=0;state.failures=[];}
      return;
    }
    state.successes=0;
    if(options.kind==='feed')state.failures.push({id:options.id,at:now});
    if(error.youtubeStatus===429||error.youtubeStatus===403||error.retryAfter>now||state.failures.length>=3){
      const delay=Math.min(2*3600000,15*60000*2**state.level);
      state.level=Math.min(4,state.level+1);
      state.pausedUntil=Math.max(now+delay,error.retryAfter||0);
      state.failures=[];error.retryAfter=state.pausedUntil;
    }
  }
  function wake(){
    if(busy)return;
    if(timer){clearTimeout(timer);timer=null;}
    void pump();
  }
  async function pump(){
    busy=true;
    try{
      await ready();
      if(state.pausedUntil>Date.now()){
        for(const job of queue.splice(0))job.reject(cooldownError());
        return;
      }
      state.pausedUntil=0;
      queue.sort((a,b)=>(b.options.priority||0)-(a.options.priority||0));
      const job=queue[0];if(!job)return;
      // Foreground work can move ahead of background work even during a wait.
      const spacing=job.options.priority>=2?2000:10000;
      const wait=state.lastStartedAt+spacing-Date.now();
      if(wait>0){timer=setTimeout(()=>{timer=null;wake();},wait);return;}
      queue.shift();
      if(job.options.cancelled?.()){job.resolve();return;}
      state.lastStartedAt=Date.now();
      try{
        // Persist pacing before the request, including across worker restarts.
        await save();
        const value=await job.operation();record(null,job.options);await save();job.resolve(value);
      }catch(error){record(error,job.options);await save().catch(()=>{});job.reject(error);}
    }catch(error){for(const job of queue.splice(0))job.reject(error);}
    finally{busy=false;if(queue.length&&!timer)wake();}
  }
  function run(operation,options={}){
    return new Promise((resolve,reject)=>{queue.push({operation,options,resolve,reject});wake();});
  }
  return {key,run,wake,checkResponse,async status(){await ready();return {pausedUntil:state.pausedUntil>Date.now()?state.pausedUntil:0};}};
})();
