// Saved channel-list state and stable media in a disposable Chrome profile.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-channel-overview-'));let context;const errors=[];
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1728,height:1100},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const ids=await worker.evaluate(async()=>{
   const now=Date.now(),names=['いろいろな日本語','Yuri Shizu','Scripting Japan','Real Japanese with Puni','Jouzu Juls（上手 ジューズ）','あかね的日本語教室','Vtuber Universe','Learn Japanese with Tanaka san','Nihongo Life: be fluent in Japanese','Learn Japanese with Noriko','Natural Japanese (NIJ)','日本語の森','Japanese with Yuka','Japanese with Naoko','Game Gengo ゲーム言語','NihongoDekita with Sayaka','SociallyIneptWeeb','鳴杜水月 Mizuki Meido / Japanese Teacher 英語教師 Vtuber'];
   const ids=Array.from({length:60},(_,i)=>'UC'+String(i).padStart(22,'0'));
   const channels=Object.fromEntries(ids.map((id,i)=>[id,{id,name:names[i]||'Channel '+(i+1),url:'https://www.youtube.com/channel/'+id,avatarUrl:'https://yt3.ggpht.com/ledger-test-'+i,avatarCheckedAt:now}]));
   const uploads=Object.fromEntries(ids.map((id,i)=>[id,{fetchedAt:now,attemptedAt:now,entries:[{videoId:String(i).padStart(11,'0'),channelId:id,channel:channels[id].name,title:'Recent video '+(i+1),publishedAt:now-i*3600000,details:{duration:180,status:'available',shorts:false,checkedAt:now}}]}]));
   await chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'learning',name:'Learn JP',channelIds:ids,createdAt:now,updatedAt:now},{id:'music',name:'Music',channelIds:[ids[0]],createdAt:now,updatedAt:now}],channels},'channelUploads:v1':{version:1,channels:uploads}});
   return ids;
  });
  const picture='<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#725782"/><circle cx="44" cy="34" r="17" fill="#eed7ed"/><ellipse cx="44" cy="85" rx="34" ry="27" fill="#eed7ed"/></svg>';
  for(const origin of ['https://yt3.ggpht.com/**','https://i.ytimg.com/**'])await context.route(origin,route=>route.fulfill({contentType:'image/svg+xml',body:picture}));
  await context.route('https://www.youtube.com/**',route=>{
   if(route.request().resourceType()!=='document')return route.fulfill({status:204,body:''});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>body{margin:0;background:#110b1c;color:white;font:14px Arial}ytd-masthead{display:block;padding:12px;height:56px}ytd-guide-renderer{display:block;width:220px;float:left}ytd-guide-section-renderer{display:block}ytd-page-manager{display:block;margin-left:220px}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-page-manager{margin-left:0}}</style></head><body><ytd-masthead>YouTube</ytd-masthead><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions">Native page</ytd-browse></ytd-page-manager></body></html>`});
  });
  const page=await context.newPage(),url='https://www.youtube.com/feed/subscriptions#ledger-group=learning';await page.goto(url);
  const feed=page.locator('#ledger-group-feed'),details=feed.locator('.group-members'),members=feed.locator('.members'),sidebar=page.locator('#ledger-groups-sidebar');
  await members.locator('li').last().waitFor({state:'attached'});assert.equal(await members.locator('li').count(),60);assert.equal(await members.isVisible(),false);
  await details.locator('summary').click();await members.waitFor();
  const preference=()=>worker.evaluate(async()=>((await chrome.storage.local.get('groupBrowsing:v1'))['groupBrowsing:v1'].groups.learning.channelsExpanded));
  for(let i=0;i<100&&await preference()!==true;i++)await page.waitForTimeout(20);assert.equal(await preference(),true);
  await members.locator('img').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelector('#ledger-group-feed').shadowRoot.querySelectorAll('.members img')].every(img=>img.complete&&img.naturalWidth));
  await feed.evaluate(host=>{const root=host.shadowRoot;window.memberProbe={details:root.querySelector('.group-members'),image:root.querySelector('.members img'),grid:root.querySelector('.grid'),detached:0};new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===memberProbe.image||node.contains?.(memberProbe.image))memberProbe.detached++;}).observe(root,{subtree:true,childList:true});});
  await feed.getByRole('searchbox',{name:'Search this group'}).fill('Recent video 1');
  assert.deepEqual(await feed.evaluate(host=>({sameDetails:host.shadowRoot.querySelector('.group-members')===memberProbe.details,sameImage:host.shadowRoot.querySelector('.members img')===memberProbe.image,sameGrid:host.shadowRoot.querySelector('.grid')===memberProbe.grid,detached:memberProbe.detached})),{sameDetails:true,sameImage:true,sameGrid:true,detached:0});
  await sidebar.getByRole('link',{name:'Music',exact:true}).click();await feed.getByRole('heading',{name:'Music',exact:true}).waitFor();await members.locator('li').waitFor({state:'attached'});assert.equal(await members.isVisible(),false);
  await sidebar.getByRole('link',{name:'Learn JP',exact:true}).click();await members.waitFor();assert.equal(await members.locator('li').count(),60);
  await page.reload();await members.waitFor();assert.equal(await members.locator('li').count(),60);
  const other=await context.newPage();await other.goto(url);await other.locator('#ledger-group-feed .members').waitFor();
  await details.locator('summary').click();await other.locator('#ledger-group-feed .members').waitFor({state:'hidden'});assert.equal(await preference(),false);
  await page.reload();await feed.locator('.group-members').waitFor();assert.equal(await members.isVisible(),false);
  // A failed write restores the saved setting and tells the user.
  await worker.evaluate(()=>{const original=FeedLibrary.handle;FeedLibrary.handle=(message,sender)=>{if(message.type==='feedLibrary:channels'){FeedLibrary.handle=original;return Promise.reject(Error('Test storage failure'));}return original(message,sender);};});
  await details.locator('summary').click();await feed.getByRole('status').filter({hasText:'Could not save the channel list preference.'}).waitFor();assert.equal(await members.isVisible(),false);assert.equal(await preference(),false);
  // Rapid toggles share the writer, retaining the most recent choice.
  for(let i=0;i<5;i++)await details.locator('summary').click();await members.waitFor();
  for(let i=0;i<100&&await preference()!==true;i++)await page.waitForTimeout(20);assert.equal(await preference(),true);await other.close();
  await details.locator('summary').press('Space');await members.waitFor({state:'hidden'});
  await details.locator('summary').press('Enter');await members.waitFor();
  for(const theme of ['retrowave','classic','dark-green','frutiger-aero']){
   await worker.evaluate(theme=>chrome.storage.local.set({settings:{theme}}),theme);await page.waitForFunction(theme=>document.querySelector('#ledger-group-feed').dataset.ledgerTheme===theme,theme);
   for(const width of [1728,736,360]){
    await page.setViewportSize({width,height:1100});assert.equal(await members.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'Member grid fits '+theme+' '+width);
    assert.equal(await members.evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
    if(theme==='retrowave'&&width===1728){await page.evaluate(()=>scrollTo(0,0));await details.screenshot({path:'/tmp/ledger-channel-overview-implemented.png'});}
   }
  }
  await page.setViewportSize({width:1728,height:1100});
  const first=members.locator('a').first();assert.equal(await first.getAttribute('title'),await first.evaluate(link=>link.lastElementChild.textContent));assert.equal(await first.getAttribute('href'),'https://www.youtube.com/channel/'+ids[0]);
  await first.click();await page.waitForURL('**/channel/'+ids[0]);await page.goBack();await page.locator('#ledger-group-feed .members').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: per-group expansion, reload, cross-tab updates, failed writes, rapid toggles, stable images, channel links and 60-channel layout across four themes and three widths.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
