// End-to-end group sharing through Chrome and Firefox UI; disposable profiles only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{chromium}=require('playwright');
const {animatedGif}=require('./icon-fixtures.cjs'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),gif='data:image/gif;base64,'+animatedGif().toString('base64');
const seed={paused:true,settings:{theme:'retrowave',reviewPreference:'Private review preference'},'goals:2026-09-07':'Private notes',
 'day:2026-09-07':[],'groupBrowsing:v1':{version:1,groups:{podcasts:{hidden:['aaaaaaaaaaa'],lastVisitedAt:123}}},
 'channelGroups:v1':{version:1,groups:[{id:'podcasts',name:'Podcasts',icon:{kind:'image',value:gif},channelIds:[A,B],createdAt:1,updatedAt:2,watchFilter:'watched'},
 {id:'music',name:'Music',icon:{kind:'emoji',value:'🎵'},channelIds:[B],createdAt:3,updatedAt:4}],
 channels:Object.fromEntries([[A,'Alpha Podcast'],[B,'Beta Music']].map(([id,name])=>[id,{id,name,url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:Date.now()}]))}};
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-sharing-check-'));let chrome;
 const exportedFile=path.join(temp,'shared-groups.json'),bareFile=path.join(temp,'without-icons.json');
 try{
  const extension=path.join(__dirname,'dist/chrome'),errors=[];
  chrome=await chromium.launchPersistentContext(path.join(temp,'chrome'),{channel:'chromium',headless:true,viewport:{width:1280,height:960},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await chrome.route('https://www.youtube.com/**',r=>r.abort());
  const worker=chrome.serviceWorkers()[0]||await chrome.waitForEvent('serviceworker');await worker.evaluate(seed=>chrome.storage.local.set(seed),seed);
  const page=await chrome.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome-extension://'+new URL(worker.url()).host+'/dashboard.html#groups');
  const manager=page.locator('#channel-groups-manager'),dialog=page.getByRole('dialog');
  await manager.getByRole('heading',{name:'Podcasts',exact:true}).waitFor();
  const before=await worker.evaluate(()=>chrome.storage.local.get(null));
  await manager.getByRole('button',{name:'Share groups',exact:true}).click();
  await dialog.getByRole('checkbox',{name:'Include group icons'}).waitFor();
  assert.equal(await dialog.getByRole('checkbox',{name:/Podcasts/}).isChecked(),true);assert.equal(await dialog.getByRole('checkbox',{name:/Music/}).isChecked(),false);
  await dialog.getByText('View channels',{exact:true}).first().click();await dialog.getByRole('link',{name:'Alpha Podcast'}).waitFor();
  assert.equal(await dialog.getByRole('link',{name:'Alpha Podcast'}).getAttribute('href'),'https://www.youtube.com/channel/'+A);
  for(const theme of ['retrowave','classic','dark-green','frutiger-aero']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.setViewportSize({width:375,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' sharing fits narrow screen');
   assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,theme+' dialog has no horizontal overflow');
  }
  await page.screenshot({path:'/tmp/ledger-sharing-mobile.png'});await page.setViewportSize({width:1280,height:960});await page.evaluate(()=>document.documentElement.dataset.theme='retrowave');
  await dialog.screenshot({path:'/tmp/ledger-sharing-export.png'});
  let download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download groups file'}).click();await(await download).saveAs(exportedFile);
  const exported=JSON.parse(fs.readFileSync(exportedFile,'utf8'));assert.equal(exported.groups.length,1);assert.equal(exported.groups[0].icon.value,gif);assert.deepEqual(exported.channels.map(c=>c.id),[A,B]);
  assert.equal(fs.readFileSync(exportedFile,'utf8').includes('Private'),false);assert.equal(exported.groups[0].watchFilter,undefined);assert.equal(exported.groups[0].id,undefined);
  await dialog.getByRole('checkbox',{name:'Select all groups'}).check();await dialog.getByRole('checkbox',{name:'Include group icons'}).uncheck();
  download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download groups file'}).click();await(await download).saveAs(bareFile);
  const bare=JSON.parse(fs.readFileSync(bareFile,'utf8'));assert.equal(bare.groups.length,2);assert.ok(bare.groups.every(g=>!g.icon));
  await dialog.getByRole('button',{name:'Close share groups'}).click();await dialog.waitFor({state:'detached'});
  await manager.getByRole('button',{name:'Import groups',exact:true}).click();
  const choose=async file=>{const picker=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Choose groups file'}).click();await(await picker).setFiles(file);};
  await choose(exportedFile);await dialog.getByRole('checkbox',{name:/Podcasts/}).waitFor();
  assert.deepEqual((await worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1')))['channelGroups:v1'],before['channelGroups:v1'],'Preview does not modify groups');
  await dialog.getByText('View channels',{exact:true}).click();await dialog.getByRole('link',{name:'Beta Music'}).waitFor();await dialog.screenshot({path:'/tmp/ledger-sharing-import.png'});
  await page.mouse.click(5,5);await dialog.waitFor({state:'detached'});
  assert.equal((await worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1')))['channelGroups:v1'].groups.length,2,'Clicking outside cancels import');
  await manager.getByRole('button',{name:'Import groups',exact:true}).click();await choose(bareFile);await dialog.getByRole('checkbox',{name:/Music/}).waitFor();
  await dialog.getByRole('checkbox',{name:/Music/}).uncheck();await dialog.getByRole('button',{name:'Import selected groups'}).click();await dialog.getByText('Podcasts (2)',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await manager.getByRole('heading',{name:'Podcasts (2)',exact:true}).waitFor();
  const after=await worker.evaluate(()=>chrome.storage.local.get(null));assert.equal(after['channelGroups:v1'].groups.length,3);assert.deepEqual(after['channelGroups:v1'].groups.slice(0,2),before['channelGroups:v1'].groups);
  for(const key of ['settings','goals:2026-09-07','day:2026-09-07','groupBrowsing:v1'])assert.deepEqual(after[key],before[key]);
  await manager.getByRole('button',{name:'Import groups',exact:true}).click();await choose(exportedFile);await dialog.getByRole('checkbox',{name:/Podcasts/}).waitFor();
  await dialog.locator('input[type=file]').setInputFiles({name:'profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'youtube-ledger-backup',data:{}}))});
  await dialog.getByRole('status').filter({hasText:/Profile backups/}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Import selected groups'}).isDisabled(),true,'Invalid file clears a previously valid choice');
  await choose(exportedFile);await dialog.getByRole('checkbox',{name:/Podcasts/}).waitFor();await dialog.getByRole('button',{name:'Import selected groups'}).click();await dialog.getByText('Podcasts (3)',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.reload();await manager.getByRole('heading',{name:'Podcasts',exact:true}).waitFor();
  assert.equal((await worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1')))['channelGroups:v1'].groups.at(-1).icon.value,gif,'Import survives reload with original GIF');
  assert.deepEqual(errors,[]);console.log('PASS Chrome: selected export, optional icons, private data exclusion, safe previews, selected import, collisions, cancel, invalid files, reload and four themes.');
  await chrome.close();chrome=null;
  await firefoxCheck(temp,exportedFile);
 }finally{await chrome?.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
async function firefoxCheck(temp,exportedFile){
 const profile=path.join(temp,'firefox'),extension=path.join(temp,'extension'),downloads=path.join(temp,'downloads');fs.mkdirSync(profile);fs.mkdirSync(downloads);
 fs.cpSync(path.join(__dirname,'dist/experimental/firefox'),extension,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.background.scripts.push('test-seed.js');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'test-seed.js'),`(async()=>{await browser.storage.local.set(${JSON.stringify(seed)});await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?sharing-test=1#groups')});})();`);
 fs.writeFileSync(path.join(profile,'user.js'),Object.entries({'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore','browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false,'browser.download.folderList':2,'browser.download.dir':downloads,'browser.download.useDownloadDir':true,'browser.helperApps.neverAsk.saveToDisk':'application/json'}).map(([k,v])=>`user_pref(${JSON.stringify(k)},${JSON.stringify(v)});`).join('\n'));
 const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
 const firefox=spawn(executable,['--headless','--no-remote','--remote-allow-system-access','--profile',profile,'--remote-debugging-port=0'],{env:{...process.env,MOZ_HEADLESS:'1'},stdio:['ignore','pipe','pipe']});
 let socket,sequence=0,log='';const pending=new Map();
 try{
  const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Firefox startup timed out: '+log)),20000);firefox.once('error',e=>{clearTimeout(timer);reject(e);});firefox.once('exit',c=>{clearTimeout(timer);reject(new Error('Firefox exited: '+c));});for(const stream of [firefox.stdout,firefox.stderr])stream.on('data',chunk=>{log+=chunk;const match=log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]+'/session');}});});
  socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  socket.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.type==='error'?p.reject(new Error(m.error+': '+m.message)):p.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  console.log('Firefox '+(await send('session.new',{capabilities:{}})).capabilities.browserVersion);await send('webExtension.install',{extensionData:{type:'path',path:extension}});
  let tab;for(let i=0;i<100&&!tab;i++){tab=(await send('browsingContext.getTree')).contexts.find(t=>t.url.includes('sharing-test=1'));if(!tab)await sleep(100);}assert.ok(tab);const context=tab.context;
  async function evaluate(expression){const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context},awaitPromise:true});if(result.type==='exception')throw new Error(result.exceptionDetails.text);return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);}
  async function wait(expression){const end=Date.now()+20000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await sleep(100);}throw new Error('Timed out: '+expression);}
  const manager="document.querySelector('#channel-groups-manager').shadowRoot",dialog="document.querySelector('#ledger-group-sharing-dialog')?.shadowRoot";
  async function click(root,text){await evaluate(`[...${root}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click();`);}
  await wait(`return [...${manager}.querySelectorAll('h3')].some(h=>h.textContent==='Podcasts');`);
  const before=await evaluate('return await browser.storage.local.get(null);');
  await click(manager,'Import groups');await wait(`return !!${dialog}?.querySelector('input[type=file]');`);
  // Firefox 155 disallows BiDi input.setFiles in extension (privileged) pages.
  // Supply the actual downloaded bytes as a File; the production input change,
  // FileReader, background validation and import handlers still run unchanged.
  await evaluate(`const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(fs.readFileSync(exportedFile,'utf8'))}],'shared-groups.json',{type:'application/json'}));const input=${dialog}.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await wait(`return !!${dialog}.querySelector('.membership');`);
  assert.deepEqual((await evaluate("return await browser.storage.local.get('channelGroups:v1');"))['channelGroups:v1'],before['channelGroups:v1']);
  assert.equal(await evaluate(`return ${dialog}.querySelector('.membership img').src;`),gif);
  await click(dialog,'Import selected groups');await wait(`return ${dialog}.querySelector('.status').textContent.includes('ready');`);await click(dialog,'Done');
  await wait(`return [...${manager}.querySelectorAll('h3')].some(h=>h.textContent==='Podcasts (2)');`);
  const after=await evaluate('return await browser.storage.local.get(null);');assert.equal(after['channelGroups:v1'].groups.length,3);assert.equal(after['channelGroups:v1'].groups.at(-1).icon.value,gif);
  for(const key of ['settings','goals:2026-09-07','day:2026-09-07','groupBrowsing:v1'])assert.deepEqual(after[key],before[key]);
  await click(manager,'Share groups');await wait(`return !!${dialog}?.querySelector('.membership');`);await click(dialog,'Download groups file');
  let returning;for(let i=0;i<100&&!returning;i++){for(const name of fs.readdirSync(downloads).filter(n=>n.endsWith('.json'))){try{returning=JSON.parse(fs.readFileSync(path.join(downloads,name),'utf8'));}catch{}}if(!returning)await sleep(100);}
  assert.equal(returning.groups[0].name,'Podcasts (2)');assert.equal(returning.groups[0].icon.value,gif);assert.equal(returning.channels.length,2);assert.equal(returning.groups[0].id,undefined);
  console.log('PASS Firefox: Chrome file imported through file-input UI, GIF preserved, collision renamed, existing profile intact, and re-shared using a real download.');
 }finally{for(const p of pending.values())clearTimeout(p.timer);socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}}
}
