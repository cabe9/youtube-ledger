// Real Firefox content-script uploads: catches Xray/realm failures that Chromium cannot.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {animatedGif,largeAnimatedGif}=require('./icon-fixtures.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-images-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),"browser.storage.local.set({'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',channelIds:[]}],channels:{}},settings:{theme:'retrowave'}});");
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
  'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
  'browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false
 }).map(([key,value])=>`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','--profile',profile,'--remote-debugging-port=0'],{stdio:['ignore','pipe','pipe']});
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
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  const {context}=await send('browsingContext.create',{type:'tab'});
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
  await navigate('https://www.youtube.com/');
  const sidebar="document.querySelector('#ledger-groups-sidebar')?.shadowRoot";
  const dialog="document.querySelector('#ledger-group-icon-dialog')?.shadowRoot";
  await wait(`return !!${sidebar}?.querySelector('.nav-options');`);
  const entry=await evaluate(`
    window.groupEntryProbe={id:crypto.randomUUID(),frames:0,blank:0,running:true};
    function sample(){const probe=groupEntryProbe;if(!probe.running)return;const feed=document.querySelector('#ledger-group-feed');probe.frames++;if(!feed?.shadowRoot.querySelector('.content')||!feed.getBoundingClientRect().height)probe.blank++;requestAnimationFrame(sample);}requestAnimationFrame(sample);
    ${sidebar}.querySelector('a').click();return groupEntryProbe.id;
  `);
  await wait("return location.pathname+location.hash==='/feed/subscriptions#ledger-group=podcasts';");
  await wait('return window.groupEntryProbe?.frames>3;');
  const entryResult=await evaluate('groupEntryProbe.running=false;return groupEntryProbe;');
  assert.equal(entryResult.id,entry,'First group entry keeps the Firefox document');assert.equal(entryResult.blank,0,'First entry has no blank frames');
  const open=async()=>{await evaluate(`${sidebar}.querySelector('.nav-options').click();document.getElementById('ledger-group-actions').shadowRoot.querySelector('[role=menuitem]').click();`);await wait(`return !!${dialog}?.querySelector('dialog[open]');`);};
  const status=()=>evaluate(`return ${dialog}?.querySelector('.status').textContent;`);
  async function upload(name,buffer){
   const filePath=path.join(temporary,name);fs.writeFileSync(filePath,buffer);
   const result=await send('script.evaluate',{expression:`${dialog}.querySelector('input[type=file]')`,target:{context},awaitPromise:false});
   await send('input.setFiles',{context,element:{sharedId:result.result.sharedId},files:[filePath]});
   await wait(`return /Image ready|error/.test(${dialog}.querySelector('.status').textContent+' '+${dialog}.querySelector('.status').className);`);
  }
  async function save(){await evaluate(`${dialog}.querySelector('button[type=submit]').click();`);await wait(`return !${dialog};`);}
  const gif=animatedGif(),gifURL='data:image/gif;base64,'+gif.toString('base64');
  await open();await upload('animated.gif',gif);assert.match(await status(),/Image ready/);
  assert.equal(await evaluate(`return ${dialog}.querySelector('.icon-preview img').src;`),gifURL,'GIF bytes retained');
  const preview=await send('script.evaluate',{expression:`${dialog}.querySelector('.icon-preview img')`,target:{context},awaitPromise:false});
  const frames=new Set();for(const delay of [37,83,127,149,71]){
   await sleep(delay);const shot=await send('browsingContext.captureScreenshot',{context,clip:{type:'element',element:{sharedId:preview.result.sharedId}}});frames.add(shot.data);
  }assert.ok(frames.size>1,'GIF preview animates');
  await save();await wait(`const image=${sidebar}.querySelector('.group-icon img');return image?.complete&&image.naturalWidth===32;`);
  const rasters=await evaluate(`const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;const paint=canvas.getContext('2d');paint.fillStyle='#f8a3e2';paint.fillRect(0,0,640,320);return ['png','jpeg','webp'].map(type=>({type,url:canvas.toDataURL('image/'+type)}));`);
  for(const {type,url} of rasters){
   await open();await upload('wide.'+type,Buffer.from(url.split(',')[1],'base64'));assert.match(await status(),/Image ready/);
   assert.deepEqual(await evaluate(`const image=${dialog}.querySelector('.icon-preview img');return [image.naturalWidth,image.naturalHeight];`),[128,64]);await save();
  }
  await open();await upload('oversize.gif',largeAnimatedGif());assert.match(await status(),/Image ready/);
  await wait(`return ${dialog}.querySelector('.icon-preview img')?.naturalWidth>0;`);
  const resized=await evaluate(`const image=${dialog}.querySelector('.icon-preview img');return {width:image.naturalWidth,url:image.src};`);assert.ok(resized.width<=128);assert.ok(Buffer.from(resized.url.split(',')[1],'base64').length<=512*1024);
  const compressedPreview=await send('script.evaluate',{expression:`${dialog}.querySelector('.icon-preview img')`,target:{context},awaitPromise:false});
  const compressedFrames=new Set();for(const delay of [100,120,140]){await sleep(delay);const shot=await send('browsingContext.captureScreenshot',{context,clip:{type:'element',element:{sharedId:compressedPreview.result.sharedId}}});compressedFrames.add(shot.data);}assert.ok(compressedFrames.size>1,'Firefox resized GIF animates');
  await upload('over-limit.gif',Buffer.alloc(11*1024*1024));assert.match(await status(),/under 10 MB/);
  await upload('fake.png',Buffer.from('<svg><script/></svg>'));assert.match(await status(),/Choose a PNG/);
  await upload('again.gif',gif);assert.match(await status(),/Image ready/);await save();
  await send('browsingContext.reload',{context,wait:'complete'});
  await wait(`const image=${sidebar}?.querySelector('.group-icon img');return image?.complete&&image.naturalWidth===32;`);
  assert.equal(await evaluate(`return ${sidebar}.querySelector('.group-icon img').src;`),gifURL);
  console.log('PASS: Firefox first group entry preserves the document without blank frames on live YouTube; GIF upload/preview/save, PNG/JPG/WebP resize, animated GIF compression, invalid/over-10-MB rejection, and persistence after page reload.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);
  socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
