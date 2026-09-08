// Recovery and error controls in an isolated Chromium extension profile.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-refresh-'));let context;const errors=[];
 const ids=['a','b','c'].map(c=>'UC'+c.repeat(22));
 try{
  const extension=path.join(__dirname,'dist/chrome');context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(ids=>{
   const now=Date.now(),[a,b,c]=ids;
   globalThis.refreshRequests=[];globalThis.requestTimes=[];globalThis.blockAll=false;
   globalThis.fetch=async url=>{
    const id=new URL(url).searchParams.get('channel_id');if(!id)return new Response('',{status:404});
    refreshRequests.push(id);requestTimes.push(Date.now());const status=blockAll||id===c?404:200;
    const xml=`<feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${id}</yt:channelId><title>Test channel</title></feed>`;
    const result=new Response(xml,{status});Object.defineProperty(result,'url',{value:String(url)});return result;
   };
   return chrome.storage.local.set({paused:true,settings:{theme:'retrowave'},'channelGroups:v1':{version:1,groups:[{id:'test',name:'Refresh test',channelIds:ids}],channels:Object.fromEntries(ids.map((id,i)=>[id,{id,name:['Alpha','Beta','Gamma'][i],avatarCheckedAt:now}]))},'channelUploads:v1':{version:1,channels:Object.fromEntries(ids.map((id,i)=>[id,{fetchedAt:now-3600000,attemptedAt:id===b?now:now-31000,viewsAttemptedAt:now,error:id===b?'':'YouTube’s upload feed is temporarily unavailable (HTTP 503).',...(id===b?{}:{retryAt:now+900000}),entries:[{videoId:String(i).repeat(11),channelId:id,channel:['Alpha','Beta','Gamma'][i],title:'Episode '+i,publishedAt:now-3600000,views:{count:0,checkedAt:now},details:{status:'available',duration:300,shorts:false,checkedAt:now}}]}]))}});
  },ids);
  await context.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#463453"/></svg>'}));
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{background:#111;color:white;font:14px Arial}ytd-page-manager{display:block}</style><ytd-masthead>YouTube</ytd-masthead><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>'}));
  const page=await context.newPage();await page.goto('https://www.youtube.com/feed/subscriptions#ledger-group=test');
  const feed=page.locator('#ledger-group-feed');await feed.getByRole('button',{name:'Retry failed channels',exact:true}).waitFor();
  assert.equal(await feed.locator('article').count(),3);assert.match(await feed.locator('.status').textContent(),/2 channels could not refresh/);
  await feed.getByRole('button',{name:'Show details',exact:true}).click();assert.equal(await feed.locator('.members small').count(),2);assert.match(await feed.locator('.members small').first().textContent(),/HTTP 503/);
  await page.evaluate(()=>{window.retainedImage=document.querySelector('#ledger-group-feed').shadowRoot.querySelector('article img');});
  await feed.getByRole('button',{name:'Retry failed channels',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('[data-focus=retry-failed]'));
  assert.equal((await worker.evaluate(()=>refreshRequests)).length,0,'Manual refresh cannot bypass failure cooldowns');
  await worker.evaluate(async ids=>{const key='channelUploads:v1',cache=(await chrome.storage.local.get(key))[key];for(const id of [ids[0],ids[2]]){cache.channels[id].attemptedAt=Date.now()-16*60000;cache.channels[id].retryAt=Date.now()-1;}await chrome.storage.local.set({[key]:cache});},ids);
  await feed.getByRole('button',{name:'Retry failed channels',exact:true}).click();
  await page.waitForFunction(()=>/1 channel could not refresh/.test(document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('.status')?.textContent));
  const requested=await worker.evaluate(()=>refreshRequests);assert.equal(requested.filter(id=>id===ids[0]).length,1);assert.equal(requested.filter(id=>id===ids[2]).length,1);assert.equal(requested.includes(ids[1]),false);
  assert.equal(await page.evaluate(()=>retainedImage.isConnected),true);
  await worker.evaluate(async ids=>{blockAll=true;const key='channelUploads:v1',cache=(await chrome.storage.local.get(key))[key];for(const id of ids){cache.channels[id].attemptedAt=Date.now()-16*60000;cache.channels[id].retryAt=Date.now()-1;cache.channels[id].error='Previous failure';}await chrome.storage.local.set({[key]:cache});},ids);
  await feed.getByRole('button',{name:'Retry failed channels',exact:true}).click();
  await page.waitForFunction(()=>/YouTube checks are paused until/.test(document.querySelector('#ledger-group-feed')?.shadowRoot.querySelector('.status')?.textContent));
  assert.equal(await page.evaluate(()=>retainedImage.isConnected),true);assert.equal(await feed.locator('article').count(),3);
  assert.equal(await feed.getByRole('button',{name:'Refresh uploads',exact:true}).isDisabled(),true);
  const times=await worker.evaluate(()=>requestTimes);assert.ok(times.slice(1).every((at,i)=>at-times[i]>=1950));
  const total=times.length;await page.reload();await feed.locator('article').first().waitFor();
  assert.equal(await feed.locator('article').count(),3);assert.match(await feed.locator('.status').textContent(),/YouTube checks are paused until/);
  assert.equal((await worker.evaluate(()=>refreshRequests)).length,total);
  await feed.locator('.status').screenshot({path:'/tmp/ledger-refresh-controls.png'});
  assert.deepEqual(errors,[]);console.log('PASS: paced refreshes, respected cooldowns, cached image stability, global pause, and immediate cached reload.');
 }finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
