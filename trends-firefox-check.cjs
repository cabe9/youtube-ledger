// Actual Firefox extension with controlled Sources chart fixtures. No personal browsing data.
// Run after build.py; FIREFOX_BIN can select a Firefox 140+ executable on other systems.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-firefox-trends-')),profile=path.join(temporary,'profile');fs.mkdirSync(profile);
 // Seed only the disposable test profile; the packaged runtime files stay unmodified.
 const extension=path.join(temporary,'extension');fs.cpSync(path.join(__dirname,process.env.LEDGER_TEST_CHANNEL==='experimental'?'dist/experimental/firefox':'dist/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),`(async()=>{
  const now=Date.now(),day=Ledger.dayKey(now),sources=[{kind:'recommendations'},{kind:'channel'},{kind:'group',groupId:'podcasts',groupName:'Podcasts'},{kind:'group',groupId:'music',groupName:'Music'},{kind:'unknown'}];
  const rows=sources.map((source,i)=>({id:'source-'+i,videoId:String(i).repeat(11),title:'Source episode '+i,url:'https://www.youtube.com/watch?v='+String(i).repeat(11),start:now-60000,end:now,label:'Unsorted',source,seconds:{foreground:60*(i+1),backgroundAudio:10,backgroundSilent:0,paused:0,browsing:0,ad:0}}));
  const previousDay=Ledger.datesEnding(day,2)[0],previousStart=+new Date(previousDay+'T12:00:00');
  await browser.storage.local.set({paused:true,settings:Ledger.settings({theme:'retrowave'}),['day:'+day]:rows,['day:'+previousDay]:[{...rows[1],id:'previous-channel',start:previousStart,end:previousStart+60000}]});
  await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?trends-test=1')});
 })();`);
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
  socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.type==='error'?item.reject(new Error(item.method+': '+message.error+': '+message.message)):item.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params}));});
  const session=await send('session.new',{capabilities:{}});console.log('Firefox '+session.capabilities.browserVersion);
  await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let dashboard;for(let attempt=0;attempt<100&&!dashboard;attempt++){dashboard=(await send('browsingContext.getTree',{})).contexts.find(tab=>tab.url.includes('trends-test=1'));if(!dashboard)await sleep(100);}assert.ok(dashboard,'Seed dashboard opened');
  const context=dashboard.context;
  async function evaluate(expression){
   const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context},awaitPromise:true});
   if(result.type==='exception')throw new Error(result.exceptionDetails.text);
   return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
  }
  async function wait(expression){const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression+' '+JSON.stringify(await evaluate('return {width:innerWidth,height:innerHeight,outerWidth,outerHeight};')));}
  async function resize(width,height){await evaluate(`const current=await browser.windows.getCurrent();await browser.windows.update(current.id,{width:${width}+outerWidth-innerWidth,height:${height}+outerHeight-innerHeight});`);await wait(`return innerWidth===${width};`);}
  await wait("return document.querySelectorAll('.trend-day').length===7;");await resize(1280,1000);
  await evaluate("document.querySelector('[data-metric=sources]').click();");
  assert.equal(await evaluate("return document.querySelectorAll('.source-summary-row').length;"),4);
  assert.equal(await evaluate("return [...document.querySelectorAll('.source-segment')].reduce((n,b)=>n+Number(b.dataset.seconds),0);"),1080);
  assert.equal(await evaluate("return document.getElementById('source-change-heading').hidden;"),true);
  await evaluate("document.querySelector('.source-summary-row[data-source=channel] td').click();");
  await wait("return document.querySelectorAll('#rows tr').length===2;");
  assert.equal(await evaluate("return new Set([...document.querySelectorAll('#rows tr')].map(row=>row.dataset.day)).size;"),2,'The same video is shown on both recorded dates');
  assert.equal(await evaluate("return document.getElementById('source-filter').value;"),'channel');
  assert.equal(await evaluate("return new URLSearchParams(location.hash.split('?')[1]).get('period');"),'7');
  assert.equal(await evaluate("return getComputedStyle(document.getElementById('cards')).display;"),'none');
  await resize(600,1000);assert.equal(await evaluate("return document.documentElement.scrollWidth<=innerWidth;"),true,'Period History fits narrow Firefox');await resize(1280,1000);
  await evaluate("document.querySelector('.dashboard-nav [data-open-view=overview]').click();document.querySelector('.source-summary-row[data-source=groups] a').click();");
  await wait("return document.getElementById('source-filter').value==='groups'&&document.querySelectorAll('#rows tr').length===2;");
  await evaluate('window.periodReloadPending=true;setTimeout(()=>location.reload(),100);');
  {const end=Date.now()+20000;while(Date.now()<end){try{if(await evaluate("return !window.periodReloadPending&&document.querySelectorAll('#rows tr').length===2;"))break;}catch{}await sleep(100);}}
  await wait("return !window.periodReloadPending&&document.querySelectorAll('#rows tr').length===2;");
  assert.equal(await evaluate("return new URLSearchParams(location.hash.split('?')[1]).get('period');"),'7');
  await evaluate("document.querySelector('.dashboard-nav [data-open-view=overview]').click();document.querySelector('[data-metric=sources]').click();");
  await evaluate("document.querySelector('.source-segment[data-source=groups]').click();");
  await wait("return document.querySelectorAll('#rows tr').length===2;");
  assert.equal(await evaluate("return document.getElementById('source-filter').value;"),'groups');
  await evaluate('window.reloadPending=true;setTimeout(()=>location.reload(),100);');
  {const end=Date.now()+20000;while(Date.now()<end){try{if(await evaluate("return !window.reloadPending&&document.querySelectorAll('#rows tr').length===2;"))break;}catch{}await sleep(100);}}
  await wait("return !window.reloadPending&&document.querySelectorAll('#rows tr').length===2;");
  assert.equal(await evaluate("return document.getElementById('source-filter').value;"),'groups');
  await evaluate("document.querySelector('.dashboard-nav [data-open-view=overview]').click();document.querySelector('[data-metric=sources]').click();document.getElementById('trend-group-breakdown').click();");
  assert.equal(await evaluate("return document.querySelectorAll('.source-summary-row').length;"),5);
  await evaluate("document.querySelector('.source-segment[data-source=channel]').click();");await wait("return document.querySelectorAll('#rows tr').length===1;");
  assert.equal(await evaluate("return document.getElementById('source-filter').value;"),'channel');
  await evaluate("document.querySelector('.dashboard-nav [data-open-view=overview]').click();");
  for(const theme of ['retrowave','classic','dark-green','frutiger-aero']){
   await evaluate(`const data=await browser.storage.local.get('settings');await browser.storage.local.set({settings:{...data.settings,theme:${JSON.stringify(theme)}}});`);
   await wait(`return document.documentElement.dataset.theme===${JSON.stringify(theme)};`);
   await resize(600,1000);
   assert.equal(await evaluate("return document.documentElement.scrollWidth<=innerWidth;"),true,theme+' fits narrow Firefox');
   assert.equal(await evaluate("return getComputedStyle(document.querySelector('.source-segment')).boxShadow;"),'none');
   assert.equal(await evaluate("return getComputedStyle(document.querySelector('.source-day .trend-date[aria-pressed=true]')).backgroundImage;"),'none');
   await resize(1280,1000);
  }
  console.log('PASS: Firefox clickable period totals, multi-day History, range reload, daily source totals, combined/split groups, filtered History, reload, absent previous comparison, and four narrow theme layouts. Disposable extension profile; synthetic data only.');
 }finally{
  for(const item of pending.values())clearTimeout(item.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}fs.rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
