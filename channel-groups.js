/* Local channel-group storage and public YouTube channel resolution. */
globalThis.ChannelGroups = (() => {
  const key = 'channelGroups:v1';
  const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
  const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
  const hosts = new Set(['www.youtube.com','youtube.com','m.youtube.com']);
  let writes = Promise.resolve();
  const resolutions = new Map();
  const portraitJobs = new Map(), portraitQueue = [];
  let portraitActive=0;
  function name(value) {
    const result = typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : '';
    if (!result || result.length > 80) throw new Error('Enter a group name between 1 and 80 characters.');
    return result;
  }
  function channel(value) {
    if (!value || !channelIdPattern.test(value.id) || typeof value.name !== 'string' || !value.name.trim()) throw new Error('Choose a valid YouTube channel.');
    const avatarUrl=Ledger.avatarURL(value.avatarUrl);
    return {id:value.id,name:value.name.trim().slice(0,200),url:'https://www.youtube.com/channel/'+value.id,...(avatarUrl?{avatarUrl}:{})};
  }
  function target(input) {
    let value = typeof input === 'string' ? input.trim() : '';
    if (value.length > 2000) throw new Error('That channel address is too long.');
    if (channelIdPattern.test(value)) value = 'https://www.youtube.com/channel/'+value;
    else if (value.startsWith('@')) value = 'https://www.youtube.com/'+value;
    else if (/^(www\.|m\.)?youtube\.com\//i.test(value)) value = 'https://'+value;
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a YouTube channel URL, @handle, or channel ID.'); }
    if (!hosts.has(url.hostname) || url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS YouTube channel address.');
    const parts = url.pathname.split('/').filter(Boolean);
    let path;
    if (parts[0]?.startsWith('@') && parts[0].length > 1) path = '/'+parts[0];
    else if (parts[0] === 'channel' && channelIdPattern.test(parts[1])) path = '/channel/'+parts[1];
    else if (['c','user'].includes(parts[0]) && parts[1]) path = '/'+parts.slice(0,2).join('/');
    else {
      const videoId = parts[0] === 'watch' ? url.searchParams.get('v') : parts[0] === 'shorts' ? parts[1] : null;
      if (!videoIdPattern.test(videoId || '')) throw new Error('Use a channel address or a YouTube video link.');
      return {url:'https://www.youtube.com/watch?v='+videoId,videoId};
    }
    return {url:'https://www.youtube.com'+path};
  }
  function decode(value) {
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity,key) => {
      if (key[0] !== '#') return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key.toLowerCase()];
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    });
  }
  function attributes(tag) {
    const result = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
    return result;
  }
  // Read only the named JSON assignment, never execute downloaded page scripts.
  function assignedJSON(html, variable) {
    const start = html.indexOf('var '+variable+' =');
    if (start < 0) return null;
    const begin = html.indexOf('{',start); if (begin < 0) return null;
    let depth=0, quoted=false, escaped=false;
    for (let i=begin;i<html.length;i++) {
      const c=html[i];
      if (quoted) { if (escaped) escaped=false; else if (c==='\\') escaped=true; else if (c==='"') quoted=false; }
      else if (c==='"') quoted=true;
      else if (c==='{') depth++;
      else if (c==='}' && --depth===0) { try { return JSON.parse(html.slice(begin,i+1)); } catch { return null; } }
    }
    return null;
  }
  function parsePage(html, request) {
    if (request.videoId) {
      const details = assignedJSON(html,'ytInitialPlayerResponse')?.videoDetails;
      if (details?.videoId !== request.videoId || !channelIdPattern.test(details?.channelId || '')) throw new Error('Could not identify this video’s channel. Try its channel URL in Groups.');
      return channel({id:details.channelId,name:details.author});
    }
    // YouTube can emit its canonical/OG tags after </head>. Exclude scripts,
    // then read document metadata rather than recommendation channel IDs.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
    const canonical = [...markup.matchAll(/<link\b[^>]*>/gi)].map(m=>attributes(m[0])).find(a=>a.rel==='canonical')?.href;
    let id;
    try { const u = new URL(canonical); if (hosts.has(u.hostname) && u.protocol==='https:') id=/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(u.pathname)?.[1]; } catch {}
    const expected = /\/channel\/(UC[A-Za-z0-9_-]{22})$/.exec(request.url)?.[1];
    if (!id || (expected && expected!==id)) throw new Error('Could not resolve this channel. Check the address and try again.');
    const meta = [...markup.matchAll(/<meta\b[^>]*>/gi)].map(m=>attributes(m[0]));
    return channel({id,name:meta.find(a=>a.property==='og:title')?.content,avatarUrl:meta.find(a=>a.property==='og:image')?.content});
  }
  async function resolve(input,background=false) {
    const request = target(input);
    const cached = resolutions.get(request.url);
    if (cached && Date.now()-cached.at < 5*60*1000){globalThis.YouTubeRequestLog?.skip({kind:'channel'},'cache');return cached.value;}
    const operation=async(fetchRequest=fetch)=>{
      const response = await fetchRequest(request.url,{credentials:'omit',signal:AbortSignal.timeout(15000)});
      globalThis.YouTubeRequests?.checkResponse(response);
      if (!response.ok) throw new Error('YouTube could not load that channel. Try again shortly.');
      const end = new URL(response.url);
      if (!hosts.has(end.hostname) || end.protocol!=='https:') throw new Error('YouTube redirected to another site. Try the channel URL.');
      const html = await response.text();
      if (html.length > 8000000) throw new Error('The YouTube response was too large. Try the channel URL.');
      return parsePage(html,request);
    };
    const value=globalThis.YouTubeRequests?await YouTubeRequests.run(operation,{priority:background?0:3,kind:'channel',reason:background?'channel-portrait':'channel-lookup',id:request.url}):await operation();
    if (resolutions.size >= 100) resolutions.clear();
    resolutions.set(request.url,{at:Date.now(),value});
    return value;
  }
  function pumpPortraits(){
    while(portraitActive<2 && portraitQueue.length){
      const {run,done}=portraitQueue.shift();portraitActive++;
      run().catch(()=>{}).finally(()=>{portraitActive--;done();pumpPortraits();});
    }
  }
  function portrait(id){
    if(portraitJobs.has(id))return portraitJobs.get(id);
    const task=new Promise(done=>{portraitQueue.push({done,run:async()=>{
      const before=(await browser.storage.local.get(key))[key]?.channels?.[id];
      if(!before||Date.now()-(before.avatarCheckedAt||0)<(before.avatarUrl?7:1)*86400000)return;
      let avatarUrl='';try{avatarUrl=(await resolve(before.url,true)).avatarUrl||'';}catch(error){if(error.name==='YouTubeCooldownError'||error.retryAfter>Date.now())return;}
      const save=async()=>{
        const current=(await browser.storage.local.get(key))[key],c=current?.channels?.[id];
        // A deletion or profile replacement during the request must stay intact.
        if(!c||JSON.stringify(c)!==JSON.stringify(before))return;
        if(avatarUrl)c.avatarUrl=avatarUrl;
        c.avatarCheckedAt=Date.now();await browser.storage.local.set({[key]:current});
      };
      if(globalThis.LedgerStorage)await LedgerStorage.write(save);
      else{const write=writes.then(save);writes=write.catch(()=>{});await write;}
    }});});
    portraitJobs.set(id,task);pumpPortraits();task.finally(()=>portraitJobs.delete(id));return task;
  }
  function change(state, message, id = () => crypto.randomUUID(), now = Date.now()) {
    const result = structuredClone(state || {version:1,groups:[],channels:{}});
    if (result.version!==1 || !Array.isArray(result.groups) || !result.channels) throw new Error('This group data is not supported by this version of Ledger.');
    const group = result.groups.find(g=>g.id===message.groupId);
    const saveChannel=c=>{result.channels[c.id]={...result.channels[c.id],...c};};
    if (['rename','icon','delete','membership','filter','shorts'].includes(message.action) && !group) throw new Error('That group no longer exists.');
    function unique(value) {
      const clean=name(value);
      if (result.groups.some(g=>(message.action!=='rename' || g.id!==group?.id) && g.name.toLocaleLowerCase()===clean.toLocaleLowerCase())) throw new Error('A group with that name already exists.');
      return clean;
    }
    if (message.action==='create') {
      if (result.groups.length>=200) throw new Error('You can create up to 200 groups.');
      const created={id:id(),name:unique(message.name),channelIds:[],createdAt:now,updatedAt:now};
      if(message.icon!==undefined)created.icon=GroupIcons.normalize(message.icon);
      if (message.channel) { const c=channel(message.channel); saveChannel(c); created.channelIds.push(c.id); }
      result.groups.push(created);
    } else if (message.action==='rename') { group.name=unique(message.name); group.updatedAt=now; }
    else if (message.action==='icon') { group.icon=GroupIcons.normalize(message.icon); group.updatedAt=now; }
    else if(message.action==='filter'){if(!['all','unwatched','started','watched','hidden'].includes(message.filter))throw new Error('Choose a watch filter.');group.watchFilter=message.filter;}
    else if(message.action==='shorts'){if(typeof message.hideShorts!=='boolean')throw new Error('Choose whether to hide Shorts.');group.hideShorts=message.hideShorts;}
    else if(message.action==='sort'){if(!group||!Object.hasOwn(Ledger.groupSorts,message.sort))throw new Error('Choose a sort order.');group.sort=message.sort;}
    else if(message.action==='collapse'){result.collapsed=message.collapsed===true;}
    else if(message.action==='reorder'){
      if(!Array.isArray(message.ids)||message.ids.length!==result.groups.length||new Set(message.ids).size!==result.groups.length||message.ids.some(id=>!result.groups.some(g=>g.id===id)))throw new Error('The group list changed. Try reordering again.');
      result.groups=message.ids.map(id=>result.groups.find(g=>g.id===id));
    }
    else if(message.action==='bulk'){
      if(!Array.isArray(message.groupIds)||!message.groupIds.length||message.groupIds.some(id=>!result.groups.some(g=>g.id===id)))throw new Error('Choose existing groups.');
      if(!Array.isArray(message.channels)||!message.channels.length||message.channels.length>2000)throw new Error('Choose between 1 and 2,000 channels.');
      const channels=message.channels.map(channel);
      for(const id of new Set(message.groupIds)){const g=result.groups.find(g=>g.id===id);g.channelIds=[...new Set([...g.channelIds,...channels.map(c=>c.id)])];if(g.channelIds.length>2000)throw new Error('This group has reached its channel limit.');g.updatedAt=now;}
      for(const c of channels)saveChannel(c);
    }
    else if (message.action==='delete') result.groups=result.groups.filter(g=>g!==group);
    else if (message.action==='membership') {
      const c=channel(message.channel);
      if (typeof message.member!=='boolean') throw new Error('Choose whether this channel belongs to the group.');
      if (message.member) {
        if (!group.channelIds.includes(c.id)) {
          if (group.channelIds.length>=2000) throw new Error('This group has reached its channel limit.');
          group.channelIds.push(c.id);
        }
        saveChannel(c);
      } else group.channelIds=group.channelIds.filter(value=>value!==c.id);
      group.updatedAt=now;
    } else throw new Error('Unknown group action.');
    if(message.icon?.kind==='image'&&result.groups.reduce((size,g)=>size+(g.icon?.kind==='image'?g.icon.value.length:0),0)>GroupIcons.imageBudget)throw new Error('Group images are using too much storage. Replace another image with a smaller file or a symbol, then try again.');
    const used = new Set(result.groups.flatMap(g=>g.channelIds));
    result.channels=Object.fromEntries(Object.entries(result.channels).filter(([id])=>used.has(id)));
    return result;
  }
  function allowed(sender) {
    if (sender.tab?.incognito) return false;
    const url=(sender.url || '').split(/[?#]/)[0];
    return url===browser.runtime.getURL('dashboard.html') || /^https:\/\/(www|m)\.youtube\.com\//.test(sender.url || '');
  }
  async function handle(message,sender) {
    if (!allowed(sender)) throw new Error('This page cannot edit Ledger groups.');
    if(message.type.startsWith('channelGroups:share:'))return GroupSharing.handle(message);
    if (message.type==='channelGroups:resolve') return resolve(message.input);
    if(message.type==='channelGroups:portraits'){
      if(!Array.isArray(message.ids)||message.ids.length>200||message.ids.some(id=>typeof id!=='string'||!channelIdPattern.test(id)))throw new Error('Choose valid channels.');
      await Promise.all([...new Set(message.ids)].map(portrait));return {ok:true};
    }
    if(message.type==='channelGroups:subscriptions'){await browser.tabs.create({url:'https://www.youtube.com/feed/channels'});return {ok:true};}
    if (message.type==='channelGroups:open') { await browser.tabs.create({url:browser.runtime.getURL('dashboard.html')+'#groups'}); return {ok:true}; }
    if (message.type==='channelGroups:get') return (await browser.storage.local.get(key))[key] || {version:1,groups:[],channels:{}};
    if (message.type!=='channelGroups:change') throw new Error('Unknown group request.');
    const task=(globalThis.LedgerStorage?.write.bind(LedgerStorage)||((fn)=>writes.then(fn)))(async()=>{
      const state=(await browser.storage.local.get(key))[key];
      const updated=change(state,message);
      const edits=[{key,path:[],before:state,after:updated}],storage={[key]:updated};
      if(message.action==='delete'){
        const library=(await browser.storage.local.get('groupBrowsing:v1'))['groupBrowsing:v1'];
        if(library?.groups[message.groupId]){edits.push({key:'groupBrowsing:v1',path:['groups',message.groupId],before:library.groups[message.groupId]});delete library.groups[message.groupId];storage['groupBrowsing:v1']=library;}
      }
      let undoToken;
      if(globalThis.LedgerUndo&&(message.action==='delete'||message.action==='membership'&&!message.member)){
        const ids=state.groups.find(g=>g.id===message.groupId)?.channelIds||[],cache=(await browser.storage.local.get('channelUploads:v1'))['channelUploads:v1']?.channels||{};
        undoToken=await LedgerUndo.record(edits,Object.fromEntries(ids.filter(id=>cache[id]&&!updated.channels[id]).map(id=>[id,cache[id]])));
      }
      await browser.storage.local.set(storage);
      return {...updated,...(undoToken?{undoToken}:{})};
    });
    writes=task.catch(()=>{});
    const updated=await task;
    if(globalThis.GroupFeeds&&['delete','membership','bulk'].includes(message.action))await GroupFeeds.prune();
    return updated;
  }
  return {key,target,assignedJSON,parsePage,change,handle};
})();
