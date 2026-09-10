/* Read a channel's public uploads list. Never execute downloaded scripts or follow continuations. */
globalThis.UploadsPage=(()=>{
  const channelPattern=/^UC[A-Za-z0-9_-]{22}$/,videoPattern=/^[A-Za-z0-9_-]{11}$/;
  const playlistId=id=>'UU'+id.slice(2);
  const url=id=>'https://www.youtube.com/playlist?list='+playlistId(id)+'&hl=en';
  const text=value=>typeof value?.content==='string'?value.content:typeof value?.simpleText==='string'?value.simpleText:Array.isArray(value?.runs)?value.runs.map(r=>r.text||'').join(''):'';
  function publication(label,at){
    const match=/^(?:(?:Streamed|Premiered)\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s? ago$/i.exec(label);
    if(!match)return;
    const units={second:1000,minute:60000,hour:3600000,day:86400000,week:604800000,month:2629800000,year:31557600000};
    const value=at-Number(match[1])*units[match[2].toLowerCase()];
    return Number.isFinite(value)&&value>=0?value:undefined;
  }
  function views(label,checkedAt){
    if(/^No views$/i.test(label))return {count:0,checkedAt};
    const match=/^([\d,]+(?:\.\d+)?)([KMB])? views?$/i.exec(label);
    if(!match)return;
    const count=Math.round(Number(match[1].replaceAll(',',''))*({K:1e3,M:1e6,B:1e9}[match[2]?.toUpperCase()]||1));
    return Number.isSafeInteger(count)&&count>=0?{count,checkedAt,...(match[2]?{approximate:true}:{})}:undefined;
  }
  function duration(label){
    if(!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(label))return;
    const parts=label.split(':').map(Number);if(parts.slice(1).some(v=>v>=60))return;
    const value=parts.reduce((n,v)=>n*60+v,0);return value>0&&value<=604800?value:undefined;
  }
  function parse(data,id,checkedAt=Date.now()){
    const expected=playlistId(id),header=data?.header?.playlistHeaderRenderer;
    const owner=data?.sidebar?.playlistSidebarRenderer?.items?.find(v=>v.playlistSidebarSecondaryInfoRenderer)?.playlistSidebarSecondaryInfoRenderer?.videoOwner?.videoOwnerRenderer;
    if(!channelPattern.test(id)||header?.playlistId!==expected||owner?.navigationEndpoint?.browseEndpoint?.browseId!==id)throw Error('Could not verify this channel’s uploads page.');
    const channel=text(owner.title).trim().slice(0,200);if(!channel)throw Error('The uploads page is missing its channel name.');
    const tabs=data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    const selected=tabs?.find(v=>v.tabRenderer?.selected)?.tabRenderer?.content;
    if(!selected)throw Error('YouTube returned an unreadable uploads list.');
    // Descend only through list containers, not menus, recommendations or page commands.
    const blocks=[];
    function collect(node,depth=0){
      if(!node||depth>8||blocks.length>200)return;
      if(Array.isArray(node)){for(const item of node)collect(item,depth+1);return;}
      if(node.lockupViewModel||node.playlistVideoRenderer){blocks.push(node);return;}
      for(const key of ['sectionListRenderer','itemSectionRenderer','playlistVideoListRenderer','richGridRenderer','richItemRenderer','contents','content'])if(node[key])collect(node[key],depth+1);
    }
    collect(selected);
    if(!blocks.length)throw Error('YouTube did not provide readable uploads on this page.');
    const entries=[];
    for(const block of blocks.slice(0,100)){
      const item=block.lockupViewModel,legacy=block.playlistVideoRenderer;
      let videoId,title,labels,badges,command,owners;
      if(item){
        if(item.contentType!=='LOCKUP_CONTENT_TYPE_VIDEO')continue;
        videoId=item.contentId;const metadata=item.metadata?.lockupMetadataViewModel;
        title=text(metadata?.title);
        const parts=metadata?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(r=>r.metadataParts||[])||[];
        labels=parts.map(p=>text(p.text));
        owners=parts.flatMap(p=>p.text?.commandRuns||[]).map(r=>r.onTap?.innertubeCommand?.browseEndpoint?.browseId).filter(Boolean);
        command=item.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
        badges=(item.contentImage?.thumbnailViewModel?.overlays||[]).flatMap(v=>v.thumbnailBottomOverlayViewModel?.badges||[]).map(v=>v.thumbnailBadgeViewModel?.text||'');
      }else{
        videoId=legacy.videoId;title=text(legacy.title);labels=[text(legacy.videoInfo),text(legacy.publishedTimeText),text(legacy.viewCountText)];
        // Older renderers combine the count and publication age in videoInfo.
        labels=labels.flatMap(v=>v.split(/\s+[•·]\s+/));
        owners=(legacy.shortBylineText?.runs||[]).map(r=>r.navigationEndpoint?.browseEndpoint?.browseId).filter(Boolean);
        command=legacy.navigationEndpoint?.watchEndpoint;badges=[text(legacy.lengthText)];
      }
      if(!videoPattern.test(videoId)||command?.videoId!==videoId||command.playlistId!==expected||!owners.length||owners.some(v=>v!==id))throw Error('An upload did not match the requested channel.');
      if(!title.trim())continue;
      const age=labels.find(label=>publication(label,checkedAt)!==undefined),publishedAt=publication(age||'',checkedAt);
      // Missing dates are not zero or today's date. Cached copies are retained by the caller.
      if(publishedAt===undefined)continue;
      const count=labels.map(label=>views(label,checkedAt)).find(Boolean),seconds=badges.map(duration).find(Boolean);
      const details=seconds?{status:'available',duration:seconds,checkedAt,shorts:'unknown'}:undefined;
      entries.push({videoId,channelId:id,channel,title:title.trim().slice(0,500),publishedAt,publishedAtEstimated:true,...(count?{views:count}:{}),...(details?{details}:{})});
      if(entries.length===30)break;
    }
    if(!entries.length)throw Error('YouTube did not provide dated uploads on this page.');
    return [...new Map(entries.map(v=>[v.videoId,v])).values()];
  }
  async function read(response){
    if(!response.body?.getReader){const html=await response.text();if(html.length>8000000)throw Error('The uploads page was too large.');return ChannelGroups.assignedJSON(html,'ytInitialData');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let html='',bytes=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8000000)throw Error('The uploads page was too large.');html+=decoder.decode(value,{stream:true});const data=ChannelGroups.assignedJSON(html,'ytInitialData');if(data)return data;}}
    finally{await reader.cancel().catch(()=>{});}
    return null;
  }
  const eligible=error=>[404,500,502,503,504].includes(error?.youtubeStatus)&&!(error.retryAfter>Date.now());
  return {url,parse,read,eligible};
})();
