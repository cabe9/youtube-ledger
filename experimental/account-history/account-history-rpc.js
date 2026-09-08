/* GitHub experiment: the read-only GetDisplayItems request used by Google's
 * own Load more control. Context and cursors exist only for one manual run.
 * Never execute page scripts, persist tokens, or call any other RPC method. */
globalThis.AccountHistoryRPC = (() => {
  const rpcId='y3VFHd';
  const invalid=()=>Object.assign(new Error('The older-history format changed. Cached history is kept; automatic checks are paused until you retry.'),{code:'schema',manualRetry:true});
  function arrayAt(text,start) {
    while (/\s/.test(text[start] || '') && start<text.length) start++;
    if (text[start]!=='[') throw invalid();
    let depth=0,quoted=false,escaped=false;
    for (let i=start;i<text.length;i++) {
      const ch=text[i];
      if (quoted) {if(escaped) escaped=false;else if(ch==='\\') escaped=true;else if(ch==='"') quoted=false;}
      else if(ch==='"') quoted=true;
      else if(ch==='[') depth++;
      else if(ch===']' && --depth===0) {try{return JSON.parse(text.slice(start,i+1));}catch{throw invalid();}}
    }
    throw invalid();
  }
  function bootstrap(html) {
    const request=/'(ds:\d+)'\s*:\s*\{id:'y3VFHd',request:/.exec(html);
    if (!request) throw invalid();
    const template=arrayAt(html,request.index+request[0].length);
    if (JSON.stringify(template[0])!=='[null,["youtube"]]' || template[2]!==100) throw invalid();
    const marker=new RegExp('AF_initDataCallback\\(\\{key:\\s*[\'\"]'+request[1]+'[\'\"][\\s\\S]*?data:').exec(html);
    if (!marker) throw invalid();
    const initial=arrayAt(html,marker.index+marker[0].length);
    const field=key=>{
      const found=new RegExp('"'+key+'"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")').exec(html);
      try {return found ? JSON.parse(found[1]) : null;} catch {throw invalid();}
    };
    const csrf=field('SNlM0e'),session=field('FdrFJe'),build=field('cfb2h');
    if (typeof csrf!=='string' || !csrf || csrf.length>8192) throw invalid();
    return {initial,template,csrf,session,build};
  }
  function request(context,cursor) {
    if (typeof cursor!=='string' || !cursor || cursor.length>16384) throw invalid();
    const payload=structuredClone(context.template);payload[1]=cursor;payload[2]=100;
    const url=new URL('https://myactivity.google.com/_/FootprintsMyactivityUi/data/batchexecute');
    for(const [key,value] of Object.entries({rpcids:rpcId,'source-path':'/product/youtube',hl:'en',rt:'c','f.sid':context.session,bl:context.build})) if(value) url.searchParams.set(key,value);
    const body=new URLSearchParams({'f.req':JSON.stringify([[[rpcId,JSON.stringify(payload),null,'generic']]]),at:context.csrf}).toString();
    return {url:url.href,init:{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body}};
  }
  function response(text) {
    if (!text.startsWith(")]}'")) throw invalid();
    for (const line of text.split('\n')) {
      if (!line.startsWith('[')) continue;
      let frames;try{frames=JSON.parse(line);}catch{continue;}
      if (!Array.isArray(frames)) continue;
      const frame=frames.find(row=>Array.isArray(row) && row[0]==='wrb.fr' && row[1]===rpcId);
      if (frame && typeof frame[2]==='string') {try{return JSON.parse(frame[2]);}catch{throw invalid();}}
    }
    throw invalid();
  }
  function page(data,options={},offset=0) {
    if (!Array.isArray(data?.[0]) || data[0].length>100 || (data[1]!=null && typeof data[1]!=='string')) throw invalid();
    const records=[],timestamps=[];
    for(const [index,row] of data[0].entries()) {
      if (!Array.isArray(row) || !Number.isSafeInteger(Number(row[4]))) throw invalid();
      const timestamp=Number(row[4])/1000;
      if(timestamp<946684800000 || timestamp>Date.now()+300000) throw invalid();
      timestamps.push(timestamp);
      const heading=row[9];
      // These are the exact product/prefix/link fields rendered by the page.
      // Search activity, deleted links, comments, and non-YouTube targets stay out.
      if(row[7]?.[0]!=='YouTube' || heading?.[2]!=='Watched') continue;
      let url;try{url=new URL(heading[3]);}catch{continue;}
      if(url.hostname!=='www.youtube.com' || url.pathname!=='/watch' || !/^[\w-]{11}$/.test(url.searchParams.get('v') || '')) continue;
      if(typeof heading[0]!=='string' || !heading[0].trim()) throw invalid();
      if(options.sinceDay && Ledger.dayKey(timestamp)<options.sinceDay) continue;
      const videoId=url.searchParams.get('v'),watchedAt=Math.floor(timestamp/60000)*60000;
      const channel=(Array.isArray(row[32]) ? row[32] : []).find(link=>Array.isArray(link) && /^https:\/\/www.youtube.com\/channel\/UC[\w-]{22}$/.test(link[3] || ''));
      const device=(Array.isArray(row[19]) ? row[19] : []).map(value=>value?.[0]).find(value=>typeof value==='string' && /^(iOS|Android|Windows|macOS|Mac OS|Macintosh|Linux|Chrome OS|TV|Smart TV|YouTube on TV)$/i.test(value));
      records.push({videoId,title:heading[0],channelName:channel?.[1] || '',channelId:channel?.[3]?.split('/').at(-1) || null,
        watchedAt,watchTimeText:new Date(watchedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,durationText:row[23]?.[1] || null,
        device:device || options.knownDevices?.[videoId+':'+watchedAt] || null,sourceOrder:offset+index});
    }
    return {records,cardCount:data[0].length,cursor:data[1] || null,
      oldestTimestamp:timestamps.length ? Math.min(...timestamps) : null,
      newestTimestamp:timestamps.length ? Math.max(...timestamps) : null};
  }
  return {bootstrap,request,response,page};
})();
