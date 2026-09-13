// Actual Firefox extension with controlled group-debug fixtures. No personal browsing data.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-debug-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(process.cwd(),'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),"(async()=>{\n const now=Date.now(),A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),ids=[A,B];\n globalThis.fetch=async()=>{await browser.storage.local.set({'test:unexpected-fetch':true});throw Error('Unexpected metadata request');};\n const uploads={version:1,channels:{}};\n for(const [i,id] of ids.entries())uploads.channels[id]={fetchedAt:now,attemptedAt:now,viewsAttemptedAt:now,latestUploadAt:now-(i?1:100)*86400000,entries:[{videoId:String(i).repeat(11),channelId:id,channel:i?'Active channel':'Inactive channel',title:'Cached upload',publishedAt:now-(i?1:100)*86400000,views:{count:42,checkedAt:now},details:{status:'available',duration:123,shorts:false,checkedAt:now}}]};\n Object.assign(uploads.channels[A],{error:'Synthetic channel timeout',retryAt:now+3600000,feedSource:'uploads-page'});\n const original=GroupFeeds.handle;GroupFeeds.handle=async(message,sender)=>{const result=await original(message,sender);if(message.type==='groupFeed:get'&&result)result.refresh={total:2,checked:1,refreshed:0,failed:1,cached:0,running:!(await browser.storage.local.get('test:progressDone'))['test:progressDone']};return result;};\n await browser.storage.local.set({paused:true,settings:Ledger.settings({backgroundGroupChecks:false}),'channelGroups:v1':{version:1,groups:[{id:'debug',name:'Debug fixture',channelIds:ids}],channels:Object.fromEntries(ids.map((id,i)=>[id,{id,name:i?'Active channel':'Inactive channel',avatarCheckedAt:now}]))},'channelUploads:v1':uploads});\n await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?source-test=1#settings')});\n})();");
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
  'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
  'browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false
 }).map(([key,value])=>`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','--remote-allow-system-access','--profile',profile,'--remote-debugging-port=0'],{env:{...process.env,MOZ_HEADLESS:'1'},stdio:['ignore','pipe','pipe']});
 let socket,sequence=0,log='';const pending=new Map();
 try{
  const endpoint=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Firefox startup timed out: '+log)),20000);
   firefox.once('error',error=>{clearTimeout(timer);reject(error);});
   firefox.once('exit',code=>{clearTimeout(timer);reject(new Error('Firefox exited: '+code+' '+log));});
   for(const stream of [firefox.stdout,firefox.stderr])stream.on('data',chunk=>{
    log+=chunk.toString();const match=log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
    if(match){clearTimeout(timer);resolve(match[1]+'/session');}
   });
  });
  socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.type==='error'?item.reject(new Error(message.error+': '+message.message)):item.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const session=await send('session.new',{capabilities:{}});console.log('Firefox '+session.capabilities.browserVersion);
  const networkErrors=[],fixture=url=>new URL(url).hostname==='i.ytimg.com'?'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#654477"/></svg>':'<style>ytd-page-manager{display:block}body{margin:0}</style><ytd-masthead>YouTube fixture</ytd-masthead><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>';
  const originalMessage=socket.onmessage;
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='network.beforeRequestSent'&&message.params.isBlocked){const request=message.params.request;send('network.provideResponse',{request:request.request,statusCode:200,headers:[{name:'Content-Type',value:{type:'string',value:new URL(request.url).hostname==='i.ytimg.com'?'image/svg+xml':'text/html; charset=utf-8'}}],body:{type:'string',value:fixture(request.url)}}).catch(error=>networkErrors.push(error.message));}else originalMessage(event);};
  await send('session.subscribe',{events:['network.beforeRequestSent']});
  await send('network.addIntercept',{phases:['beforeRequestSent'],urlPatterns:[{type:'pattern',protocol:'https',hostname:'www.youtube.com'},{type:'pattern',protocol:'https',hostname:'i.ytimg.com'}]});
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let dashboard;for(let attempt=0;attempt<100&&!dashboard;attempt++){dashboard=(await send('browsingContext.getTree',{})).contexts.find(tab=>tab.url.includes('source-test=1'));if(!dashboard)await sleep(100);}assert.ok(dashboard,'Seed dashboard opened');
  const {context}=await send('browsingContext.create',{type:'tab'});await send('browsingContext.activate',{context});
  await send('browsingContext.setViewport',{context,viewport:{width:1440,height:1000}});
  async function evaluate(expression){
   const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context},awaitPromise:true});
   if(result.type==='exception')throw new Error(result.exceptionDetails.text);
   return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
  }
  async function wait(expression){
   const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression);
  }
  const navigate=url=>send('browsingContext.navigate',{context,url,wait:'complete'});
  const feed="document.querySelector('#ledger-group-feed')?.shadowRoot";
  await navigate('https://www.youtube.com/feed/subscriptions#ledger-group=debug');
  await wait(`return ${feed}?.querySelectorAll('article').length===1;`);
  assert.equal(await evaluate(`return ${feed}.querySelector('.upload-progress').hidden;`),true);
  assert.equal(await evaluate(`return ${feed}.querySelectorAll('.members small,.channel-cadence,.fallback-note,[data-focus=retry-failed],[data-focus=refresh-details]').length;`),0);
  assert.doesNotMatch(await evaluate(`return ${feed}.querySelector('.status').textContent;`),/could not refresh/);
  await evaluate(`window.keptDebugThumbnail=${feed}.querySelector('article img');${feed}.querySelector('.group-members summary').click();${feed}.querySelector('[data-focus=group-options]').click();`);
  assert.equal(await evaluate(`return ${feed}.querySelector('[role=menuitemcheckbox]').getAttribute('aria-checked');`),'false');
  await evaluate(`${feed}.querySelector('[role=menuitemcheckbox]').click();`);
  await wait(`return ${feed}.querySelector('.members small')?.textContent==='Synthetic channel timeout';`);
  assert.equal(await evaluate(`return ${feed}.querySelector('.upload-progress').hidden;`),false);
  assert.equal(await evaluate(`return ${feed}.querySelector('.upload-progress-label').textContent;`),'1 of 2 channels checked');
  assert.equal(await evaluate(`return ${feed}.querySelector('.channel-cadence').textContent;`),'Checked daily');
  assert.equal(await evaluate(`return !!${feed}.querySelector('.fallback-note')&&keptDebugThumbnail.isConnected;`),true);
  const capture=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync('/tmp/ledger-group-debug-firefox.png',Buffer.from(capture.data,'base64'));
  await send('script.evaluate',{target:{context:dashboard.context},awaitPromise:true,expression:"browser.storage.local.set({'test:progressDone':true})"});
  await send('browsingContext.reload',{context,wait:'complete'});await wait(`return !!${feed}?.querySelector('[data-focus=retry-failed]');`);
  assert.match(await evaluate(`return ${feed}.querySelector('.status').textContent;`),/1 channel could not refresh/);
  const control=await send('script.evaluate',{target:{context:dashboard.context},awaitPromise:true,expression:`(()=>{const input=document.getElementById('setting-groupDebugMode');if(!input.checked)throw Error('Menu change did not reach Settings');input.checked=false;input.dispatchEvent(new Event('change'));return true;})()`});assert.equal(control.type,'success',JSON.stringify(control));
  await wait(`return ${feed}.querySelectorAll('.members small,.channel-cadence,.fallback-note').length===0&&${feed}.querySelector('.upload-progress').hidden;`);
  assert.equal(await evaluate(`return ${feed}.querySelectorAll('[data-focus=retry-failed],[data-focus=refresh-details]').length;`),0);
  assert.doesNotMatch(await evaluate(`return ${feed}.querySelector('.status').textContent;`),/could not refresh/);
  const check=await send('script.evaluate',{target:{context:dashboard.context},awaitPromise:true,expression:"(async()=>{const s=await browser.storage.local.get(['settings','test:unexpected-fetch']);return s.settings.groupDebugMode===false&&!s['test:unexpected-fetch'];})()"});assert.equal(check.result.value,true,JSON.stringify(check));
  assert.deepEqual(networkErrors,[]);console.log('PASS: Firefox debug-mode default, menu toggle, active progress, failed-channel summaries and retry controls, per-channel details, stable thumbnails, reload persistence, Settings sync, and no extra requests.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
