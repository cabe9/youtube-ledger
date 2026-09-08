/* Parse inert HTML snapshots only. No source JavaScript, images, frames, or links
 * are executed or loaded. YouTube classification is intentionally independent
 * of title, duration, or a /watch URL (Google includes watched ads). */
globalThis.AccountHistoryParser = (() => {
  function unavailable(message) {
    return Object.assign(new Error(message), {code:'schema',manualRetry:true});
  }
  function youtube(html) {
    const marker=/(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*/g.exec(html);
    if (!marker) throw unavailable('YouTube history format or sign-in changed. Automatic refresh is paused.');
    const start=marker.index+marker[0].length;
    if (html[start]!=='{') throw unavailable('YouTube history data is unavailable.');
    let depth=0,quoted=false,escaped=false,end=start;
    for (;end<html.length;end++) {
      const ch=html[end];
      if (quoted) { if (escaped) escaped=false;else if(ch==='\\') escaped=true;else if(ch==='"') quoted=false; }
      else if (ch==='"') quoted=true;
      else if (ch==='{') depth++;
      else if (ch==='}' && --depth===0) {end++;break;}
    }
    let data;
    try {data=JSON.parse(html.slice(start,end));} catch {throw unavailable('YouTube history data could not be parsed.');}
    if (data.responseContext?.mainAppWebResponseContext?.loggedOut) throw unavailable('Sign in to YouTube in this browser before retrying.');
    const tabs=data.contents?.twoColumnBrowseResultsRenderer?.tabs || data.contents?.singleColumnBrowseResultsRenderer?.tabs;
    const content=tabs?.find(tab=>tab.tabRenderer?.selected)?.tabRenderer.content;
    if (!content) throw unavailable('YouTube history layout changed. Automatic refresh is paused.');
    const classifications=Object.create(null),stack=[content];let visited=0;
    const valid=id=>typeof id==='string' && /^[\w-]{11}$/.test(id);
    while (stack.length) {
      if (++visited>100000) throw unavailable('YouTube history snapshot exceeded the parser limit.');
      const node=stack.pop();
      if (!node || typeof node!=='object') continue;
      for (const [key,value] of Object.entries(node)) {
        if (key==='shortsLockupViewModel') {
          const id=value?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
          if (valid(id)) classifications[id]='short';
        } else if (key==='reelItemRenderer' && valid(value?.videoId)) classifications[value.videoId]='short';
        else if (key==='videoRenderer' && valid(value?.videoId) && !classifications[value.videoId]) classifications[value.videoId]='video';
        else if (key==='lockupViewModel' && value?.contentType==='LOCKUP_CONTENT_TYPE_VIDEO' && valid(value.contentId) && !classifications[value.contentId]) classifications[value.contentId]='video';
        if (value && typeof value==='object') stack.push(value);
      }
    }
    return {classifications};
  }
  function google(html,options) {
    const template=document.createElement('template');template.innerHTML=html;
    const root=template.content;
    // Translation strings in bootstrap scripts are not an empty-history state.
    root.querySelectorAll('script,style,template').forEach(node=>node.remove());
    const account=root.querySelector('[aria-label^="Google Account:"]')?.getAttribute('aria-label');
    if (!account) throw unavailable('Sign in to Google My Activity and complete any verification before retrying.');
    const cards=[...root.querySelectorAll('[aria-label="Card showing an activity from YouTube"]')];
    if (!cards.length && !/No activity/i.test(root.textContent)) throw unavailable('Google history layout changed. Automatic refresh is paused.');
    const records=[];
    for (const [sourceOrder,card] of cards.slice(0,100).entries()) {
      const details=card.querySelector('[aria-label^="Open details of activity"]');
      if (!details?.getAttribute('aria-label')?.includes('Watched ')) continue;
      const links=[...card.querySelectorAll('a[href]')];
      const link=links.find(a=>{
        try {const u=new URL(a.getAttribute('href'));return a.textContent && u.hostname==='www.youtube.com' && u.pathname==='/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') || '');} catch {return false;}
      });
      // Deleted/unavailable activities can lack a video link and cannot be imported.
      if (!link) continue;
      const rawDay=card.closest('[data-date]')?.getAttribute('data-date');
      if (!/^\d{8}$/.test(rawDay || '')) throw unavailable('Some history dates could not be read. Cached history has been kept.');
      const day=rawDay.slice(0,4)+'-'+rawDay.slice(4,6)+'-'+rawDay.slice(6,8);
      if (day<options.sinceDay) continue;
      const watchTimeText=details.parentElement.textContent;
      const watchedAt=AccountHistory.parseWatchTime(day,watchTimeText);
      if (watchedAt===null) throw unavailable('Some history times could not be read. Cached history has been kept.');
      const channel=links.find(a=>/^https:\/\/www.youtube.com\/channel\/[\w-]+$/.test(a.getAttribute('href')));
      const videoId=new URL(link.getAttribute('href')).searchParams.get('v');
      records.push({videoId,title:link.textContent.trim(),channelName:channel?.textContent.trim() || '',
        channelId:channel?.getAttribute('href').split('/').at(-1) || null,watchedAt,
        watchTimeText:watchTimeText.replace(/\s*•\s*Details\s*$/,''),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        durationText:card.querySelector('.bI9urf')?.textContent || null,sourceOrder,
        device:options.knownDevices?.[videoId+':'+watchedAt] || null});
    }
    return {account,records,cardCount:Math.min(cards.length,100)};
  }
  return {youtube,google};
})();
