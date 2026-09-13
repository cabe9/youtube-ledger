// Actual Firefox extension with controlled watch-evidence fixtures. No personal browsing data.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-watch-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(process.cwd(),'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 const fixture=require('./watch-evidence-fixture.cjs');
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
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='network.beforeRequestSent'&&message.params.isBlocked){const request=message.params.request;(()=>{const media=request.url.endsWith('.wav')?fixture.mediaResponse(request.headers.find(h=>h.name.toLowerCase()==='range')?.value.value):null;return send('network.provideResponse',{request:request.request,statusCode:media?206:200,headers:[{name:'Content-Type',value:{type:'string',value:media?'audio/wav':new URL(request.url).hostname==='i.ytimg.com'?'image/svg+xml':'text/html; charset=utf-8'}},...Object.entries(media?.headers||{}).map(([name,value])=>({name,value:{type:'string',value}}))],body:media?{type:'base64',value:media.body.toString('base64')}:{type:'string',value:new URL(request.url).hostname==='i.ytimg.com'?fixture.svg:fixture.html(request.url)}});})().catch(error=>networkErrors.push(error.message));}else originalMessage(event);};
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
  await navigate('https://www.youtube.com/feed/subscriptions');
  for(let i=0;i<100&&!(await get())['watchEvidence:v1']?.videos.aaaaaaaaaaa;i++)await sleep(100);
  let data=await get();assert.equal(data['watchEvidence:v1'].videos.aaaaaaaaaaa.percent,95);assert.equal(data['watchEvidence:v1'].videos.bbbbbbbbbbb.percent,35);assert.equal(data['watchEvidence:v1'].videos.hidden00001,undefined);assert.equal(data['watchEvidence:v1'].videos.zero0000001,undefined);
  await navigate('https://www.youtube.com/feed/history#ledger-watch-check');
  for(let i=0;i<100&&!(await get())['watchEvidence:v1']?.videos.ccccccccccc;i++)await sleep(100);
  assert.ok((await get())['watchEvidence:v1'].videos.ccccccccccc);assert.equal((await get())['watchEvidence:v1'].videos.ddddddddddd,undefined);
  await navigate('https://www.youtube.com/feed/subscriptions#ledger-group=watch');
  await wait(`return ${feed}?.querySelectorAll('article').length===4;`);
  assert.deepEqual(await evaluate(`return [...${feed}.querySelectorAll('.watch-badge')].map(n=>n.hidden?'':n.textContent);`),['Watched','Started','Seen before','']);
  await evaluate(`${feed}.querySelector('[data-focus=filters]').click();`);await evaluate(`${feed}.querySelector('[data-focus=hide-played]').click();`);await wait(`return ${feed}.querySelectorAll('article').length===1;`);
  assert.equal(await evaluate(`return ${feed}.querySelector('article').dataset.videoId;`),'ddddddddddd');
  await evaluate(`${feed}.querySelector('[data-focus=chip-played]').click();`);await wait(`return ${feed}.querySelectorAll('article').length===4;`);
  await evaluate(`${feed}.querySelector('[data-focus=group-options]').click();[...${feed}.querySelectorAll('[role=menuitem]')].find(n=>n.textContent==='Update watch status').click();`);
  const modal="document.querySelector('#ledger-watch-status-dialog')?.shadowRoot.querySelector('dialog')";
  await wait(`return !!${modal};`);
  const file=path.join(temporary,'watch-history.json');fs.writeFileSync(file,JSON.stringify([{header:'YouTube',titleUrl:'https://www.youtube.com/watch?v=ddddddddddd',time:new Date(Date.now()-100000).toISOString()}]));
  const input=await send('script.evaluate',{expression:`${modal}.querySelector('input[type=file]')`,target:{context},awaitPromise:false});
  await send('input.setFiles',{context,element:{sharedId:input.result.sharedId},files:[file]});
  await wait(`return ${modal}.querySelector('[role=status]').textContent.includes('Ready to import');`);assert.equal((await get())['watchEvidence:v1'].videos.ddddddddddd,undefined);
  await evaluate(`[...${modal}.querySelectorAll('button')].find(n=>n.textContent==='Import seen videos').click();`);await wait(`return ${modal}.querySelector('[role=status]').textContent.includes('records updated');`);
  await evaluate(`[...${modal}.querySelectorAll('button')].find(n=>n.textContent==='Done').click();`);await wait(`return [...${feed}.querySelectorAll('.watch-badge')].at(-1).textContent==='Seen before';`);
  const capture=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync('/tmp/ledger-watch-evidence-firefox.png',Buffer.from(capture.data,'base64'));
  await send('browsingContext.reload',{context,wait:'complete'});await wait(`return ${feed}?.querySelectorAll('article').length===4;`);assert.equal(await evaluate(`return [...${feed}.querySelectorAll('.watch-badge')].at(-1).textContent;`),'Seen before');
  data=await get();assert.deepEqual(data['videoProgress:v1'].videos,{});assert.equal(data['test:unexpected-fetch'],undefined);
  await navigate('https://www.youtube.com/watch?v=natural0001');

  await evaluate("const v=document.querySelector('video');if(v.readyState<4)await new Promise(r=>v.addEventListener('canplaythrough',r,{once:true}));v.currentTime=3.6;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));if(Math.abs(v.currentTime-3.6)>.1)throw Error('Fixture seek failed: '+v.currentTime);v.playbackRate=4;await v.play();");
  for(let i=0;i<150&&!(await get())['videoProgress:v1'].videos.natural0001?.finishedAt;i++)await sleep(100);
  const value=(await get())['videoProgress:v1'].videos.natural0001;assert.ok(value?.finishedAt,JSON.stringify(value));const fraction=value.segments.reduce((n,[a,b])=>n+b-a,0)/value.duration;assert.ok(fraction>=.8&&fraction<.9,JSON.stringify(value));
  assert.deepEqual(networkErrors,[]);console.log('PASS: Firefox native progress/history, no hidden or zero-bar sightings, Seen before, previously-played filter, real FileReader JSON preview/import, live badges, reload persistence, no metadata fetches, no imported playback, and real natural completion.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
