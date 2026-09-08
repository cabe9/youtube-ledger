/* Unique observed playback ranges, independent of history and manual labels. */
globalThis.WatchStatus=(()=>{
  const key='videoProgress:v1',playback=['foreground','backgroundAudio','backgroundSilent'];
  function state(value){
    if(value?.manual==='watched')return 'watched';
    if(value?.manual==='unwatched')return 'unwatched';
    const covered=(value?.segments||[]).reduce((n,[a,b])=>n+b-a,0);
    return value?.duration>0&&covered/value.duration>=.9?'watched':value?.observed?'started':'unwatched';
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
    if(value.manual==='unwatched'){delete value.manual;value.segments=[];}
    const a=event.position,b=event.positionEnd,d=event.duration,elapsed=(event.end-event.start)/1000;
    if(Number.isFinite(d)&&d>0&&d<=604800&&Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>a&&b<=d+.5&&b-a<=elapsed*Math.min(16,event.rate||1)+.75){
      value.duration=d;if(latest)value.position=Math.min(b,d);value.segments=merge([...value.segments,[a,Math.min(b,d)]]);
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
      if(message.status==='recorded')delete value.manual;else value.manual=message.status;
      // Keep recorded ranges intact; manual Unwatched is removed by the next playback sample.
      const undoToken=globalThis.LedgerUndo?await LedgerUndo.record([{key,path:['videos',message.videoId,'manual'],before:before?.manual,after:value.manual}]):null;await browser.storage.local.set({[key]:progress});return {ok:true,undoToken};
    });
  }
  const fraction=value=>value?.duration>0?Math.min(1,(value.segments||[]).reduce((n,[a,b])=>n+b-a,0)/value.duration):0;
  const resume=value=>state(value)==='started'&&Number.isFinite(value?.position)&&value.position>0&&value.position<value.duration-2?Math.floor(value.position):0;
  return {key,state,add,read,handle,merge,fraction,resume};
})();
