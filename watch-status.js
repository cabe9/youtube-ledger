/* Unique observed playback ranges, independent of history and manual labels. */
globalThis.WatchStatus=(()=>{
  const key='videoProgress:v1',playback=['foreground','backgroundAudio','backgroundSilent'];
  function state(value){
    if(value?.manual==='watched')return 'watched';
    if(value?.manual==='unwatched')return 'unwatched';
    const covered=fraction(value),evidence=value?.externalIgnored?null:value?.evidence;
    if(covered>=.9||covered>=.8&&value?.finishedAt>0||evidence?.percent>=90)return 'watched';
    if(value?.observed||evidence?.percent>0)return 'started';
    return evidence?'seen':'unwatched';
  }
  function merge(segments){
    const result=[];
    for(const [a,b] of segments.sort((x,y)=>x[0]-y[0])){
      const last=result.at(-1);if(last&&a<=last[1]+.1)last[1]=Math.max(last[1],b);else result.push([a,b]);
    }
    // If highly fragmented, discard the smallest ranges instead of filling unwatched gaps.
    return result.length<=500?result:result.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0])).slice(0,500).sort((a,b)=>a[0]-b[0]);
  }
  function add(progress,event){
    if(!/^[\w-]{11}$/.test(event.videoId||'')||!playback.includes(event.state))return;
    const value=progress.videos[event.videoId]||={observed:false,segments:[]};
    const latest=!value.lastWatchedAt||event.end>=value.lastWatchedAt;
    value.observed=true;value.lastWatchedAt=Math.max(value.lastWatchedAt||0,event.end);
    if(value.manual==='unwatched'){delete value.manual;delete value.finishedAt;value.segments=[];}
    const a=event.position,b=event.positionEnd,d=event.duration,elapsed=(event.end-event.start)/1000;
    if(Number.isFinite(d)&&d>0&&d<=604800&&Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>a&&b<=d+.5&&b-a<=(elapsed+.75)*Math.min(16,event.rate||1)){
      value.duration=d;if(latest)value.position=Math.min(b,d);value.segments=merge([...value.segments,[a,Math.min(b,d)]]);
      // Require an observed media end and a played final stretch, never a seek to the end.
      const tail=value.segments.at(-1);
      if(event.finished===true&&b>=d-.5&&tail?.[1]>=d-.5&&tail[1]-tail[0]>=Math.min(5,d*.1))value.finishedAt=Math.max(value.finishedAt||0,event.end);
    }
  }
  async function read(){
    const data=await browser.storage.local.get(key);if(data[key])return data[key];
    // Older sessions establish Started, never completion: they have no position coverage.
    const all=await browser.storage.local.get(null),value={version:1,videos:{}};
    for(const [name,rows] of Object.entries(all))if(name.startsWith('day:'))for(const row of rows){
      if(/^[\w-]{11}$/.test(row.videoId||'')&&playback.some(s=>row.seconds?.[s]>0))value.videos[row.videoId]={observed:true,segments:[],lastWatchedAt:Math.max(value.videos[row.videoId]?.lastWatchedAt||0,row.end||0)};
    }
    return value;
  }
  async function handle(message,sender){
    if(sender.tab?.incognito||!/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||''))throw new Error('This page cannot change watch state.');
    if(!/^[\w-]{11}$/.test(message.videoId||'')||!['watched','unwatched','recorded'].includes(message.status))throw new Error('Choose a watch state.');
    return LedgerStorage.write(async()=>{
      const progress=await read(),before=structuredClone(progress.videos[message.videoId]),value=progress.videos[message.videoId]||={observed:false,segments:[]};
      if(message.status==='recorded'){delete value.manual;delete value.externalIgnored;}else{value.manual=message.status;if(message.status==='unwatched')value.externalIgnored=true;}
      // Keep recorded ranges intact; manual Unwatched is removed by the next playback sample.
      const undoToken=globalThis.LedgerUndo?await LedgerUndo.record(['manual','externalIgnored'].map(field=>({key,path:['videos',message.videoId,field],before:before?.[field],after:value[field]}))):null;await browser.storage.local.set({[key]:progress});return {ok:true,undoToken};
    });
  }
  const fraction=value=>value?.duration>0?Math.min(1,(value.segments||[]).reduce((n,[a,b])=>n+b-a,0)/value.duration):0;
  const resume=value=>state(value)==='started'&&Number.isFinite(value?.position)&&value.position>0&&value.position<value.duration-2?Math.floor(value.position):0;
  const entry=(progress,id)=>({...progress?.videos?.[id],evidence:progress?.evidence?.[id]});
  function description(value){
    if(value?.manual)return 'Marked manually';
    if(fraction(value)>=.9||fraction(value)>=.8&&value?.finishedAt>0)return 'Based on playback recorded by Ledger';
    if(!value?.externalIgnored&&value?.evidence?.percent>0)return 'YouTube showed '+Math.round(value.evidence.percent)+'% progress. This does not add watch time to Ledger.';
    if(value?.observed)return 'Based on playback recorded by Ledger';
    return value?.evidence&&!value.externalIgnored?'Seen in YouTube history. Completion and watch duration are unknown.':'';
  }
  return {key,state,add,read,handle,merge,fraction,resume,entry,description};
})();
