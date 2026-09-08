// Header controls and channel exclusion in a disposable Chromium profile.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-group-header-'));let context;const errors=[];
 const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),ids=Array.from({length:6},(_,i)=>String(i).padStart(11,'0'));
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(({A,B,ids})=>{
   const now=Date.now(),channels=Object.fromEntries([[A,'Alpha'],[B,'Beta']].map(([id,name])=>[id,{id,name,url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:now}]));
   const entries=ids.map((videoId,i)=>({videoId,channelId:i<3?A:B,channel:i<3?'Alpha':'Beta',title:'Episode '+i,publishedAt:now-([1,2,48,3,4,100][i])*3600000,details:{duration:[300,900,2400,60,1500,2500][i],status:'available',shorts:i===3,checkedAt:now}}));
   return chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:['podcasts','music'].map(id=>({id,name:id==='podcasts'?'Podcasts':'Music',channelIds:[A,B],createdAt:now,updatedAt:now})),channels},'channelUploads:v1':{version:1,channels:Object.fromEntries([A,B].map(id=>[id,{fetchedAt:now,attemptedAt:now,entries:entries.filter(e=>e.channelId===id)}]))},'videoProgress:v1':{version:1,videos:{}},'groupBrowsing:v1':{version:1,groups:{podcasts:{hidden:[],lastVisitedAt:now-86400000}}}});
  },{A,B,ids});
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#493255"/></svg>'}));
  await context.route('https://www.youtube.com/**',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#171717;color:#fff;font:14px Arial}ytd-guide-renderer{display:block;width:220px;float:left}ytd-page-manager{display:block;margin-left:220px}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-page-manager{margin-left:0}}</style><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'}):route.fulfill({status:204,body:''}));
  const page=await context.newPage(),url='https://www.youtube.com/feed/subscriptions#ledger-group=podcasts';await page.goto(url);
  const feed=page.locator('#ledger-group-feed'),filterButton=()=>feed.getByRole('button',{name:/^Filters/}),menu=()=>feed.getByRole('menu');
  const shown=()=>feed.locator('article').evaluateAll(nodes=>nodes.map(n=>n.dataset.videoId));
  const waitIds=expected=>page.waitForFunction(expected=>{const root=document.querySelector('#ledger-group-feed')?.shadowRoot;return root&&JSON.stringify([...root.querySelectorAll('article')].map(n=>n.dataset.videoId))===JSON.stringify(expected)},expected);
  const initial=[ids[0],ids[1],ids[3],ids[4],ids[2],ids[5]];await waitIds(initial);
  await feed.evaluate(host=>{window.keepCard=host.shadowRoot.querySelector('article[data-video-id="00000000004"]');window.keepImage=keepCard.querySelector('img');});
  await filterButton().click();await feed.getByLabel('Uploaded',{exact:true}).selectOption('day');await waitIds(initial.slice(0,4));
  await feed.getByLabel('Video length',{exact:true}).selectOption('medium');await waitIds([ids[1],ids[4]]);
  assert.equal(await page.evaluate(()=>keepCard.isConnected&&keepImage.isConnected),true,'Remaining media never detaches when filters change');
  await page.reload();await waitIds([ids[1],ids[4]]);await filterButton().click();assert.equal(await feed.getByLabel('Video length',{exact:true}).inputValue(),'medium');
  await feed.getByRole('button',{name:'Remove filter: 10–30 minutes',exact:true}).click();await waitIds(initial.slice(0,4));
  await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).check();await waitIds([ids[0],ids[1],ids[4]]);
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).press('ArrowDown');await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([ids[4]]);
  const stored=await worker.evaluate(()=>chrome.storage.local.get(null));assert.deepEqual(stored['groupBrowsing:v1'].groups.podcasts.hiddenChannels,[A]);assert.deepEqual(stored['channelGroups:v1'].groups[0].channelIds,[A,B]);assert.deepEqual(stored['videoProgress:v1'],{version:1,videos:{}});assert.ok(!Object.keys(stored).some(k=>k.startsWith('day:')));
  await feed.locator('.ledger-undo').getByRole('button',{name:'Undo',exact:true}).click();await waitIds([ids[0],ids[1],ids[4]]);
  // Each excluded channel is visible beside the date chip and can be restored independently.
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([ids[4]]);
  await feed.getByRole('button',{name:'More options for Episode 4',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([]);
  assert.deepEqual(await feed.locator('.hidden-channel-chip').allTextContents(),['Hidden: Alpha','Hidden: Beta']);
  assert.equal(await feed.locator('.filter-count').textContent(),'4');
  await feed.getByRole('button',{name:'Restore channel: Alpha',exact:true}).press('Enter');await waitIds([ids[0],ids[1]]);
  assert.deepEqual(await feed.locator('.hidden-channel-chip').allTextContents(),['Hidden: Beta']);
  assert.equal(await feed.getByRole('button',{name:'Remove filter: Last 24 hours',exact:true}).count(),1);
  await feed.getByRole('button',{name:'Restore channel: Beta',exact:true}).click();await waitIds([ids[0],ids[1],ids[4]]);
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([ids[4]]);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Music',exact:true}).click();await waitIds(initial);
  await page.locator('#ledger-groups-sidebar').getByRole('link',{name:'Podcasts',exact:true}).click();await waitIds([ids[4]]);
  await feed.getByRole('button',{name:'Clear filters',exact:true}).click();await waitIds([ids[3],ids[4],ids[5]]);
  await page.reload();await waitIds([ids[3],ids[4],ids[5]]);
  await feed.getByRole('button',{name:'Restore channel: Alpha',exact:true}).click();await waitIds(initial);
  // Restoring a channel does not implicitly restore an individually hidden video.
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide from this group',exact:true}).click();await waitIds(initial.slice(1));
  await feed.getByRole('button',{name:'More options for Episode 1',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([ids[3],ids[4],ids[5]]);
  await feed.getByRole('button',{name:'Restore channel: Alpha',exact:true}).click();await waitIds(initial.slice(1));
  await filterButton().click();
  await feed.getByRole('checkbox',{name:'Show hidden videos only',exact:true}).check();await waitIds([ids[0]]);assert.equal(await feed.getByRole('button',{name:'Play group',exact:true}).isDisabled(),true);
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).click();await menu().getByRole('menuitem',{name:'Restore to feed',exact:true}).click();await waitIds([]);
  await feed.getByRole('button',{name:'All videos',exact:true}).click();await waitIds(initial);
  // Header menus dismiss cleanly and launch the existing group dialogs.
  await feed.getByRole('button',{name:'Group options',exact:true}).press('ArrowDown');await menu().getByRole('menuitem',{name:'Edit this group',exact:true}).waitFor();await page.keyboard.press('Escape');await menu().waitFor({state:'detached'});
  assert.equal(await feed.getByRole('button',{name:'Group options',exact:true}).evaluate(node=>node.getRootNode().activeElement===node),true);
  await feed.getByRole('button',{name:'Group options',exact:true}).click();await menu().getByRole('menuitem',{name:'Edit this group',exact:true}).click();await page.locator('#ledger-group-manager-dialog').getByRole('button',{name:'Close',exact:true}).click();
  await feed.getByLabel('Uploaded',{exact:true}).selectOption('week');await waitIds(initial);
  await feed.getByRole('button',{name:'More options for Episode 0',exact:true}).click();await menu().getByRole('menuitem',{name:'Hide this channel',exact:true}).click();await waitIds([ids[3],ids[4],ids[5]]);
  const longName='Alpha — Japanese language, culture and entertainment';
  await worker.evaluate(async({A,longName})=>{const key='channelGroups:v1',saved=(await chrome.storage.local.get(key))[key];saved.channels[A].name=longName;await chrome.storage.local.set({[key]:saved});},{A,longName});
  await feed.getByRole('button',{name:'Restore channel: '+longName,exact:true}).waitFor();
  await filterButton().click();
  for(const width of [1440,736,360]){
   await page.setViewportSize({width,height:1050});
   for(const theme of ['retrowave','classic','dark-green','frutiger-aero']){
    await worker.evaluate(theme=>chrome.storage.local.set({settings:{theme}}),theme);await page.waitForFunction(theme=>document.querySelector('#ledger-group-feed')?.dataset.ledgerTheme===theme,theme);
    const bad=await feed.locator('.feed-header').evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(bad,false,'Header fits '+width+' '+theme);
    if(width===1440&&theme==='retrowave')await feed.locator('.feed-header').screenshot({path:'/tmp/ledger-group-header-implemented.png'});
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await feed.getByRole('button',{name:'Restore channel: '+longName,exact:true}).click();await waitIds(initial);
  await filterButton().click();
  await feed.getByRole('searchbox',{name:'Search this group'}).fill('Beta');await waitIds([ids[3],ids[4],ids[5]]);
  await feed.getByRole('checkbox',{name:'Hide Shorts',exact:true}).check();await waitIds([ids[4],ids[5]]);
  await feed.getByRole('button',{name:'Playback options',exact:true}).click();await menu().getByRole('menuitem',{name:'Shuffle matching videos',exact:true}).click();await page.waitForURL(/ledger-queue=/);
  const queues=await worker.evaluate(()=>chrome.storage.session.get('groupQueues:v1')),queue=Object.values(queues['groupQueues:v1'])[0];assert.deepEqual(queue.entries.map(e=>e.videoId).sort(),[ids[4],ids[5]]);assert.equal(queue.auto,false);
  assert.deepEqual(errors,[]);console.log('PASS: header filters, named channel chips with independent keyboard/click restore, saved state, stable media, channel/video hide and restore, Undo, group isolation, keyboard menus, edit dialog, long names in four themes at three widths, and filtered Shuffle.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
