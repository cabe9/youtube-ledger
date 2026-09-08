// Browser integration with an unpacked extension, real playback, and controlled YouTube feeds/pages.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),C='UC'+'c'.repeat(22),V='a'.repeat(11);
const feedScript=fs.readFileSync(path.join(__dirname,'groups-feed.js'),'utf8');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-feeds-test-')),extension=path.join(__dirname,'dist/chrome');let context;
 const errors=[];
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const samples=8000*60,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  await worker.evaluate(({A,B,C,V})=>{
   const entry=(id,c,date,title)=>`<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${c}</yt:channelId><title>${title}</title><published>${date}</published></entry>`;
   const xml=(id)=>`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${id}</yt:channelId><title>${id===A?'Alpha':'Beta'}</title>${Array.from({length:15},(_,n)=>entry(id===A&&n===0?V:(id===A?'a':'b')+String(n).padStart(10,'0'),id,new Date(Date.UTC(2026,8,5,12-n-(id===B?0.5:0))).toISOString(),n===0&&id===A?'Newest episode':(id===A?'Alpha':'Beta')+' episode '+n)).join('')}</feed>`;
   const original=globalThis.fetch;globalThis.feedRequests=[];globalThis.feedOffline=false;
   const feedGate=new Promise(resolve=>{globalThis.releaseFeed=resolve;});
   const originalHandle=GroupFeeds.handle;globalThis.groupRefreshCalls=0;GroupFeeds.handle=(message,sender)=>{if(message.type==='groupFeed:refresh')groupRefreshCalls++;return originalHandle(message,sender);};
   globalThis.fetch=async(url,options)=>{if(!String(url).includes('/feeds/videos.xml'))return original(url,options);feedRequests.push({url:String(url),credentials:options.credentials});await feedGate;const id=new URL(url).searchParams.get('channel_id');const response=new Response(id===C||feedOffline?'Unavailable':xml(id),{status:id===C||feedOffline?503:200});Object.defineProperty(response,'url',{value:String(url)});return response;};
   return chrome.storage.local.set({settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A,B,C]},{id:'music',name:'Music',channelIds:[B]},{id:'empty',name:'Empty group',channelIds:[]}],channels:{[A]:{id:A,name:'Alpha'},[B]:{id:B,name:'Beta'},[C]:{id:C,name:'Offline channel'}}}});
  },{A,B,C,V});
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#362345"/></svg>'}));
  await context.route('https://www.youtube.com/**',route=>{
   const u=new URL(route.request().url());if(u.pathname==='/fixture.wav')return route.fulfill({contentType:'audio/wav',body:wav});
   // A new tab can briefly request assets from its initial document before the
   // controlled reload. Never answer a script request with the fixture's HTML.
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   const watch=u.pathname==='/watch',home=u.pathname==='/';
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Feed fixture - YouTube</title><style>div{margin:0;padding:0;background:transparent}body{margin:0;background:#110b1c;color:white;font:14px Arial}ytd-masthead{height:56px;display:block;background:#20102c;position:sticky;top:0;z-index:4}ytd-guide-renderer{display:block;position:fixed;width:220px;top:56px;bottom:0;overflow:auto}ytd-guide-section-renderer,ytd-guide-entry-renderer{display:block;padding:10px}ytd-mini-guide-renderer{display:none}ytd-page-manager{display:block;margin-left:220px}a{color:inherit}video{width:500px;height:150px}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-mini-guide-renderer{display:block;width:64px;position:fixed}ytd-page-manager{margin-left:64px}}</style></head><body><ytd-masthead><div id="center" style="display:flex"><yt-searchbox><input name="search_query" placeholder="Search YouTube"></yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer id="native-home"><a href="/">Home</a><a id="fixture-subscriptions" href="/feed/subscriptions">Subscriptions feed</a></ytd-guide-section-renderer><ytd-guide-section-renderer id="native-subscriptions"><h3>Subscriptions</h3><ytd-guide-entry-renderer><a href="/channel/${A}">Alpha</a></ytd-guide-entry-renderer></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-mini-guide-renderer><div id="items"></div></ytd-mini-guide-renderer><ytd-page-manager><ytd-browse page-subtype="${home?'home':u.pathname.startsWith('/channel')?'channels':'subscriptions'}" id="native-page">${home?`<ytd-rich-item-renderer><a href="/watch?v=${V}">Recommended episode</a></ytd-rich-item-renderer>`:'Native page'}${watch?`<ytd-watch-metadata><h1>Newest episode</h1><div id="channel-name"><a href="/channel/${A}">Alpha</a></div></ytd-watch-metadata><video autoplay src="/fixture.wav"></video><div id="related"><a href="/watch?v=bbbbbbbbbbb">Next recommendation</a></div>`:''}</ytd-browse></ytd-page-manager><script>
    document.getElementById('fixture-subscriptions').addEventListener('click',event=>{
      event.preventDefault();if(window.groupEntryProbe)groupEntryProbe.started=true;
      history.pushState({},'', '/feed/subscriptions');document.dispatchEvent(new Event('yt-navigate-start'));
      document.querySelector('video')?.pause();
      setTimeout(()=>{const native=document.getElementById('native-page');native.replaceChildren('Native subscriptions');native.setAttribute('page-subtype','subscriptions');document.querySelector('ytd-page-manager').replaceChildren(native);document.dispatchEvent(new Event('yt-navigate-finish'));},80);
    });
   </script></body></html>`});
  });
  const page=await context.newPage();await page.goto('https://www.youtube.com/');
  async function checkReinjection(){
    await page.locator('#ledger-groups-sidebar').waitFor({state:'attached'});
    const session=await context.newCDPSession(page),worlds=[],extensionId=new URL(worker.url()).host;
    session.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await session.send('Runtime.enable');
    const world=worlds.find(world=>world.name===extensionId||world.origin==='chrome-extension://'+extensionId);assert.ok(world);
    const hadFeed=await feedCount();
    await page.evaluate(()=>{for(const id of ['ledger-groups-sidebar','ledger-groups-mini','ledger-group-feed','ledger-group-view-style']){const host=document.getElementById(id);if(host)for(let n=0;n<3;n++)host.after(host.cloneNode(true));}});
    for(let n=0;n<5;n++){const result=await session.send('Runtime.evaluate',{contextId:world.id,expression:feedScript});assert.equal(result.exceptionDetails,undefined);}
    await page.waitForFunction(()=>document.querySelectorAll('#ledger-groups-sidebar').length===1&&document.querySelectorAll('#ledger-groups-mini').length===1,null,{timeout:5000});
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#ledger-groups-sidebar').count(),1,'Old observers and timers must not restore duplicate sidebars');
    assert.equal(await page.locator('#ledger-groups-mini').count(),1,'The collapsed guide also stays unique');
    assert.equal(await feedCount(),hadFeed,'Reinjection keeps one feed only when the current route needs it');
    assert.equal(await page.locator('#ledger-group-view-style').count(),hadFeed,'Feed visibility styles are not duplicated');
    await session.detach();
  }
  async function feedCount(){return page.locator('#ledger-group-feed').count();}
  await checkReinjection();
  const entryDocument=await page.evaluate(()=>{
    window.groupEntryProbe={id:crypto.randomUUID(),started:false,frames:0,blank:0,masthead:document.querySelector('ytd-masthead')};
    function sample(){const probe=groupEntryProbe,host=document.getElementById('ledger-group-feed');if(probe.started){probe.frames++;if(!host?.shadowRoot.querySelector('.content')||!host.getBoundingClientRect().height||!probe.masthead.isConnected)probe.blank++;}requestAnimationFrame(sample);}requestAnimationFrame(sample);
    return groupEntryProbe.id;
  });
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Podcasts',exact:true}).click();
  const feed=page.locator('#ledger-group-feed');await feed.getByText('Fetching recent uploads from these channels.',{exact:true}).waitFor();
  const coldLoad=await page.evaluate(async()=>{
    const host=document.getElementById('ledger-group-feed');
    document.querySelector('ytd-page-manager').replaceChildren(document.getElementById('native-page'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {connected:host.isConnected,heading:host.shadowRoot.querySelector('h1')?.textContent,status:host.shadowRoot.querySelector('[role=status]')?.textContent};
  });
  assert.deepEqual(coldLoad,{connected:true,heading:'Podcasts',status:'Refreshing channel uploads…'},'The empty-cache interface must stay visible while fetching');
  await page.waitForURL('**/feed/subscriptions#ledger-group=podcasts');
  const entryResult=await page.evaluate(()=>{const result={id:groupEntryProbe.id,blank:groupEntryProbe.blank,frames:groupEntryProbe.frames};groupEntryProbe.started=false;return result;});
  assert.equal(entryResult.id,entryDocument,'First entry keeps the existing document');assert.equal(entryResult.blank,0,'Cold first entry has no blank UI frames');assert.ok(entryResult.frames>0);
  await worker.evaluate(()=>releaseFeed());await feed.locator('article').nth(29).waitFor();
  await feed.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  // A sidebar action exports its own group, not the full library.
  const groupOptions=page.locator('#ledger-groups-sidebar').getByRole('button',{name:'Options for Podcasts',exact:true});
  await groupOptions.click();await page.getByRole('menu',{name:'Options for Podcasts'}).getByRole('menuitem',{name:'Share group',exact:true}).click();
  const sharing=page.getByRole('dialog',{name:'Share group',exact:true});
  await sharing.getByRole('button',{name:'Download group file',exact:true}).waitFor();
  assert.equal(await sharing.locator('.share-item').count(),1);
  assert.equal(await sharing.getByRole('checkbox').count(),1,'Only the optional icon needs a checkbox');
  const groupDownload=page.waitForEvent('download');await sharing.getByRole('button',{name:'Download group file',exact:true}).click();
  const sharedPath=path.join(profile,'shared-group.json');await(await groupDownload).saveAs(sharedPath);
  const shared=JSON.parse(fs.readFileSync(sharedPath,'utf8'));assert.deepEqual(shared.groups.map(g=>g.name),['Podcasts']);assert.deepEqual(shared.groups[0].channelIds,[A,B,C]);
  await sharing.screenshot({path:'/tmp/ledger-single-group-share.png'});
  await page.keyboard.press('Escape');await sharing.waitFor({state:'detached'});
  assert.equal(await groupOptions.evaluate(el=>el.getRootNode().activeElement===el),true,'Closing returns focus to the sidebar options button');
  assert.equal(await page.locator('#native-page').isVisible(),false);
  assert.equal(await feed.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 11, 28)','YouTube div resets cannot erase the feed theme');
  assert.equal(await feed.evaluate(el=>getComputedStyle(el).paddingLeft),'32px','YouTube resets cannot erase feed spacing');
  assert.equal(await page.locator('#ledger-groups-sidebar').evaluate(el=>el.nextElementSibling.id),'native-subscriptions');
  const dates=await feed.locator('article').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.publishedAt)));assert.ok(dates.every((d,i)=>!i||dates[i-1]>=d));
  assert.equal(await feed.locator('article').first().getAttribute('data-video-id'),V);
  await feed.getByRole('status').filter({hasText:'1 channel could not refresh'}).waitFor();
  // YouTube can reconcile its page area after Ledger has already rendered.
  // The same feed must return before a painted blank frame, without a new load.
  const recovered=await page.evaluate(async()=>{
    const host=document.getElementById('ledger-group-feed'),image=host.shadowRoot.querySelector('article img');
    const grid=host.shadowRoot.querySelector('.grid');window.feedLoadingReferences={host,image,grid,detachedImages:0};
    new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===image||node.contains?.(image))feedLoadingReferences.detachedImages++;}).observe(host.shadowRoot,{childList:true,subtree:true});
    const manager=document.querySelector('ytd-page-manager');manager.replaceChildren(document.getElementById('native-page'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {connected:host.isConnected,sameImage:host.shadowRoot.querySelector('article img')===image};
  });
  assert.equal(recovered.connected,true,'YouTube reconciliation must not leave a blank frame');
  assert.equal(recovered.sameImage,true,'Reattaching a feed must keep its decoded thumbnails');
  assert.equal(await worker.evaluate(()=>groupRefreshCalls),1,'YouTube reconciliation must not restart the group fetch');
  await feed.getByRole('button',{name:'Refresh',exact:true}).click();
  await feed.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.getElementById('ledger-group-feed').shadowRoot.querySelector('article img')===feedLoadingReferences.image),true,'Refreshing cached uploads must not recreate images');
  assert.deepEqual(await page.evaluate(()=>({sameGrid:document.getElementById('ledger-group-feed').shadowRoot.querySelector('.grid')===feedLoadingReferences.grid,detachedImages:feedLoadingReferences.detachedImages})),{sameGrid:true,detachedImages:0},'A refresh must keep the loaded thumbnail grid attached, not just reuse its image objects');
  // A refreshed title/date must update its existing card, including accessible labels.
  await worker.evaluate(V=>chrome.storage.local.get('channelUploads:v1').then(local=>{const entry=Object.values(local['channelUploads:v1'].channels).flatMap(c=>c.entries||[]).find(e=>e.videoId===V);entry.title='Updated episode title';return chrome.storage.local.set(local);}),V);
  await feed.getByRole('link',{name:'Updated episode title',exact:true}).waitFor();await feed.getByRole('button',{name:'More options for Updated episode title',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>({sameImage:document.getElementById('ledger-group-feed').shadowRoot.querySelector('article img')===feedLoadingReferences.image,detachedImages:feedLoadingReferences.detachedImages})),{sameImage:true,detachedImages:0},'Metadata updates keep the decoded image attached');
  await worker.evaluate(V=>chrome.storage.local.get('channelUploads:v1').then(local=>{const entry=Object.values(local['channelUploads:v1'].channels).flatMap(c=>c.entries||[]).find(e=>e.videoId===V);entry.title='Newest episode';return chrome.storage.local.set(local);}),V);
  await feed.getByRole('link',{name:'Newest episode',exact:true}).waitFor();
  // Editing appearance is local, persists across tabs, and leaves the loaded feed intact.
  const sidebar=page.locator('#ledger-groups-sidebar'),podcasts=sidebar.locator('.nav-item[data-group-id="podcasts"]');
  assert.equal(await podcasts.locator('.group-icon').getAttribute('data-icon'),'folder');
  const refreshCount=await worker.evaluate(()=>groupRefreshCalls);
  await podcasts.hover();await groupOptions.click();await page.getByRole('menuitem',{name:'Edit icon',exact:true}).click();
  const iconDialog=page.getByRole('dialog',{name:'Group icon'});
  await iconDialog.getByRole('button',{name:'Headphones',exact:true}).click();
  for(const theme of ['classic','dark-green','frutiger-aero','retrowave']){
    await worker.evaluate(theme=>chrome.storage.local.set({settings:{theme}}),theme);
    await page.waitForFunction(theme=>document.getElementById('ledger-group-icon-dialog').dataset.ledgerTheme===theme,theme);
    assert.equal(await iconDialog.getByRole('button',{name:'Headphones',exact:true}).getAttribute('aria-pressed'),'true');
  }
  await iconDialog.screenshot({path:path.join(__dirname,'group-icons-picker-preview.png')});
  await iconDialog.getByRole('button',{name:'Save icon',exact:true}).click();await iconDialog.waitFor({state:'detached'});
  await podcasts.locator('.group-icon[data-icon="headphones"]').waitFor();await feed.locator('h1 .group-icon[data-icon="headphones"]').waitFor();
  await groupOptions.click();await page.getByRole('menuitem',{name:'Edit icon',exact:true}).click();
  await iconDialog.getByRole('button',{name:'Gaming',exact:true}).click();await iconDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await podcasts.locator('.group-icon').getAttribute('data-icon'),'headphones','Cancel preserves the saved icon');
  await groupOptions.click();await page.getByRole('menuitem',{name:'Edit icon',exact:true}).click();
  await iconDialog.getByRole('textbox',{name:'Custom emoji'}).fill('not an emoji');await iconDialog.getByRole('button',{name:'Save icon',exact:true}).click();
  await iconDialog.getByRole('status').filter({hasText:'single emoji'}).waitFor();
  await iconDialog.getByRole('textbox',{name:'Custom emoji'}).fill('🇯🇵');
  await page.setViewportSize({width:390,height:900});
  assert.equal(await iconDialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Icon picker fits mobile');
  await iconDialog.screenshot({path:path.join(__dirname,'group-icons-mobile-preview.png')});
  await iconDialog.getByRole('button',{name:'Save icon',exact:true}).click();await iconDialog.waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1000});await podcasts.locator('.group-icon[data-icon="🇯🇵"]').waitFor();
  const iconDashboard=await context.newPage();await iconDashboard.goto('chrome-extension://'+new URL(worker.url()).host+'/dashboard.html#groups');
  const iconManager=iconDashboard.locator('#channel-groups-manager');await iconManager.getByRole('button',{name:'Change group icon'}).click();
  await iconDashboard.getByRole('dialog').getByRole('button',{name:'Relaxation',exact:true}).press('Space');
  await iconDashboard.getByRole('dialog').getByRole('button',{name:'Save icon'}).click();
  await podcasts.locator('.group-icon[data-icon="moon"]').waitFor();
  await iconDashboard.reload();await iconManager.locator('.change-icon .group-icon[data-icon="moon"]').waitFor();await iconDashboard.close();await page.bringToFront();
  await groupOptions.click();await page.getByRole('menuitem',{name:'Edit icon',exact:true}).click();await page.keyboard.press('Escape');await iconDialog.waitFor({state:'detached'});
  assert.equal(await groupOptions.evaluate(el=>el.getRootNode().activeElement===el),true,'Closing returns focus to the current sidebar control');
  assert.equal(await worker.evaluate(()=>groupRefreshCalls),refreshCount,'Icon edits must not restart feed refreshes');
  assert.equal(await page.evaluate(()=>document.getElementById('ledger-group-feed')===feedLoadingReferences.host&&document.getElementById('ledger-group-feed').shadowRoot.querySelector('article img')===feedLoadingReferences.image),true,'Icon edits preserve the feed and decoded images');
  await page.evaluate(()=>{
    window.nativeGroupNavigations=0;
    window.addEventListener('click',event=>{if(event.composedPath().some(n=>n?.tagName==='A'&&n.href.includes('#ledger-group=')))nativeGroupNavigations++;});
    for(const type of ['hashchange','popstate'])window.addEventListener(type,()=>nativeGroupNavigations++);
  });
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Music',exact:true}).click();
  await feed.locator('article').nth(14).waitFor();assert.equal(await feed.locator('article').count(),15);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Podcasts',exact:true}).click();await feed.locator('article').nth(29).waitFor();
  await page.goBack();await feed.getByRole('heading',{name:'Music',exact:true}).waitFor();
  await page.goForward();await feed.getByRole('heading',{name:'Podcasts',exact:true}).waitFor();await feed.locator('article').nth(29).waitFor();
  assert.deepEqual(await page.evaluate(()=>({sameHost:document.getElementById('ledger-group-feed')===feedLoadingReferences.host,nativeNavigations:nativeGroupNavigations})),{sameHost:true,nativeNavigations:0},'Group clicks and Back/Forward preserve the document without triggering YouTube routing');
  await feed.locator('summary').click();await feed.locator('.members').getByRole('link',{name:'Alpha',exact:true}).click();
  await page.waitForURL('**/channel/'+A);assert.equal(await page.locator('#ledger-group-feed').count(),0);assert.equal(await page.locator('#native-page').isVisible(),true);
  await page.goBack();await feed.locator('article').nth(29).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>scrollTo(0,200));
  await feed.locator('.video-title').first().click();await page.waitForURL('**/watch?v='+V+'#ledger-queue=*');await page.bringToFront();
  async function waitSource(kind,after=0){const end=Date.now()+15000;while(Date.now()<end){const result=await worker.evaluate(({V,kind,after})=>chrome.storage.local.get(null).then(data=>Object.entries(data).filter(([k])=>k.startsWith('day:')).flatMap(([,rows])=>rows).some(r=>r.videoId===V&&r.source?.kind===kind&&r.seconds.foreground>0&&r.start>=after)),{V,kind,after});if(result)return;await page.waitForTimeout(250);}throw new Error('No playback saved for '+kind);}
  await waitSource('group');
  const savedTop=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('ledger:group-feed-positions')).podcasts.top);
  await page.goBack();await feed.locator('article').nth(29).waitFor();
  await page.waitForFunction(top=>Math.abs(scrollY-top)<3,savedTop).catch(async error=>{console.log('Scroll restore diagnostic',JSON.stringify(await page.evaluate(top=>({top,y:scrollY,height:innerHeight,documentHeight:document.documentElement.scrollHeight,feedHeight:document.getElementById('ledger-group-feed')?.getBoundingClientRect().height,positions:sessionStorage.getItem('ledger:group-feed-positions')}),savedTop)));throw error;});assert.ok(savedTop>100,'Back restores a scrolled feed');
  const openedAt=Date.now();const [popup]=await Promise.all([context.waitForEvent('page'),feed.locator('.video-title').first().click({button:'middle'})]);
  await popup.waitForURL('**/watch?v='+V+'#ledger-queue=*');await popup.waitForLoadState('domcontentloaded');await popup.reload();await popup.locator('video').waitFor();await popup.bringToFront();try{await waitSource('group',openedAt);}catch(error){console.log(JSON.stringify({openedAt,tab:await popup.evaluate(()=>({url:location.href,focused:document.hasFocus(),visibility:document.visibilityState,source:sessionStorage.getItem('ledger:watch-source'),video:{paused:document.querySelector('video')?.paused,time:document.querySelector('video')?.currentTime}})),rows:await worker.evaluate(()=>chrome.storage.local.get(null).then(data=>Object.entries(data).filter(([k])=>k.startsWith('day:')).flatMap(([,rows])=>rows)))}));throw error;}await popup.close();await page.bringToFront();
  // A creator belonging to Podcasts must still count as recommendations when opened from Home.
  await page.goto('https://www.youtube.com/');await page.getByRole('button',{name:'Show recommendations',exact:true}).click();await page.getByRole('link',{name:'Recommended episode',exact:true}).click();await page.bringToFront();await waitSource('recommendations');
  const dashboard=await context.newPage();await dashboard.goto('chrome-extension://'+new URL(worker.url()).host+'/dashboard.html#review');
  await dashboard.waitForFunction(()=>typeof groupedRows!=='undefined'&&groupedRows.some(r=>r.sources?.some(s=>s.source.kind==='group')&&r.sources?.some(s=>s.source.kind==='recommendations')));
  const exported=await dashboard.evaluate(()=>report());assert.equal(exported.schemaVersion,6);assert.ok(exported.measurementNotes.some(note=>note.includes('Unknown does not mean recommendations')));await dashboard.close();
  await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');await feed.locator('article').nth(29).waitFor();
  for(const theme of ['classic','dark-green','retrowave','frutiger-aero']){await worker.evaluate(theme=>chrome.storage.local.set({settings:{theme}}),theme);await page.waitForFunction(theme=>document.getElementById('ledger-group-feed').dataset.ledgerTheme===theme,theme);}
  await worker.evaluate(()=>chrome.storage.local.set({settings:{theme:'retrowave'}}));
  await page.screenshot({path:path.join(__dirname,'groups-feed-preview.png')});
  await page.setViewportSize({width:390,height:900});await page.locator('#ledger-groups-mini').getByRole('link',{name:'Groups',exact:true}).click();await feed.getByRole('combobox',{name:'Select a group'}).selectOption('music');await feed.locator('article').nth(14).waitFor();assert.equal(await feed.locator('article').count(),15);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await feed.getByRole('combobox',{name:'Select a group'}).selectOption('empty');await feed.getByText(/This group has no channels yet/).waitFor();
  await worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1').then(data=>{data['channelGroups:v1'].groups.find(g=>g.id==='empty').name='New name';return chrome.storage.local.set(data);}));await feed.getByRole('option',{name:'New name',exact:true}).waitFor({state:'attached'});
  await page.setViewportSize({width:1440,height:1000});
  await sidebar.getByRole('link',{name:'Podcasts',exact:true}).click();await feed.locator('article').nth(29).waitFor();
  await checkReinjection();await feed.locator('article').nth(29).waitFor();
  // A native guide rebuild should reattach the single owned section before paint.
  const guideRecovery=await page.evaluate(async()=>{
    const nav=document.getElementById('ledger-groups-sidebar'),mini=document.getElementById('ledger-groups-mini');
    const guide=nav.parentElement,small=mini.parentElement;
    guide.replaceChildren(...[...guide.children].filter(n=>n!==nav));small.replaceChildren(...[...small.children].filter(n=>n!==mini));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {nav:nav.isConnected,mini:mini.isConnected,sections:document.querySelectorAll('#ledger-groups-sidebar').length};
  });
  assert.deepEqual(guideRecovery,{nav:true,mini:true,sections:1});
  // Use native text colors over a patterned background, independent of Ledger's palette.
  await page.addStyleTag({content:'body{--yt-spec-text-primary:#fff;--yt-spec-text-secondary:#ddd;background:repeating-linear-gradient(0deg,transparent 0 38px,#bd50ed55 39px 40px),radial-gradient(ellipse at 5% 40%,#802557,#18082b 60%)}'});
  for(const theme of ['classic','dark-green','retrowave','frutiger-aero']){
    await worker.evaluate(theme=>chrome.storage.local.set({settings:{theme}}),theme);
    await page.waitForFunction(theme=>document.getElementById('ledger-groups-sidebar').dataset.ledgerTheme===theme,theme);
    const colors=await sidebar.evaluate(host=>({host:getComputedStyle(host).backgroundColor,section:getComputedStyle(host.shadowRoot.querySelector('section')).backgroundColor,ink:getComputedStyle(host).color}));
    assert.deepEqual(colors,{host:'rgba(0, 0, 0, 0)',section:'rgba(0, 0, 0, 0)',ink:'rgb(255, 255, 255)'},'Transparent sidebar uses YouTube text colors in '+theme);
  }
  await worker.evaluate(()=>chrome.storage.local.set({settings:{theme:'retrowave'}}));await sidebar.getByRole('link',{name:'Music',exact:true}).hover();
  await page.locator('ytd-guide-renderer').screenshot({path:path.join(__dirname,'groups-sidebar-transparent-preview.png')});
  await page.evaluate(()=>{document.body.style.setProperty('--yt-spec-text-primary','#0f0f0f');document.body.style.setProperty('--yt-spec-text-secondary','#606060');document.body.style.background='repeating-linear-gradient(0deg,#f8f7f1 0 38px,#e4e3da 39px 40px)';});
  assert.equal(await sidebar.evaluate(host=>getComputedStyle(host).color),'rgb(15, 15, 15)','Native light sidebar keeps dark text');
  await page.locator('ytd-guide-renderer').screenshot({path:path.join(__dirname,'groups-sidebar-light-preview.png')});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.locator('#ledger-groups-mini .compact').evaluate(link=>getComputedStyle(link).backgroundColor),'rgba(0, 0, 0, 0)','Collapsed Groups entry is also transparent');
  await page.locator('#ledger-groups-mini').getByRole('link',{name:'Groups',exact:true}).click();await feed.getByRole('combobox',{name:'Select a group'}).selectOption('music');await feed.locator('article').nth(14).waitFor();
  // First entry from other surfaces also uses native navigation, including a late guide.
  for(const source of ['/channel/'+A,'/results?search_query=podcasts','/watch?v='+V]){
    const entry=await context.newPage();await entry.goto('https://www.youtube.com'+source);await entry.locator('#ledger-groups-sidebar').waitFor();
    if(source.startsWith('/watch'))await entry.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
    const original=await entry.evaluate(()=>{
      window.entryId=crypto.randomUUID();window.entryVideo=document.querySelector('video');
      const native=document.getElementById('fixture-subscriptions'),parent=native.parentElement;native.remove();window.returnSubscriptions=()=>parent.append(native);
      document.getElementById('ledger-groups-sidebar').shadowRoot.querySelector('a').click();return {id:entryId,visible:!!document.getElementById('ledger-group-feed')?.shadowRoot.querySelector('.content'),paused:entryVideo?.paused};
    });
    assert.equal(original.visible,true,'The feed appears immediately while native navigation is unavailable');if(source.startsWith('/watch'))assert.equal(original.paused,true,'Leaving a video stops playback even while the guide is loading');
    // A second choice during the first navigation must win, without a second native transition.
    await entry.locator('#ledger-groups-sidebar').getByRole('link',{name:'Music',exact:true}).click();await entry.evaluate(()=>returnSubscriptions());
    await entry.waitForURL('**/feed/subscriptions#ledger-group=music');await entry.locator('#ledger-group-feed article').nth(14).waitFor();
    assert.equal(await entry.evaluate(()=>window.entryId),original.id,'First entry from '+source+' keeps the document');await entry.close();
  }
  const cancelled=await context.newPage();await cancelled.goto('https://www.youtube.com/');await cancelled.locator('#ledger-groups-sidebar').waitFor();
  await cancelled.evaluate(()=>{
    const native=document.getElementById('fixture-subscriptions'),parent=native.parentElement;native.remove();
    document.getElementById('ledger-groups-sidebar').shadowRoot.querySelector('a').click();
    history.pushState({},'', '/results?search_query=changed');document.dispatchEvent(new Event('yt-navigate-start'));document.dispatchEvent(new Event('yt-navigate-finish'));parent.append(native);
  });
  await cancelled.waitForTimeout(150);assert.equal(new URL(cancelled.url()).pathname,'/results');assert.equal(await cancelled.locator('#ledger-group-feed').count(),0,'A cancelled entry must not hijack subsequent navigation');await cancelled.close();
  const result=await worker.evaluate(()=>({requests:feedRequests}));assert.ok(result.requests.every(r=>r.credentials==='omit'));assert.deepEqual(errors,[]);
  console.log('PASS: first group entry from Home/channel/search/watch preserves the document, tolerates a late guide, pauses playback, and respects changed/cancelled selections; cold and cached feeds survive reconciliation without blank frames or repeat fetches; group switching/history, attribution, icons, sidebar, themes and responsive feed. Controlled YouTube fixtures.');
 }finally{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
