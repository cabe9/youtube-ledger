/* A local-first, per-record merge. Deletions are retained; concurrent alternatives are recoverable. */
globalThis.LedgerSyncModel=(()=>{
  const schema=1,limit=60000;
  const roots=['channelGroups:v1','channelUploads:v1','videoProgress:v1','watchEvidence:v1','groupBrowsing:v1'];
  const tracked=k=>roots.includes(k)||/^(day|recommendations|purposes|goals):\d{4}-\d{2}-\d{2}$/.test(k);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function project(data){
    const out={},put=(path,v)=>out[JSON.stringify(path)]=clone(v);
    for(const [key,value]of Object.entries(data)){
      if(!tracked(key))continue;
      if(/^(day|recommendations):/.test(key))for(const row of value)put([key,row.id],row);
      else if(key.startsWith('purposes:'))for(const [id,v]of Object.entries(value))put([key,id],v);
      else if(key.startsWith('goals:')){if(value)put([key],value);}
      else if(key==='channelGroups:v1'){
        if(value.groups.length||Object.keys(value.channels).length||value.collapsed)put([key,'meta'],{collapsed:!!value.collapsed,order:value.groups.map(g=>g.id)});
        for(const group of value.groups){put([key,'groups',group.id],group);for(const id of group.channelIds)put([key,'members',group.id,id],true);}
        for(const [id,v]of Object.entries(value.channels))put([key,'channels',id],v);
      }else if(key==='channelUploads:v1'){
        for(const [id,v]of Object.entries(value.channels||{})){
          if(!v.fetchedAt)continue;
          // Share usable metadata, never another browser's failures or retry schedule.
          const {error,failures,retryAt,retryAfter,attemptedAt,viewsAttemptedAt,...good}=v;put([key,'channels',id],good);
        }
      }else if(key==='groupBrowsing:v1'){
        for(const [id,v]of Object.entries(value.groups||{}))put([key,'groups',id],v);
        if(value.newVideos)put([key,'newVideos'],value.newVideos);
      }else for(const [id,v]of Object.entries(value.videos||{}))put([key,'videos',id],v);
    }
    return out;
  }
  const empty=()=>({schema,records:{},conflicts:{}});
  const dominates=(a,b)=>Object.entries(b).every(([id,n])=>(a[id]||0)>=n);
  const stamp=e=>[e.sequence,e.writer];
  const choose=(a,b)=>a.deleted!==b.deleted?(a.deleted?a:b):stamp(a)[0]!==stamp(b)[0]?(stamp(a)[0]>stamp(b)[0]?a:b):(a.writer>b.writer?a:b);
  function validate(doc){
    if(doc?.schema!==schema||!doc.records||Array.isArray(doc.records)||!doc.conflicts||Object.keys(doc.records).length>limit||Object.keys(doc.conflicts).length>limit)throw Error('Unsupported or oversized sync profile.');
    for(const [key,e]of [...Object.entries(doc.records),...Object.entries(doc.conflicts)]){
      if(['__proto__','constructor','prototype'].includes(key)||!e||!e.version||Array.isArray(e.version)||!/^[-\w]{36}$/.test(e.writer)||!Number.isSafeInteger(e.sequence)||e.sequence<1||e.sequence>e.version[e.writer]||!Number.isSafeInteger(e.version[e.writer])||e.version[e.writer]<1||Object.keys(e.version).length>32||Object.entries(e.version).some(([id,n])=>!/^[-\w]{36}$/.test(id)||!Number.isSafeInteger(n)||n<1)||typeof e.deleted!=='boolean'||!e.deleted&&!Object.hasOwn(e,'value'))throw Error('Invalid sync record.');
    }
    for(const key of Object.keys(doc.records)){let p;try{p=JSON.parse(key);}catch{throw Error('Invalid sync key.');}if(!Array.isArray(p)||!tracked(p[0])||p.length>4||p.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))throw Error('Invalid sync key.');}
    return doc;
  }
  function capture(doc,data,device){
    doc=clone(doc);const current=project(data);
    for(const key of new Set([...Object.keys(doc.records),...Object.keys(current)])){
      const previous=doc.records[key],present=Object.hasOwn(current,key);
      if(previous&&(previous.deleted?!present:present&&equal(previous.value,current[key])))continue;
      if(!previous&&!present)continue;
      doc.records[key]={version:{...previous?.version,[device]:(previous?.version?.[device]||0)+1},writer:device,sequence:(previous?.version?.[device]||0)+1,deleted:!present,...(present?{value:current[key]}:{})};
    }
    return validate(doc);
  }
  function merge(a,b){
    validate(a);validate(b);const out=clone(a);Object.assign(out.conflicts,clone(b.conflicts));
    for(const [key,right]of Object.entries(b.records)){
      const left=out.records[key];if(!left){out.records[key]=clone(right);continue;}
      if(dominates(left.version,right.version))continue;
      if(dominates(right.version,left.version)){out.records[key]=clone(right);continue;}
      let winner=choose(left,right);
      // A cache's last successful fetch is stronger evidence than device edit order.
      if(!left.deleted&&!right.deleted&&JSON.parse(key)[0]==='channelUploads:v1'&&left.value.fetchedAt!==right.value.fetchedAt)winner=left.value.fetchedAt>right.value.fetchedAt?left:right;
      const loser=winner===left?right:left;
      if(JSON.parse(key)[0]!=='channelUploads:v1'&&(left.deleted!==right.deleted||!equal(left.value,right.value)))out.conflicts[JSON.stringify([key,loser.writer,loser.version[loser.writer]])]=clone(loser);
      const version={...left.version};for(const [id,n]of Object.entries(right.version))version[id]=Math.max(n,version[id]||0);
      out.records[key]={...clone(winner),version};
    }
    return validate(out);
  }
  function materialize(doc){
    validate(doc);const data={},orders={},members={};
    for(const [key,e]of Object.entries(doc.records)){
      if(e.deleted)continue;const [root,kind,id,member]=JSON.parse(key),v=clone(e.value);
      if(/^(day|recommendations):/.test(root))(data[root]||=[]).push(v);
      else if(root.startsWith('purposes:'))(data[root]||={})[kind]=v;
      else if(root.startsWith('goals:'))data[root]=v;
      else if(root==='channelGroups:v1'){
        const g=data[root]||={version:1,groups:[],channels:{}};
        if(kind==='meta'){g.collapsed=v.collapsed;orders[root]=v.order;}
        else if(kind==='groups')g.groups.push(v);else if(kind==='channels')g.channels[id]=v;else if(kind==='members'){if(v!==true||!/^UC[\w-]{22}$/.test(member||''))throw Error('Invalid group membership.');(members[id]||=[]).push(member);}else throw Error('Invalid group sync record.');
      }else if(root==='groupBrowsing:v1'){
        const g=data[root]||={version:1,groups:{}};if(kind==='newVideos')g.newVideos=v;else if(kind==='groups')g.groups[id]=v;else throw Error('Invalid browsing sync record.');
      }else{
        const expected=root==='channelUploads:v1'?'channels':'videos';if(kind!==expected)throw Error('Invalid sync record collection.');(data[root]||={version:1,[expected]:{}})[expected][id]=v;
      }
    }
    const groups=data['channelGroups:v1'];if(groups){
      // Concurrent channel removal must not produce dangling group references.
      for(const g of groups.groups){const ids=(members[g.id]||[]).filter(id=>groups.channels[id]);g.channelIds=[...new Set([...(g.channelIds||[]).filter(id=>ids.includes(id)),...ids.sort()])];}
      const order=orders['channelGroups:v1']||[];groups.groups.sort((a,b)=>(order.indexOf(a.id)<0?1e6:order.indexOf(a.id))-(order.indexOf(b.id)<0?1e6:order.indexOf(b.id))||a.id.localeCompare(b.id));
    }
    for(const [k,v]of Object.entries(data))if(/^(day|recommendations):/.test(k))v.sort((a,b)=>(a.start??a.at)-(b.start??b.at)||a.id.localeCompare(b.id));
    return data;
  }
  const b64=bytes=>btoa(String.fromCharCode(...bytes));
  function unbase64(s){if(typeof s!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Invalid pairing code.');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
  const newSecret=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
  async function key(secret){const bytes=unbase64(secret);if(bytes.length!==32)throw Error('Use the complete pairing code from your other browser.');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
  async function namespace(secret){await key(secret);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',unbase64(secret)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  async function seal(doc,secret){validate(doc);const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(doc));if(plain.length>20000000)throw Error('Sync profile exceeds 20 MB.');const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('ledger-local-sync-v1')},await key(secret),plain));let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {v:1,iv:b64(iv),data:btoa(binary)};}
  async function open(envelope,secret){if(envelope?.v!==1||typeof envelope.data!=='string'||envelope.data.length>28000000)throw Error('Invalid encrypted sync profile.');try{const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(envelope.iv),additionalData:new TextEncoder().encode('ledger-local-sync-v1')},await key(secret),unbase64(envelope.data));return validate(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw Error('Could not decrypt sync data. Check the pairing code; no local data was changed.');}}
  return {tracked,project,empty,capture,merge,materialize,validate,newSecret,namespace,seal,open};
})();
