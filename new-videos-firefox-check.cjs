// Actual Firefox extension with controlled new-video fixtures. No personal browsing data.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-arrivals-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(process.cwd(),'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 const fixture=require('./new-videos-fixture.cjs');
 fs.writeFileSync(path.join(extension,'test-seed.js'),'('+fixture.seed.toString()+')().then(()=>browser.tabs.create({url:browser.runtime.getURL("dashboard.html?source-test=1#settings")}));');
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
  'media.autoplay.default':0,'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
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
  const networkErrors=[];
  const originalMessage=socket.onmessage;
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='network.beforeRequestSent'&&message.params.isBlocked){const request=message.params.request,isImage=new URL(request.url).hostname==='i.ytimg.com';send('network.provideResponse',{request:request.request,statusCode:200,headers:[{name:'Content-Type',value:{type:'string',value:isImage?'image/svg+xml':'text/html; charset=utf-8'}}],body:{type:'string',value:isImage?fixture.svg:fixture.html(request.url)}}).catch(error=>networkErrors.push(error.message));}else originalMessage(event);};
  await send('session.subscribe',{events:['network.beforeRequestSent']});
  await send('network.addIntercept',{phases:['beforeRequestSent'],urlPatterns:[{type:'pattern',protocol:'https',hostname:'www.youtube.com'},{type:'pattern',protocol:'https',hostname:'i.ytimg.com'}]});
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let dashboard;for(let attempt=0;attempt<100&&!dashboard;attempt++){dashboard=(await send('browsingContext.getTree',{})).contexts.find(tab=>tab.url.includes('source-test=1'));if(!dashboard)await sleep(100);}assert.ok(dashboard,'Seed dashboard opened');
  const {context}=await send('browsingContext.create',{type:'tab'});await send('browsingContext.activate',{context});
  await send('browsingContext.setViewport',{context,viewport:{width:1440,height:1000}});
  async function evaluate(expression,at=context){
   const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context:at},awaitPromise:true});
   if(result.type==='exception')throw new Error(result.exceptionDetails.text);
   return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
  }
  async function wait(expression){
   const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression);
  }
  const navigate=url=>send('browsingContext.navigate',{context,url,wait:'complete'});
  const feed="document.querySelector('#ledger-group-feed')?.shadowRoot";
  const get=()=>evaluate("return browser.storage.local.get(null);",dashboard.context);

  const before=(await get())['videoProgress:v1'];
  await navigate('https://www.youtube.com/feed/subscriptions#ledger-new');
  await wait(`return ${feed}?.querySelectorAll('article').length===3;`);
  assert.equal(await evaluate(`return ${feed}.querySelectorAll('.creator-return').length;`),1);
  await wait(`return !!${feed}.querySelector('.creator-return');`);assert.equal(await evaluate(`return ${feed}.querySelector('.creator-return').textContent;`),'Back after 8 months');
  assert.equal(await evaluate(`return ${feed}.querySelector('[data-video-id=aaaaaaaaaaa] .arrival-memberships').children.length;`),2);
  assert.equal(await evaluate(`return ${feed}.querySelector('.upload-progress,.freshness,.group-members')===null;`),true);
  const click=selector=>evaluate(`${feed}.querySelector(${JSON.stringify(selector)}).click();`);
  await click('[data-focus=arrivals-returning]');await wait(`return ${feed}.querySelectorAll('article').length===1;`);
  assert.equal(await evaluate(`return ${feed}.querySelector('article').dataset.videoId;`),'aaaaaaaaaaa');
  await click('[data-focus=arrivals-new]');await click('[data-focus=arrivals-shorts]');await wait(`return ${feed}.querySelectorAll('article').length===2;`);
  await click('[data-focus=caught-up]');await wait(`return ${feed}.querySelectorAll('article').length===0;`);
  assert.deepEqual((await get())['videoProgress:v1'],before);
  await click('[data-focus=arrivals-all]');await wait(`return ${feed}.querySelectorAll('article').length===2;`);
  assert.equal(await evaluate(`return [...${feed}.querySelectorAll('.new-upload')].filter(n=>!n.hidden).length;`),0);
  await click('[data-focus=arrivals-shorts]');await wait(`return ${feed}.querySelectorAll('article').length===3;`);
  await click('[data-focus=caught-up]');await wait(`return ${feed}.querySelector('[data-focus=caught-up]').disabled;`);
  await evaluate('return ('+fixture.addLate.toString()+')();',dashboard.context);
  await wait(`return !!${feed}.querySelector('article[data-video-id=late0000001]');`);
  await click('[data-focus=arrivals-new]');await wait(`return ${feed}.querySelectorAll('article').length===1;`);
  await send('browsingContext.reload',{context,wait:'complete'});await wait(`return ${feed}?.querySelectorAll('article').length===1;`);
  assert.equal(await evaluate(`return ${feed}.querySelector('article').dataset.videoId;`),'late0000001');
  await click('.video-options');await evaluate(`[...${feed}.querySelectorAll('[role=menuitem]')].find(n=>n.textContent==='Mark watched').click();`);
  await wait(`return ${feed}.querySelector('.watch-badge').textContent==='Watched';`);
  await click('.arrival-memberships a');await wait(`return location.hash==='#ledger-group=learn'&&!!${feed}.querySelector('[data-focus=group-options]');`);
  await wait(`return !!${feed}.querySelector('.creator-return');`);assert.equal(await evaluate(`return ${feed}.querySelector('.creator-return').textContent;`),'Back after 8 months');
  await evaluate("document.querySelector('#ledger-groups-sidebar').shadowRoot.querySelector('[data-new-videos]').click();");
  await wait(`return location.hash==='#ledger-new'&&!!${feed}.querySelector('[data-focus=caught-up]');`);
  await click('[data-focus=arrivals-all]');await wait(`return ${feed}.querySelectorAll('article').length===4;`);
  const capture=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync('/tmp/ledger-new-videos-firefox.png',Buffer.from(capture.data,'base64'));
  await send('browsingContext.setViewport',{context,viewport:{width:390,height:850}});
  assert.equal(await evaluate(`const box=document.querySelector('#ledger-group-feed').getBoundingClientRect();return box.left>=0&&box.right<=390;`),true);
  assert.equal((await get())['test:unexpected-fetch'],undefined);
  assert.deepEqual(networkErrors,[]);console.log('PASS: Firefox combined arrivals, return badges, caught-up snapshot, untouched watch state, late discoveries, reload, watch controls, real group navigation, cache-only reads and mobile layout.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
