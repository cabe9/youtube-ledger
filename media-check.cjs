// Real unpacked Chromium extension, synthetic media, no personal YouTube account.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),V='a'.repeat(11),W='b'.repeat(11),X='c'.repeat(11),avatar='https://yt3.googleusercontent.com/ledger-portrait=s88-c-k-c0x00ffffff-no-rj';
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-media-'));let context,releasePortrait;const errors=[],requests=[];
 const gate=new Promise(resolve=>releasePortrait=resolve);
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await context.route(/^https:\/\/(?:i.ytimg.com|yt3.googleusercontent.com)\//,route=>{
   requests.push({url:route.request().url(),headers:route.request().headers()});
   if(route.request().url().includes(X))return route.fulfill({status:404,body:''});
   const portrait=route.request().url().includes('yt3.'),color=portrait?'#e6b957':'#376c89';
   return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><circle cx="160" cy="90" r="55" fill="#a8dbcd"/><path d="M145 58 L145 122 L194 90Z" fill="#fff"/></svg>`});
  });
  await context.route('https://www.youtube.com/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/channel/')){await gate;return route.fulfill({contentType:'text/html',body:`<link rel="canonical" href="https://www.youtube.com/channel/${A}"><meta property="og:title" content="The Learning Podcast"><meta property="og:image" content="${avatar}">`});}
   return route.fulfill({contentType:'text/html',body:'<ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'});
  });
  await worker.evaluate(({A,B,V,W,X})=>{
   const now=Date.now(),day=Ledger.dayKey(now),rows=[];
   for(const [videoId,title,channel] of [[V,'How to make time for the things you enjoy','The Learning Podcast'],[W,'A little music for a quiet afternoon','Afternoon Radio'],[X,'An unavailable thumbnail still has a readable title','Other channel']])Ledger.add(rows,{id:videoId,videoId,title,channel,url:'https://www.youtube.com/watch?v='+videoId,start:now-4000,end:now,state:'foreground',source:{kind:'group',groupId:'podcasts',groupName:'Podcasts'}});
   return chrome.storage.local.set({paused:true,settings:Ledger.settings({theme:'dark-green'}),['day:'+day]:rows,'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A],createdAt:now,updatedAt:now}],channels:{[A]:{id:A,name:'The Learning Podcast',url:'https://www.youtube.com/channel/'+A}}},'channelUploads:v1':{version:1,channels:{[A]:{fetchedAt:now,attemptedAt:now,error:'',entries:[{videoId:V,channelId:A,channel:'The Learning Podcast',title:rows[0].title,publishedAt:now-86400000}]}}}});
  },{A,B,V,W,X});
  const page=await context.newPage();page.setDefaultTimeout(20000);await page.goto(`chrome-extension://${id}/dashboard.html#history`);
  await page.waitForFunction(()=>document.querySelector('#rows .ledger-video-thumbnail img')?.naturalWidth>0);
  await page.waitForFunction(()=>[...document.querySelectorAll('#rows .ledger-video-thumbnail img')].some(img=>img.hidden));
  assert.equal(await page.locator('#rows .ledger-video-thumbnail').count(),3);assert.equal(await page.locator('#rows .ledger-avatar img').count(),0);
  const expected=await page.evaluate(async()=>{
   window.savedMedia=[...document.querySelectorAll('#rows img')];window.mediaDetached=false;const observer=new MutationObserver(()=>{if(savedMedia.some(img=>!img.isConnected))window.mediaDetached=true;});observer.observe(document.querySelector('#rows'),{childList:true,subtree:true});
   await render();await render();await new Promise(resolve=>setTimeout(resolve,0));observer.disconnect();return !window.mediaDetached&&savedMedia.every(img=>img.isConnected);
  });assert.equal(expected,true,'History refresh preserves image nodes');
  await page.getByRole('link',{name:'Groups',exact:true}).click();
  const field=page.getByRole('textbox',{name:'Channel address',exact:true});await field.fill('@DraftThatShouldStay');releasePortrait();
  await page.waitForFunction(({A,avatar})=>chrome.storage.local.get('channelGroups:v1').then(data=>data['channelGroups:v1'].channels[A].avatarUrl===avatar),{A,avatar});
  await page.waitForFunction(()=>document.querySelector('#channel-groups-manager')?.shadowRoot?.querySelector('.ledger-avatar img')?.naturalWidth>0).catch(async()=>{await page.locator('.ledger-avatar img').first().waitFor();});
  assert.equal(await field.inputValue(),'@DraftThatShouldStay','Portrait arrival preserves the add-channel draft');
  await page.getByRole('link',{name:'History',exact:true}).click();await page.evaluate(()=>render());
  await page.waitForFunction(()=>document.querySelector('#rows .ledger-avatar img')?.naturalWidth>0);
  assert.equal(await page.locator('#rows .ledger-channel[href="https://www.youtube.com/channel/'+A+'"]').count(),1,'Legacy row joins by exact cached video identity');
  await page.screenshot({path:'/tmp/ledger-media-history.png',fullPage:true});
  await page.getByRole('link',{name:'Review',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#review-rows .ledger-video-thumbnail img')?.naturalWidth>0);
  await page.screenshot({path:'/tmp/ledger-media-review.png',fullPage:true});
  const youtube=await context.newPage();await youtube.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');const feed=youtube.locator('#ledger-group-feed');await feed.locator('article .ledger-avatar img').waitFor();assert.equal(await feed.locator('article .ledger-avatar img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await youtube.evaluate(()=>{const root=document.querySelector('#ledger-group-feed').shadowRoot;window.feedMediaNodes=[root.querySelector('.content header'),root.querySelector('.thumbnail img'),document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelector('section')];});
  const newer=avatar.replace('ledger-portrait','ledger-updated');await worker.evaluate(async({A,newer})=>{const data=await chrome.storage.local.get('channelGroups:v1');data['channelGroups:v1'].channels[A].avatarUrl=newer;await chrome.storage.local.set(data);},{A,newer});
  await youtube.waitForFunction(newer=>document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article .ledger-avatar img')?.src===newer,newer);
  assert.equal(await youtube.evaluate(()=>window.feedMediaNodes.every(node=>node.isConnected)),true,'Portrait refresh preserves guide icons, feed header and thumbnails');
  assert.ok(requests.length>0);assert.ok(requests.every(r=>!r.headers.referer),'Image requests do not include page referrers');assert.deepEqual(errors,[]);
  console.log('Media checks passed: real images, missing-image fallback, stable History refresh, preserved group draft, channel identity links, Review, group portraits and no referrers.');
 }finally{releasePortrait();await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
