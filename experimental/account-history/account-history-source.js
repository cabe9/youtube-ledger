/* Experimental bounded reader. Daily checks read initial pages. Only a manual
 * check can request two more Google batches (three total). No tabs, player
 * lookups, retries, script execution, cookie access, or persisted request tokens. */
globalThis.AccountHistorySource = (() => {
  const maxBytes=6*1024*1024;
  const failure=(message,code='schema')=>Object.assign(new Error(message),{code,manualRetry:['schema','blocked','auth'].includes(code)});
  function retryAfter(value,now=Date.now()) {
    const text=typeof value==='string' ? value.trim() : '';
    // Retry-After is either integer seconds or an HTTP date. Do not interpret
    // malformed numeric values as dates, and never shorten our own cooldown.
    const at=/^\d+$/.test(text) ? now+Number(text)*1000 : /^[A-Za-z]{3}, /.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(at) && at>now ? Math.min(at,8640000000000000) : 0;
  }
  async function snapshot(url,signal,request=fetch,init=null) {
    const controller=new AbortController(),abort=()=>controller.abort();
    if (signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,15000);
    try {
      const response=await request(url,{method:'GET',...init,credentials:'include',redirect:'error',signal:controller.signal});
      const responseFailure=(message,code)=>Object.assign(failure(message,code),{httpStatus:response.status,retryAfterAt:retryAfter(response.headers.get('retry-after'))});
      if ([403,429].includes(response.status)) throw responseFailure(response.status===403 ? 'Google refused access to history (HTTP 403).' : 'Google limited history requests (HTTP 429).','blocked');
      if (response.status===401) throw responseFailure('History sign-in needs attention (HTTP 401).','auth');
      if (!response.ok) throw responseFailure(`History is temporarily unavailable (HTTP ${response.status}). No immediate retry will be made.`,'network');
      if (!(init ? /application\/(?:json|x-javascript)|text\/plain/i : /text\/html/i).test(response.headers.get('content-type') || '')) throw failure('History did not return the expected page. Automatic refresh is paused.');
      if (Number(response.headers.get('content-length'))>maxBytes) throw failure('History snapshot exceeded the conservative size limit.');
      const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
      try {
        while (true) {
          const {done,value}=await reader.read();if(done) break;
          size+=value.byteLength;if(size>maxBytes) throw failure('History snapshot exceeded the conservative size limit.');
          text+=decoder.decode(value,{stream:true});
        }
        return text+decoder.decode();
      } finally {await reader.cancel().catch(()=>{});}
    } catch (error) {
      if (error.code) throw error;
      throw failure('History could not be reached without a redirect or timed out. Check your connection and sign-in; cached data is kept.','network');
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  async function parseGoogle(html,options) {
    if (typeof document!=='undefined') return AccountHistoryParser.google(html,options);
    const url=chrome.runtime.getURL('account-history-offscreen.html');
    // A worker restart may leave its local parser behind. Reuse it and always
    // close it; no browser tab or remote document is opened here.
    const existing=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
    if (!existing.length) await chrome.offscreen.createDocument({url:'account-history-offscreen.html',reasons:['DOM_PARSER'],justification:'Parse a history HTML snapshot locally without executing or loading its contents.'});
    try {
      const response=await chrome.runtime.sendMessage({target:'ledger-history-parser',html,options});
      if (!response || response.error) throw failure(response?.error || 'The local history parser is unavailable.');
      return response.value;
    } finally {await chrome.offscreen.closeDocument();}
  }
  function create({request=fetch,parse=parseGoogle}={}) {
    async function read(options) {
      const {signal,onProgress=async()=>{},expanded,knownRecoveredKeys=[],...parserOptions}=options;
      await onProgress('Reading recent Google activity…');
      const googleHTML=await snapshot('https://myactivity.google.com/product/youtube?hl=en',signal,request);
      const activity=await parse(googleHTML,parserOptions);
      let batchesRead=1,hasMore=activity.cardCount>=100,stopReason='initial-snapshot';
      if (expanded) {
        const context=AccountHistoryRPC.bootstrap(googleHTML);
        let page=AccountHistoryRPC.page(context.initial,parserOptions);
        const byKey=new Map(page.records.map(row=>[row.videoId+':'+row.watchedAt,row]));
        // Validate the private schema against the actual rendered first-page
        // records before trusting it for older records that have no HTML cards.
        if (activity.records.some(row=>!byKey.has(row.videoId+':'+row.watchedAt))) throw failure('The older-history schema did not match the recent snapshot. Cached history has been kept.');
        activity.records=activity.records.map(row=>({...row,device:byKey.get(row.videoId+':'+row.watchedAt)?.device || row.device}));
        const cursors=new Set();hasMore=!!page.cursor;
        while (page.cursor && batchesRead<3 && (page.oldestTimestamp===null || Ledger.dayKey(page.oldestTimestamp)>=options.sinceDay)) {
          if (signal?.aborted) throw failure('History sync was cancelled.','cancelled');
          if (cursors.has(page.cursor)) throw failure('Google history stopped advancing. Cached history has been kept.');
          cursors.add(page.cursor);
          await onProgress(`Reading Google activity — batch ${batchesRead+1} of up to 3…`);
          const next=AccountHistoryRPC.request(context,page.cursor);
          const decoded=AccountHistoryRPC.response(await snapshot(next.url,signal,request,next.init));
          const incoming=AccountHistoryRPC.page(decoded,parserOptions,activity.cardCount);
          if (incoming.cursor && incoming.cursor===page.cursor) throw failure('Google history stopped advancing. Cached history has been kept.');
          if (incoming.newestTimestamp!==null && page.oldestTimestamp!==null && incoming.newestTimestamp>page.oldestTimestamp) throw failure('Google returned an inconsistent older-history batch. Cached history has been kept.');
          activity.records.push(...incoming.records);activity.cardCount+=incoming.cardCount;
          page=incoming;batchesRead++;hasMore=!!page.cursor;
        }
        stopReason=!page.cursor ? 'source-ended' : page.oldestTimestamp!==null && Ledger.dayKey(page.oldestTimestamp)<options.sinceDay ? 'date-limit' : 'batch-limit';
      }

      if (signal?.aborted) throw failure('History sync was cancelled.','cancelled');
      await onProgress('Matching YouTube videos and Shorts…');
      const yt=activity.records.length ? AccountHistoryParser.youtube(await snapshot('https://www.youtube.com/feed/history?hl=en',signal,request)) : {classifications:{}};
      const identity=activity.account.match(/\(([^()]+@[^()]+)\)/)?.[1]?.toLowerCase() || activity.account;
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
      const accountKey=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const occurrences=new Map(),events=[];
      for (const record of [...activity.records].reverse()) {
        const mediaType=yt.classifications[record.videoId];if (!mediaType) continue;
        const group=record.videoId+':'+record.watchedAt,occurrence=occurrences.get(group) || 0;
        occurrences.set(group,occurrence+1);
        const event=AccountHistory.normalize({...record,mediaType,occurrence,videoDurationSeconds:AccountHistory.parseDuration(record.durationText)},accountKey);
        if (event) events.push(event);
      }
      if (!events.length && activity.records.length) throw failure('The two history snapshots did not match. Check the signed-in accounts or history filters before retrying.');
      const known=new Set(knownRecoveredKeys);
      return {accountKey,events,coverage:{overlapCount:events.filter(e=>known.has(e.videoId+':'+e.watchedAt)).length,completeness:'unknown',batchesRead,hasMore,stopReason,sinceDay:options.sinceDay,googleCardCount:activity.cardCount,googleWatchCount:activity.records.length,
        classifiedCount:events.length,unclassifiedCount:activity.records.length-events.length,limited:true,
        oldestWatchedAt:activity.records.length ? Math.min(...activity.records.map(row=>row.watchedAt)) : null,
        newestWatchedAt:activity.records.length ? Math.max(...activity.records.map(row=>row.watchedAt)) : null,
        note:`Read ${batchesRead} Google batch(es), up to ${expanded ? 300 : 100} cards within 7 days. YouTube classification uses its initial page only. Overlap counts prior recovered imports, excluding direct playback; it does not prove completeness. Unmatched items, including possible ads, are omitted.`}};
    }
    return {read};
  }
  return {...create(),create,snapshot,retryAfter};
})();
