/* Browsing evidence is separate from measured playback and its write path. */
globalThis.WatchEvidence=(()=>{
  const key='watchEvidence:v1',limit=20000,validId=id=>typeof id==='string'&&id!=='constructor'&&/^[\w-]{11}$/.test(id);
  const sources=['youtube-progress','youtube-history','history-file'];
  function videoId(address){
    try{const u=new URL(address,'https://www.youtube.com');if(u.protocol!=='https:'||!['www.youtube.com','m.youtube.com','youtube.com','youtu.be'].includes(u.hostname)||u.username||u.password)return null;
      const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):/^\/shorts\/([^/]+)\/?$/.exec(u.pathname)?.[1];return validId(id)?id:null;
    }catch{return null;}
  }
  function records(input,source,now=Date.now()){
    if(!Array.isArray(input)||input.length>limit||!sources.includes(source))throw Error('Choose a supported watch-history file.');
    const found=new Map();
    for(const row of input){
      if(!row||!validId(row.videoId)||!Number.isFinite(row.seenAt)||row.seenAt<1||row.seenAt>now+300000||row.percent!==undefined&&(!Number.isFinite(row.percent)||row.percent<=0||row.percent>100||source==='history-file'))throw Error('Some watch-history entries could not be read. Nothing was imported.');
      const old=found.get(row.videoId),percent=Math.max(old?.percent||0,row.percent||0);
      found.set(row.videoId,{videoId:row.videoId,seenAt:Math.max(old?.seenAt||0,row.seenAt),source,...(percent?{percent}: {})});
    }
    return [...found.values()];
  }
  function merge(previous,input,source,now=Date.now()){
    const videos={...previous?.videos};let changed=0;
    for(const {videoId,...entry} of records(input,source,now)){
      const old=videos[videoId];
      // Seeing the same native bar on repeated page visits isn't a new watch.
      if(old&&source!=='history-file'&&(entry.percent||0)<=(old.percent||0))continue;
      const percent=Math.max(old?.percent||0,entry.percent||0);
      if(old&&entry.seenAt<=old.seenAt&&percent===(old.percent||0))continue;
      videos[videoId]={seenAt:Math.max(old?.seenAt||0,entry.seenAt),source:old&&old.seenAt>entry.seenAt?old.source:source,...(percent?{percent}: {})};changed++;
    }
    const ordered=Object.entries(videos).sort((a,b)=>b[1].seenAt-a[1].seenAt||a[0].localeCompare(b[0]));
    return {value:{version:1,videos:Object.fromEntries(ordered.slice(0,limit))},changed,trimmed:Math.max(0,ordered.length-limit)};
  }
  function parseJSON(text){
    let input;try{input=JSON.parse(text);}catch{throw Error('This file is not valid JSON.');}
    if(!Array.isArray(input))throw Error('Choose a YouTube watch-history JSON export, not a Ledger profile backup.');
    const found=new Map();
    for(const row of input){
      if(!row||typeof row!=='object'||!(row.header==='YouTube'||Array.isArray(row.products)&&row.products.includes('YouTube')))continue;
      const id=videoId(row.titleUrl),at=Date.parse(row.time);if(!id||!Number.isFinite(at)||at<1||at>Date.now()+300000)continue;
      found.set(id,{videoId:id,seenAt:Math.max(found.get(id)?.seenAt||0,at)});
    }
    if(!found.size)throw Error('No YouTube watch-history entries were found. Search history and entries without video links are skipped.');
    return {records:[...found.values()].sort((a,b)=>b.seenAt-a.seenAt).slice(0,limit),omitted:Math.max(0,found.size-limit)};
  }
  function parseHTML(text){
    const template=document.createElement('template');template.innerHTML=text;
    const found=new Set();
    for(const card of template.content.querySelectorAll('.outer-cell'))for(const link of card.querySelectorAll('.content-cell a[href]')){
      const id=videoId(link.getAttribute('href'));if(id)found.add(id);
    }
    if(!found.size)throw Error('No YouTube entries were found in this history HTML export. Choose your watch-history file.');
    return {records:[...found].slice(0,limit).map(videoId=>({videoId,seenAt:1})),omitted:Math.max(0,found.size-limit)};
  }
  async function handle(message,sender){
    const youtube=sender.tab&&!sender.tab.incognito&&/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||'');
    const dashboard=!sender.tab?.incognito&&(sender.url||'').split(/[?#]/)[0]===browser.runtime.getURL('dashboard.html');
    if(!youtube&&!dashboard)throw Error('Open Ledger or YouTube to update watch status.');
    if(message.type==='watchEvidence:open'){
      await browser.tabs.create({url:'https://www.youtube.com/feed/history#ledger-watch-check'});return {ok:true};
    }
    const importing=message.type==='watchEvidence:import',passive=message.type==='watchEvidence:observe';
    if(!importing&&!passive)throw Error('Unknown watch-status request.');
    if(passive&&(!youtube||!['youtube-progress','youtube-history'].includes(message.source)||!Array.isArray(message.records)||message.records.length>100))throw Error('Invalid YouTube watch evidence.');
    const input=records(message.records,importing?'history-file':message.source);
    return LedgerStorage.write(async()=>{
      const local=await browser.storage.local.get([key,'settings','paused']);
      const explicit=youtube&&new URL(sender.url).pathname==='/feed/history'&&new URL(sender.url).hash==='#ledger-watch-check';
      if(passive&&!explicit&&(local.paused||!Ledger.settings(local.settings).learnYouTubeProgress))return {ok:true,changed:0};
      const result=merge(local[key],input,importing?'history-file':message.source);
      if(result.changed)await browser.storage.local.set({[key]:result.value});
      return {ok:true,changed:result.changed,recognized:input.length,trimmed:result.trimmed};
    });
  }
  return {key,limit,videoId,records,merge,parseJSON,parseHTML,handle};
})();
