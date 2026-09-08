// Actual Firefox extension with controlled Watch Later menu fixtures. No account changes.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-watch-later-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),"(async()=>{await browser.storage.local.set({paused:true,'videoProgress:v1':{version:1,videos:{aaaaaaaaaaa:{observed:true,segments:[[0,95]],duration:100},ddddddddddd:{observed:true,segments:[[0,100]],duration:100,manual:'unwatched'}}}});await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?watch-later-test=1#settings')});})();");
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
  const {fixture}=require('./watch-later-check.cjs'),networkErrors=[];
  const originalMessage=socket.onmessage;
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='network.beforeRequestSent'&&message.params.isBlocked){const request=message.params.request;send('network.provideResponse',{request:request.request,statusCode:200,headers:[{name:'Content-Type',value:{type:'string',value:'text/html; charset=utf-8'}}],body:{type:'string',value:fixture(request.url)}}).catch(error=>networkErrors.push(error.message));}else originalMessage(event);};
  await send('session.subscribe',{events:['network.beforeRequestSent']});
  await send('network.addIntercept',{phases:['beforeRequestSent'],urlPatterns:[{type:'pattern',protocol:'https',hostname:'www.youtube.com',pathname:'/playlist'}]});
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let dashboard;for(let attempt=0;attempt<100&&!dashboard;attempt++){dashboard=(await send('browsingContext.getTree',{})).contexts.find(tab=>tab.url.includes('watch-later-test=1'));if(!dashboard)await sleep(100);}assert.ok(dashboard,'Seed dashboard opened');
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
  await navigate('https://www.youtube.com/playlist?list=WL');
  const root="document.querySelector('#ledger-watch-later-tools')?.shadowRoot";
  await wait(`return [...(${root}?.querySelectorAll('button')||[])].some(b=>b.textContent==='Select watched'&&!b.disabled);`);
  const clickButton=name=>evaluate(`[...${root}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(name)}).click();`);
  const choose=(index,shift=false)=>evaluate(`document.querySelectorAll('.ledger-watch-later-choice')[${index}].shadowRoot.querySelector('input').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true,shiftKey:${shift}}));`);
  const states=()=>evaluate(`return [...document.querySelectorAll('.ledger-watch-later-choice')].map(h=>h.shadowRoot.querySelector('input').checked);`);
  async function aligned(){await wait(`const b=${root}?.querySelector('button:not([hidden])'),filter=document.querySelector('yt-chip-cloud-renderer button'),thumb=document.querySelector('ytd-playlist-video-renderer img');return b&&Math.abs(b.getBoundingClientRect().left-filter.getBoundingClientRect().left)<1&&Math.abs(thumb.getBoundingClientRect().left-filter.getBoundingClientRect().left)<1;`);}
  await aligned();await clickButton('Select videos');await aligned();
  await choose(0);await choose(2,true);assert.deepEqual(await states(),[true,true,true,false]);
  await clickButton('Clear selection');await choose(3);await choose(1,true);assert.deepEqual(await states(),[false,true,true,true]);
  await choose(3);await choose(1,true);assert.deepEqual(await states(),[false,false,false,false]);
  await send('browsingContext.setViewport',{context,viewport:{width:800,height:1000}});await aligned();
  await send('browsingContext.setViewport',{context,viewport:{width:1440,height:1000}});await aligned();
  await clickButton('Done');await clickButton('Select watched');
  await wait(`return ${root}?.querySelector('.count')?.textContent==='2 selected';`);
  assert.deepEqual(await evaluate(`return [...document.querySelectorAll('.ledger-watch-later-choice')].map(h=>h.shadowRoot.querySelector('input').checked);`),[true,true,false,false]);
  await evaluate(`[...${root}.querySelectorAll('button')].find(b=>b.textContent==='Remove selected (2)').click();`);
  await wait(`return ${root}?.querySelector('[role="status"]')?.textContent==='Removed 2 videos from Watch Later.';`);
  assert.deepEqual(await evaluate('return window.removed;'),['aaaaaaaaaaa','bbbbbbbbbbb']);
  const saved=await send('script.evaluate',{expression:"browser.storage.local.get(null).then(JSON.stringify)",target:{context:dashboard.context},awaitPromise:true});
  const data=JSON.parse(saved.result.value);assert.equal(data['videoProgress:v1'].videos.aaaaaaaaaaa.duration,100);assert.ok(!Object.keys(data).some(key=>key.startsWith('day:')));
  const shot=await send('browsingContext.captureScreenshot',{context});fs.writeFileSync('/tmp/ledger-watch-later-firefox.png',Buffer.from(shot.data,'base64'));
  await navigate('https://www.youtube.com/playlist?list=PLother');await sleep(200);assert.equal(await evaluate("return !!document.querySelector('#ledger-watch-later-tools');"),false);
  assert.deepEqual(networkErrors,[]);
  console.log('PASS: Firefox toolbar stays aligned across viewport sizes and selection mode; forward/backward/deselect ranges work; native-menu fixtures select only completed videos, remove exactly the selected Watch Later rows, preserve Ledger data, and stay off other playlists.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
