// Actual unpacked extension: local uploads, animation, storage, and live YouTube image rendering.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {animatedGif,largeAnimatedGif}=require('./icon-fixtures.cjs');
const A='UCvryaJCRHcTVjOC_DcuYxGg',gif=animatedGif(),gifURL='data:image/gif;base64,'+gif.toString('base64');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-group-images-')),extension=path.join(__dirname,'dist/chrome');let context;
 const errors=[];
 async function launch(){
  const c=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  c.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));return c;
 }
 try{
  context=await launch();const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(async A=>{
   const now=Date.now();await chrome.storage.local.set({settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[A]}],channels:{[A]:{id:A,name:'Sample channel'}}},'channelUploads:v1':{version:1,channels:{[A]:{attemptedAt:now,fetchedAt:now,entries:[{videoId:'aaaaaaaaaaa',channelId:A,title:'Saved episode',publishedAt:now}]}}}});
   const handle=GroupFeeds.handle;globalThis.refreshes=0;GroupFeeds.handle=(message,sender)=>{if(message.type==='groupFeed:refresh')refreshes++;return handle(message,sender);};
  },A);
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"img-src 'self' data: https://i.ytimg.com"},body:'<!doctype html><html><head><style>body{margin:0;background:#160e23;color:white}ytd-guide-renderer{display:block;width:240px;position:fixed;top:56px}ytd-page-manager{display:block;margin-left:240px}ytd-masthead{display:block;height:56px}ytd-mini-guide-renderer{display:none}</style></head><body><ytd-masthead><div id="center"><yt-searchbox><input name="search_query"></yt-searchbox></div></ytd-masthead><ytd-guide-renderer><div id="sections"></div></ytd-guide-renderer><ytd-mini-guide-renderer><div id="items"></div></ytd-mini-guide-renderer><ytd-page-manager><ytd-browse>Native content</ytd-browse></ytd-page-manager></body></html>'}));
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/gif',body:gif}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts');
  const sidebar=page.locator('#ledger-groups-sidebar'),feed=page.locator('#ledger-group-feed');await feed.locator('article').waitFor();await feed.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  const refreshes=await worker.evaluate(()=>refreshes);await feed.locator('article img').evaluate(image=>window.savedFeedImage=image);
  const dialog=page.getByRole('dialog',{name:'Group icon'}),open=async()=>{await sidebar.getByRole('button',{name:'Options for Podcasts'}).click();await page.getByRole('menuitem',{name:'Edit icon',exact:true}).click();};
  const save=async()=>{await dialog.getByRole('button',{name:'Save icon',exact:true}).click();await dialog.waitFor({state:'detached'});};
  const stored=()=>worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1').then(s=>s['channelGroups:v1'].groups[0].icon));
  const rasters=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#f8a3e2';c.fillRect(0,0,320,320);c.fillStyle='#44caff';c.fillRect(320,0,320,320);
   return ['png','jpeg','webp'].map(type=>({type,url:canvas.toDataURL('image/'+type)}));
  });
  for(const {type,url} of rasters){
   await open();const [chooser]=await Promise.all([page.waitForEvent('filechooser'),dialog.getByRole('button',{name:'Upload image or GIF'}).click()]);
   await chooser.setFiles({name:'wide-image.'+type,mimeType:'image/'+type,buffer:Buffer.from(url.split(',')[1],'base64')});
   await dialog.getByRole('status').filter({hasText:'Image ready'}).waitFor();
   assert.deepEqual(await dialog.locator('.icon-preview img').evaluate(image=>({w:image.naturalWidth,h:image.naturalHeight})),{w:128,h:64});
   await save();await sidebar.locator('.group-icon img').waitFor();assert.equal((await stored()).kind,'image');
   assert.equal(await sidebar.locator('.group-icon img').evaluate(image=>image.complete&&image.naturalWidth===128),true);
  }
  await open();await dialog.locator('input[type=file]').setInputFiles({name:'animated.gif',mimeType:'image/gif',buffer:gif});await dialog.getByRole('status').filter({hasText:'Image ready'}).waitFor();
  const frames=new Set();for(const wait of [37,83,127,149,71]){await page.waitForTimeout(wait);frames.add((await dialog.locator('.icon-preview img').screenshot()).toString('base64'));}assert.ok(frames.size>1,'GIF visibly animates in the picker');
  await page.setViewportSize({width:390,height:850});assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await dialog.screenshot({path:path.join(__dirname,'group-image-upload-mobile-preview.png')});
  await save();assert.equal((await stored()).value,gifURL,'GIF bytes are preserved without flattening');
  await page.setViewportSize({width:1280,height:900});await sidebar.locator('.group-icon img').evaluate(image=>window.savedGroupImage=image);
  await page.waitForTimeout(1200);assert.equal(await sidebar.locator('.group-icon img').evaluate(image=>image===window.savedGroupImage),true,'The mount timer does not restart animated images');
  const sidebarFrames=new Set();for(const wait of [37,83,127,149,71]){await page.waitForTimeout(wait);sidebarFrames.add((await sidebar.locator('.group-icon img').screenshot()).toString('base64'));}assert.ok(sidebarFrames.size>1,'GIF also animates in the sidebar');
  await open();await dialog.getByRole('button',{name:'Remove image'}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await stored()).value,gifURL,'Cancel keeps the saved upload');
  await open();
  const large=largeAnimatedGif();assert.ok(large.length>512*1024);
  await dialog.locator('input[type=file]').setInputFiles({name:'large-animation.gif',mimeType:'image/gif',buffer:large});await dialog.getByRole('status').filter({hasText:'Image ready'}).waitFor();
  const compressed=await dialog.locator('.icon-preview img').getAttribute('src');assert.ok(Buffer.from(compressed.split(',')[1],'base64').length<512*1024);
  await dialog.locator('.icon-preview img').evaluate(image=>image.decode());assert.ok(await dialog.locator('.icon-preview img').evaluate(image=>image.naturalWidth<=128));
  const compressedFrames=new Set();for(const delay of [100,120,140]){await page.waitForTimeout(delay);compressedFrames.add((await dialog.locator('.icon-preview img').screenshot()).toString('base64'));}assert.ok(compressedFrames.size>1,'Resized GIF remains animated');
  for(const file of [{name:'too-large.gif',mimeType:'image/gif',buffer:Buffer.alloc(11*1024*1024)},{name:'fake.png',mimeType:'image/png',buffer:Buffer.from('<svg><script/></svg>')}]){
   await dialog.locator('input[type=file]').setInputFiles(file);await dialog.locator('.status.error').waitFor();assert.equal((await stored()).value,gifURL,'Rejected files preserve the previous image');
  }
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await worker.evaluate(()=>refreshes),refreshes,'Image edits do not refresh uploads');assert.equal(await feed.locator('article img').evaluate(image=>image===window.savedFeedImage),true,'Feed thumbnails remain mounted');
  const dashboard=await context.newPage();await dashboard.goto('chrome-extension://'+id+'/dashboard.html#groups');
  await dashboard.locator('.change-icon img').waitFor();await dashboard.getByRole('button',{name:'Change group icon'}).click();
  await dashboard.getByRole('dialog').getByRole('button',{name:'Remove image'}).click();await dashboard.getByRole('dialog').getByRole('button',{name:'Save icon'}).click();await sidebar.locator('.group-icon[data-icon=folder]').waitFor();
  await dashboard.getByRole('button',{name:'Change group icon'}).click();await dashboard.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'animated.gif',mimeType:'image/gif',buffer:gif});
  await dashboard.getByRole('dialog').getByRole('status').filter({hasText:'Image ready'}).waitFor();await dashboard.getByRole('dialog').getByRole('button',{name:'Save icon'}).click();await dashboard.getByRole('dialog').waitFor({state:'detached'});
  await context.close();context=await launch();const restored=await context.newPage();await restored.goto('chrome-extension://'+id+'/dashboard.html#groups');
  await restored.locator('.change-icon img').waitFor();assert.equal(await restored.locator('.change-icon img').getAttribute('src'),gifURL,'Uploaded image survives a browser restart');
  // Live YouTube, with no intercepted page/asset requests, verifies its real image policy.
  const live=await context.newPage();await live.setViewportSize({width:1440,height:1000});await live.goto('https://www.youtube.com/feed/subscriptions#ledger-group=podcasts',{waitUntil:'domcontentloaded'});
  await live.waitForFunction(()=>{const image=document.getElementById('ledger-groups-sidebar')?.shadowRoot.querySelector('.group-icon img');return image?.complete&&image.naturalWidth===32;});
  assert.deepEqual(errors,[]);console.log('PASS: PNG/JPG/WebP resize, animated GIF picker/sidebar playback, local save/cancel/remove, animated GIF compression and invalid/over-10-MB rejection, mobile layout, cross-tab updates, unchanged feed, restart persistence, and image rendering on live YouTube.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
