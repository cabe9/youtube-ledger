/* Portable group lists, deliberately separate from private profile backups. */
globalThis.GroupSharing = (() => {
  const format='youtube-ledger-groups',maxBytes=10*1024*1024,key='channelGroups:v1';
  const channelId=/^UC[A-Za-z0-9_-]{22}$/;
  const cleanName=(value,max,label)=>{
    if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('This file has an invalid '+label+'.');
    return value.trim().replace(/\s+/g,' ');
  };
  function validate(value){
    if(value?.format!==format)throw new Error('Choose a shared groups file from Ledger’s Share groups button. Profile backups belong in Settings.');
    if(value.schemaVersion!==1)throw new Error('This groups file needs a newer version of Ledger.');
    if(!Array.isArray(value.groups)||!value.groups.length||value.groups.length>200||!Array.isArray(value.channels)||value.channels.length>10000)throw new Error('A shared file can contain up to 200 groups and 10,000 channels.');
    const channels=new Map();
    for(const c of value.channels){
      if(!c||typeof c.id!=='string'||!channelId.test(c.id)||channels.has(c.id))throw new Error('This file has an invalid or repeated channel.');
      channels.set(c.id,{id:c.id,name:cleanName(c.name,200,'channel name')});
    }
    let imageBytes=0;
    const groups=value.groups.map(g=>{
      const name=cleanName(g?.name,80,'group name');
      if(!Array.isArray(g.channelIds)||g.channelIds.length>2000||g.channelIds.some(id=>!channels.has(id)))throw new Error('This file has an incomplete channel list or more than 2,000 channels in a group.');
      const icon=GroupIcons.normalize(g.icon);if(icon.kind==='image')imageBytes+=icon.value.length;
      return {name,icon,channelIds:[...new Set(g.channelIds)]};
    });
    if(imageBytes>GroupIcons.imageBudget)throw new Error('This file contains too many group images. Ask the sender to share without icons.');
    const used=new Set(groups.flatMap(g=>g.channelIds));
    return {format,schemaVersion:1,groups,channels:[...channels.values()].filter(c=>used.has(c.id))};
  }
  function parse(text){
    if(typeof text!=='string'||text.length>maxBytes||new TextEncoder().encode(text).length>maxBytes)throw new Error('Choose a groups file under 10 MB.');
    let value;try{value=JSON.parse(text);}catch{throw new Error('This file is not valid JSON. Choose a Ledger groups file.');}
    return validate(value);
  }
  function exportGroups(state,ids,includeIcons=true){
    if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw new Error('Choose at least one group to share.');
    const groups=ids.map(id=>{
      const g=state?.groups?.find(g=>g.id===id);if(!g)throw new Error('The group list changed. Close Share groups and try again.');
      return {name:g.name,channelIds:[...g.channelIds],...(includeIcons?{icon:GroupIcons.normalize(g.icon)}:{})};
    });
    const channels=[...new Set(groups.flatMap(g=>g.channelIds))].map(id=>({id,name:state.channels[id]?.name}));
    // Project both directions: never copy local IDs, timestamps, preferences,
    // avatars, playback, labels, caches, or future private fields into the file.
    const portable=validate({format,schemaVersion:1,groups,channels});
    if(!includeIcons)for(const group of portable.groups)delete group.icon;
    const text=JSON.stringify(portable);
    if(new TextEncoder().encode(text).length>maxBytes)throw new Error('These groups exceed 10 MB. Share fewer groups at a time.');
    return text;
  }
  function selection(bundle,indices){
    if(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=bundle.groups.length))throw new Error('Choose at least one group to import.');
    return [...indices].sort((a,b)=>a-b);
  }
  function plan(state,bundle,indices){
    const names=new Set((state?.groups||[]).map(g=>g.name.toLocaleLowerCase()));
    return selection(bundle,indices).map(index=>{
      const group=bundle.groups[index];let name=group.name,n=2;
      while(names.has(name.toLocaleLowerCase())){const suffix=' ('+n+')';n++;name=group.name.slice(0,80-suffix.length).trimEnd()+suffix;}
      names.add(name.toLocaleLowerCase());return {index,...group,importName:name};
    });
  }
  function importGroups(state,bundle,indices,includeIcons=true,id=()=>crypto.randomUUID(),now=Date.now()){
    const result=structuredClone(state||{version:1,groups:[],channels:{}}),planned=plan(result,bundle,indices);
    if(result.groups.length+planned.length>200)throw new Error('Ledger holds up to 200 groups. Choose fewer groups to import.');
    const images=result.groups.reduce((n,g)=>n+(g.icon?.kind==='image'?g.icon.value.length:0),0)+planned.reduce((n,g)=>n+(includeIcons&&g.icon.kind==='image'?g.icon.value.length:0),0);
    if(images>GroupIcons.imageBudget)throw new Error('Your group images are near the storage limit. Uncheck Include group icons and try again.');
    const channels=new Map(bundle.channels.map(c=>[c.id,c]));
    for(const g of planned){
      result.groups.push({id:id(),name:g.importName,channelIds:[...g.channelIds],...(includeIcons?{icon:g.icon}:{}),createdAt:now,updatedAt:now});
      for(const cid of g.channelIds)if(!Object.hasOwn(result.channels,cid))result.channels[cid]={...channels.get(cid),url:'https://www.youtube.com/channel/'+cid};
    }
    return result;
  }
  async function handle(message){
    if(message.type==='channelGroups:share:export'){
      const state=(await browser.storage.local.get(key))[key];
      return {text:exportGroups(state,message.ids,message.includeIcons!==false)};
    }
    const bundle=parse(message.text);
    if(message.type==='channelGroups:share:preview'){
      return {...bundle,groups:bundle.groups.map((g,index)=>({...g,index}))};
    }
    if(message.type!=='channelGroups:share:import')throw new Error('Unknown sharing request.');
    return LedgerStorage.write(async()=>{
      const before=(await browser.storage.local.get(key))[key];
      const after=importGroups(before,bundle,message.indices,message.includeIcons!==false);
      try{await browser.storage.local.set({[key]:after});}
      catch(error){if(LedgerStorage.quotaError(error))throw new Error('Browser storage is full. Try importing fewer groups or uncheck Include group icons.');throw error;}
      return {groups:after.groups.slice(before?.groups.length||0).map(g=>({id:g.id,name:g.name})),channels:new Set(selection(bundle,message.indices).flatMap(i=>bundle.groups[i].channelIds)).size};
    });
  }
  return {maxBytes,validate,parse,exportGroups,plan,importGroups,handle};
})();
