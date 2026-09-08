/* One acknowledged batch at a time; retries carry the same persistent receipt. */
globalThis.RecordingBuffer=({send,onError=()=>{},onRecovery=()=>{},onLoss=()=>{},now=Date.now,id=crypto.randomUUID()})=>{
  let queue=[],pending=null,sending=false,sequence=0,retryAt=0,lostSeconds=0,stopped=false,drain=false;
  function add(event){
    if(stopped)return;
    if(queue.length+(pending?.events.length||0)>=300){lostSeconds+=(event.end-event.start)/1000;onLoss(lostSeconds);return;}
    queue.push(event);
  }
  async function flush(force=false){
    if(force)drain=true;
    if(stopped||sending||now()<retryAt||(!pending&&queue.length<(drain?1:5)))return;
    pending||={type:'events',recorderId:id,sequence:++sequence,events:queue.splice(0,100)};
    const batch=pending;sending=true;
    try{
      const reply=await send(batch);
      if(!reply?.ok)throw Object.assign(new Error(reply?.recordingError||'Activity was not acknowledged.'),{reported:!!reply?.recordingError});
      if(pending!==batch)return;
      pending=null;retryAt=0;
      if(!queue.length){drain=false;if(!lostSeconds)onRecovery();}
    }catch(error){if(pending===batch){retryAt=now()+5000;onError(error);}}
    finally{sending=false;}
    if(!pending)void flush();
  }
  function clear(){queue=[];pending=null;retryAt=0;drain=false;}
  return {add,flush,clear,stop(){stopped=true;},get lostSeconds(){return lostSeconds;}};
};
