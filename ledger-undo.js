/* Short-lived, conflict-checked undo. Tokens stay in this browser session. */
globalThis.LedgerUndo=(()=>{
  const key='ledgerUndo:v1',ttl=5*60*1000;
  const at=(data,path)=>path.reduce((value,part)=>value?.[part],data);
  async function encode(value){
    const payload=JSON.stringify(value);
    if(payload.length<16384||!globalThis.CompressionStream)return {payload,compressed:false};
    const bytes=new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {payload:btoa(binary),compressed:true};
  }
  async function decode(entry){
    if(entry.edits)return entry; // In-flight undo from an earlier runtime.
    if(!entry.compressed)return JSON.parse(entry.payload);
    const bytes=Uint8Array.from(atob(entry.payload),c=>c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  async function record(edits,cache={}){
    const now=Date.now(),token=crypto.randomUUID(),stored=(await browser.storage.session.get(key))[key]||{},entry={at:now,...await encode({edits,cache})};
    const recent=Object.entries(stored).filter(([,v])=>now-v.at<ttl).sort((a,b)=>b[1].at-a[1].at).slice(0,19),records={[token]:entry};
    let size=JSON.stringify(entry).length;
    for(const [id,value] of recent){const bytes=JSON.stringify(value).length;if(size+bytes>2500000)break;records[id]=value;size+=bytes;}
    await browser.storage.session.set({[key]:records});return token;
  }
  async function handle(message,sender){
    if(sender.tab?.incognito||!((sender.url||'').split(/[?#]/)[0]===browser.runtime.getURL('dashboard.html')||/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||'')))throw new Error('Open Ledger to undo this change.');
    return LedgerStorage.write(async()=>{
      const records=(await browser.storage.session.get(key))[key]||{},record=records[message.token];
      if(!record||Date.now()-record.at>ttl)throw new Error('Undo has expired.');
      const entry=await decode(record);
      const keys=[...new Set(entry.edits.map(e=>e.key))],data=await browser.storage.local.get(keys);
      for(const e of entry.edits)if(JSON.stringify(at(data[e.key],e.path))!==JSON.stringify(e.after))throw new Error('This item changed since that action. Undo would overwrite a newer change.');
      for(const e of entry.edits){
        if(!e.path.length){data[e.key]=e.before;continue;}
        let parent=data[e.key];for(const part of e.path.slice(0,-1))parent=parent[part];
        if(e.before===undefined)delete parent[e.path.at(-1)];else parent[e.path.at(-1)]=e.before;
      }
      if(Object.keys(entry.cache||{}).length){
        const cache=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1']||{version:1,channels:{}};
        for(const [id,value] of Object.entries(entry.cache))if(!cache.channels[id])cache.channels[id]=value;
        // Use the cache's normal limits when reinstating a removed channel.
        const keep=new Set(Object.values(cache.channels).flatMap(c=>c.entries||[]).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,5000).map(v=>v.videoId));
        for(const c of Object.values(cache.channels))c.entries=(c.entries||[]).filter(v=>keep.has(v.videoId));data['channelUploads:v1']=cache;
      }
      await browser.storage.local.set(data);delete records[message.token];await browser.storage.session.set({[key]:records});return {ok:true};
    });
  }
  return {record,handle};
})();
