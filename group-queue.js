/* An explicit, session-local queue. No YouTube playlist is created. */
globalThis.GroupQueue=(()=>{
  const key='groupQueues:v1',ttl=24*60*60*1000;let pending=Promise.resolve();
  const url=(token,step,videoId)=>'https://www.youtube.com/watch?v='+videoId+'#ledger-queue='+token+'&ledger-step='+step;
  async function persist(queues,keep){
    // Bound metadata as well as queue count; retain the queue being operated on.
    const ordered=Object.entries(queues).filter(([id])=>id!==keep).sort((a,b)=>b[1].at-a[1].at),result={};
    let size=0;if(queues[keep]){result[keep]=queues[keep];size=JSON.stringify(queues[keep]).length;}
    for(const [id,queue] of ordered){const bytes=JSON.stringify(queue).length;if(size+bytes>2500000)continue;result[id]=queue;size+=bytes;}
    await browser.storage.session.set({[key]:result});
  }
  function handle(message,sender){
    if(!sender.tab||sender.tab.incognito||!/^https:\/\/(www|m)\.youtube\.com\//.test(sender.url||''))throw new Error('Open a group on YouTube to play a queue.');
    const task=pending.then(async()=>{
      const stored=(await browser.storage.session.get(key))[key]||{},now=Date.now();
      const queues=Object.fromEntries(Object.entries(stored).filter(([,q])=>now-q.at<ttl).sort((a,b)=>b[1].at-a[1].at).slice(0,8));
      if(message.type==='groupQueue:create'){
        const local=await browser.storage.local.get([ChannelGroups.key,GroupFeeds.key,FeedLibrary.key]),group=local[ChannelGroups.key]?.groups.find(g=>g.id===message.groupId);
        if(!group)throw new Error('This group no longer exists.');
        if(!Array.isArray(message.videoIds)||!message.videoIds.length||message.videoIds.length>500||new Set(message.videoIds).size!==message.videoIds.length)throw new Error('Choose between 1 and 500 videos.');
        const available=new Map(group.channelIds.flatMap(id=>local[GroupFeeds.key]?.channels[id]?.entries||[]).map(e=>[e.videoId,e]));
        const hidden=new Set(local[FeedLibrary.key]?.groups[group.id]?.hidden||[]);
        const hiddenChannels=new Set(local[FeedLibrary.key]?.groups[group.id]?.hiddenChannels||[]);
        if(message.videoIds.some(id=>!available.has(id)||hidden.has(id)||hiddenChannels.has(available.get(id)?.channelId)))throw new Error('The feed changed. Refresh it and try again.');
        const index=message.startVideoId===undefined?0:message.videoIds.indexOf(message.startVideoId);
        if(index<0)throw new Error('Choose a video in this queue.');
        // Feed links need their destination synchronously for native new-tab and
        // context-menu actions. Only accept fresh UUIDs; never overwrite a queue.
        const token=message.token??crypto.randomUUID(),step=message.step??crypto.randomUUID(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(!uuid.test(token)||!uuid.test(step)||queues[token])throw new Error('Invalid queue link.');
        if(Object.keys(queues).length>=8)delete queues[Object.keys(queues).at(-1)];
        queues[token]={at:now,groupId:group.id,groupName:group.name,auto:false,entries:message.videoIds.map(id=>available.get(id)),steps:{[step]:{index,evidence:'group-queue-start'}}};
        await persist(queues,token);return {url:url(token,step,message.videoIds[index])};
      }
      const queue=queues[message.token],step=queue?.steps[message.step];
      if(!queue||!step||queue.entries[step.index]?.videoId!==message.videoId)return null;
      if(message.type==='groupQueue:get'){
        // Only a new automatic transition requests playback. Reload, Back and
        // reused links must not restart a video the user has deliberately paused.
        const startPlayback=queue.auto&&step.evidence==='group-queue-auto'&&!step.playbackClaimed;
        if(startPlayback){step.playbackClaimed=true;await persist(queues,message.token);}
        return {groupId:queue.groupId,groupName:queue.groupName,auto:queue.auto,index:step.index,entries:queue.entries,startPlayback};
      }
      if(message.type==='groupQueue:source'){
        const source={kind:'group',groupId:queue.groupId,groupName:queue.groupName,evidence:step.claimed?'group-queue-link':step.evidence,queueId:message.token,journey:step.claimed?null:step.journey};
        // Reload, Back and reused links retain their queue source without inventing
        // another automatic transition from the original predecessor.
        step.claimed=true;await persist(queues,message.token);return source;
      }
      if(message.type==='groupQueue:auto')queue.auto=message.auto===true;
      else if(message.type==='groupQueue:close')delete queues[message.token];
      else if(message.type==='groupQueue:step'){
        const index=message.index;
        if(!Number.isInteger(index)||index<0||index>=queue.entries.length)throw new Error('This queue has no video in that position.');
        if(message.automatic&&(!queue.auto||index!==step.index+1))throw new Error('Automatic continuation is off.');
        const next=crypto.randomUUID(),transition=message.automatic?'queue-auto':index===step.index+1?'queue-next':index===step.index-1?'queue-previous':'queue-select';
        queue.steps[next]={index,evidence:'group-'+transition,journey:Ledger.journey({previousVisitId:message.previousVisitId,previousVideoId:message.videoId,transition})};
        // Existing links can be revisited, but indefinite cycling is bounded.
        const steps=Object.entries(queue.steps);if(steps.length>1000)queue.steps=Object.fromEntries(steps.slice(-1000));
        await persist(queues,message.token);return {url:url(message.token,next,queue.entries[index].videoId)};
      }else throw new Error('Unknown queue request.');
      await persist(queues,message.token);return {ok:true};
    });pending=task.catch(()=>{});return task;
  }
  return {handle};
})();
