/* Recognizable media, with stable image nodes and no remote URLs outside YouTube. */
globalThis.LedgerMedia = (() => {
  const css = `
    .ledger-avatar{position:relative;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 24px;overflow:hidden;border-radius:50%;background:var(--panel);color:var(--quiet);font-size:12px}
    .ledger-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .ledger-channel{display:inline-flex;align-items:center;gap:8px;min-width:0;color:inherit;text-decoration:none}
    a.ledger-channel:hover span:last-child{text-decoration:underline}
  `;
  function image(src) {
    const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    img.addEventListener('load',()=>{img.loading='eager';});
    img.addEventListener('error',()=>{img.hidden=true;});
    img.src=src;return img;
  }
  function avatar(channel) {
    const node=document.createElement('span');node.className='ledger-avatar';node.setAttribute('aria-hidden','true');
    node.textContent=Array.from(channel?.name||'C')[0];
    const src=Ledger.avatarURL(channel?.avatarUrl);if(src)node.append(image(src.replace(/=s\d+(?=-c(?:-|$))/,'=s88')));return node;
  }
  function channelLink(channel) {
    const url=Ledger.channelURL(channel?.url || (/^UC[\w-]{22}$/.test(channel?.id||'')?'https://www.youtube.com/channel/'+channel.id:'')),node=document.createElement(url?'a':'span');node.className='ledger-channel';
    if(/^UC[\w-]{22}$/.test(channel?.id||''))node.dataset.channelId=channel.id;
    node.dataset.avatar=Ledger.avatarURL(channel?.avatarUrl);
    if(url){node.href=url;node.target='_blank';node.rel='noopener noreferrer';}
    const label=document.createElement('span');label.textContent=channel?.name||'YouTube channel';node.append(avatar(channel),label);return node;
  }
  function updateChannels(root,channels){
    for(const link of root.querySelectorAll('.ledger-channel[data-channel-id]')){
      const channel=channels[link.dataset.channelId];if(!channel)continue;
      const src=Ledger.avatarURL(channel.avatarUrl);if(link.dataset.avatar!==src){link.dataset.avatar=src;link.firstElementChild.replaceWith(avatar(channel));}
      if(link.lastElementChild.textContent!==channel.name)link.lastElementChild.textContent=channel.name||'YouTube channel';
    }
  }
  function knownChannels(groups,uploads) {
    const videos=new Map();
    for(const [id,cache] of Object.entries(uploads?.channels||{})){
      const channel=groups?.channels?.[id];if(!channel)continue;
      for(const entry of cache.entries||[])if(entry.channelId===id)videos.set(entry.videoId,channel);
    }
    return videos;
  }
  function updateVideoCell(cell,row,known) {
    let content=cell.querySelector('.ledger-video-content');
    if(!content){content=document.createElement('div');content.className='ledger-video-content';const text=document.createElement('div');text.className='ledger-video-copy';const title=document.createElement('a');title.className='ledger-video-title';title.target='_blank';title.rel='noopener noreferrer';const byline=document.createElement('small');byline.className='ledger-byline';const sources=document.createElement('small');sources.className='source-badges';text.append(title,byline,sources);content.append(text);cell.append(content);}
    let thumbnail=content.querySelector('.ledger-video-thumbnail');
    if(/^[\w-]{11}$/.test(row.videoId||'')){
      if(!thumbnail){thumbnail=document.createElement('a');thumbnail.className='ledger-video-thumbnail';thumbnail.tabIndex=-1;thumbnail.setAttribute('aria-hidden','true');thumbnail.target='_blank';thumbnail.rel='noopener noreferrer';thumbnail.append(image('https://i.ytimg.com/vi/'+row.videoId+'/mqdefault.jpg'));content.prepend(thumbnail);}
      thumbnail.href=row.url;
    }else thumbnail?.remove();
    const title=content.querySelector('.ledger-video-title');title.textContent=row.title;title.href=row.url;
    const byline=content.querySelector('.ledger-byline');
    // Cached uploads supply identity by video ID, never by a display-name match.
    const channel={name:row.channel||known?.name||'YouTube video',url:known?.url||row.channelUrl,avatarUrl:known?.avatarUrl||row.channelAvatarUrl};
    const signature=JSON.stringify([row.videoId,channel]);
    if(byline.dataset.media!==signature){byline.dataset.media=signature;byline.replaceChildren(row.videoId?channelLink(channel):document.createTextNode('No video playing'));}
    return content.querySelector('.source-badges');
  }
  // One request per group/member-list visit. The background deduplicates and caches lookups.
  function portraits(ids) {try{browser.runtime.sendMessage({type:'channelGroups:portraits',ids:[...new Set(ids)].slice(0,200)}).catch(()=>{});}catch{}}
  return {css,image,avatar,channelLink,updateChannels,knownChannels,updateVideoCell,portraits};
})();
