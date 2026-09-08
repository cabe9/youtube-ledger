// Actual Firefox <-> Chrome profile transfers, using disposable profiles and synthetic data.
// Run after build.py. FIREFOX_BIN may select another Firefox 140+ executable.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{chromium}=require('playwright');
const {animatedGif}=require('./icon-fixtures.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,description){
  const end=Date.now()+20000;
  while(Date.now()<end){const value=await read();if(value)return value;await sleep(100);}
  throw new Error('Timed out: '+description);
}
(async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-profile-transfer-'));
  const profile=path.join(temporary,'firefox'),downloads=path.join(temporary,'downloads'),extension=path.join(temporary,'extension');
  fs.mkdirSync(profile);fs.mkdirSync(downloads);
  fs.cpSync(path.join(__dirname,'dist/firefox'),extension,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
  manifest.background.scripts.push('test-seed.js');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const gifURL='data:image/gif;base64,'+animatedGif().toString('base64');
  fs.writeFileSync(path.join(extension,'test-seed.js'),`(async()=>{
    const now=Date.now(),day=Ledger.dayKey(now),A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),V='a'.repeat(11),W='b'.repeat(11),rows=[];
    const previous='11111111-1111-4111-8111-111111111111',visit='22222222-2222-4222-8222-222222222222';
    Ledger.add(rows,{id:previous,videoId:V,title:'A recommended episode',channel:'Alpha',channelUrl:'https://www.youtube.com/channel/'+A,channelAvatarUrl:'https://yt3.googleusercontent.com/ledger-test=s88-c-k-c0x00ffffff-no-rj',url:'https://www.youtube.com/watch?v='+V,start:now-10000,end:now-7000,state:'foreground',source:{kind:'recommendations',evidence:'link-click'}});
    Ledger.add(rows,{id:visit,videoId:W,title:'ポッドキャスト episode',channel:'Beta',url:'https://www.youtube.com/watch?v='+W,start:now-5000,end:now,state:'backgroundAudio',source:{kind:'group',groupId:'podcasts',groupName:'Podcasts',evidence:'group-link'},journey:{previousVisitId:previous,previousVideoId:V,transition:'click'}});
    rows[1].label='Learning';rows[1]._receipts={[visit]:3};
    await browser.storage.local.set({
      settings:Ledger.settings({theme:'retrowave',reviewPreference:'Review group browsing and recommendations separately.'}),paused:true,
      ['day:'+day]:rows,['goals:'+day]:'Listen with intention. 日本語も保存。',
      ['purposes:'+day]:{['video:'+W]:'Learning'},['recommendations:'+day]:[{id:previous,kind:'reveal',at:now-11000,page:'https://www.youtube.com/'}],
      'channelGroups:v1':{version:1,collapsed:true,groups:[
        {id:'podcasts',name:'Podcasts',channelIds:[A,B],icon:{kind:'image',value:${JSON.stringify(gifURL)}},sort:'oldest',watchFilter:'unwatched',hideShorts:true,createdAt:now-86400000,updatedAt:now},
        {id:'music',name:'Music',channelIds:[B],icon:{kind:'emoji',value:'🎵'},createdAt:now-86400000,updatedAt:now}
      ],channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A,avatarCheckedAt:now},[B]:{id:B,name:'Beta',url:'https://www.youtube.com/channel/'+B,avatarUrl:'https://yt3.ggpht.com/ledger-test=s88-c-k-c0x00ffffff-no-rj',avatarCheckedAt:now}}},
      'channelUploads:v1':{version:1,channels:{[B]:{fetchedAt:now,attemptedAt:now,error:'',entries:[{videoId:W,channelId:B,channel:'Beta',title:'ポッドキャスト episode',publishedAt:now-3600000,details:{status:'available',duration:3661,checkedAt:now,shorts:false}}]}}},
      'videoProgress:v1':{version:1,videos:{[V]:{observed:true,segments:[[0,30]],manual:'watched',duration:60,position:30,lastWatchedAt:now},[W]:{observed:true,segments:[[10,15]],duration:100,position:15,lastWatchedAt:now}}},
      'groupBrowsing:v1':{version:1,groups:{podcasts:{hidden:[V],lastVisitedAt:now-60000}}},
      'ledgerUndo:v1':{test:'Transient data must not migrate'}
    });
    await browser.tabs.create({url:browser.runtime.getURL('dashboard.html?profile-transfer-test=1#settings')});
  })();`);
  fs.writeFileSync(path.join(profile,'user.js'),Object.entries({
    'browser.shell.checkDefaultBrowser':false,'browser.startup.homepage_override.mstone':'ignore',
    'browser.aboutwelcome.enabled':false,'datareporting.policy.dataSubmissionEnabled':false,
    'browser.download.folderList':2,'browser.download.dir':downloads,'browser.download.useDownloadDir':true,
    'browser.helperApps.neverAsk.saveToDisk':'application/json'
  }).map(([key,value])=>`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  const executable=process.env.FIREFOX_BIN||(process.platform==='darwin'?'/Applications/Firefox.app/Contents/MacOS/firefox':'firefox');
  const firefox=spawn(executable,['--headless','--no-remote','--profile',profile,'--remote-debugging-port=0'],{stdio:['ignore','pipe','pipe']});
  let socket,chrome,sequence=0,log='';const pending=new Map();
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
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},30000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });
    const session=await send('session.new',{capabilities:{}});console.log('Firefox '+session.capabilities.browserVersion);
    await send('webExtension.install',{extensionData:{type:'path',path:extension}});
    const tab=await until(async()=>(await send('browsingContext.getTree',{})).contexts.find(c=>c.url.includes('profile-transfer-test=1')),'Firefox Ledger dashboard');
    async function evaluate(expression){
      const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (async()=>{${expression}})()))()`,target:{context:tab.context},awaitPromise:true});
      if(result.type==='exception')throw new Error(result.exceptionDetails.text);
      return result.result.type==='undefined'?undefined:JSON.parse(result.result.value);
    }
    await until(()=>evaluate("return document.querySelector('#setting-theme')?.value==='retrowave'&&!!document.querySelector('#backup-export');"),'Firefox Settings');
    await evaluate("document.querySelector('[data-open-view=history]').click();");
    await until(()=>evaluate("return document.querySelectorAll('#rows .ledger-video-thumbnail img').length===2 && document.querySelectorAll('#rows .ledger-avatar img').length===2;"),'Firefox video and channel images');
    await evaluate("window.historyImages=[...document.querySelectorAll('#rows img')];await render();return true;");
    assert.equal(await evaluate("return window.historyImages.every(image=>image.isConnected)&&window.historyImages.length===document.querySelectorAll('#rows img').length;"),true,'Firefox refresh keeps image nodes');
    await evaluate("document.querySelector('[data-open-view=settings]').click();");
    // Firefox checkboxes persist in both directions without the Save button.
    for(const key of ['animateRetrowave','hideRecommendations','resetOnNavigate','showHeaderButton','showPausedOnly']){
      const initial=await evaluate(`return document.querySelector('#setting-${key}').checked;`);
      for(const checked of [!initial,initial]){
        await evaluate(`document.querySelector('#setting-${key}').click();`);
        await until(()=>evaluate(`return (await browser.storage.local.get('settings')).settings.${key}===${checked};`),'Firefox checkbox '+key+' = '+checked);
      }
    }
    const before=await evaluate("return (await browser.runtime.sendMessage({type:'backup:export'})).data;");
    await evaluate("document.querySelector('#backup-export').click();");
    const file=await until(()=>{
      const name=fs.readdirSync(downloads).find(n=>n.endsWith('.json'));
      if(!name)return;const candidate=path.join(downloads,name);
      try{const value=JSON.parse(fs.readFileSync(candidate,'utf8'));return value.format==='youtube-ledger-backup'?candidate:undefined;}catch{return;}
    },'Firefox profile download');
    const exported=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.deepEqual(exported.data,before,'Firefox UI exports the complete portable profile');
    assert.equal(exported.data['ledgerUndo:v1'],undefined,'Transient undo state stays in Firefox');
    assert.equal(exported.data['channelGroups:v1'].groups[0].icon.value,gifURL,'Original GIF bytes exported');
    // Older profile files remain importable after removing the unused threshold.
    const legacy=structuredClone(exported);legacy.extensionVersion='0.13.6';legacy.data.settings.shortMinutes=8;
    const importFile=path.join(temporary,'legacy-profile.json');fs.writeFileSync(importFile,JSON.stringify(legacy));

    const chromeExtension=path.join(__dirname,'dist/chrome'),errors=[];
    chrome=await chromium.launchPersistentContext(path.join(temporary,'chrome'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${chromeExtension}`,`--load-extension=${chromeExtension}`]});
    const worker=chrome.serviceWorkers()[0]||await chrome.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    await worker.evaluate(()=>chrome.storage.local.set({settings:Ledger.settings({theme:'classic'}),'goals:2001-01-01':'Original Chrome notes','day:2001-01-01':[],paused:false}));
    const dashboard=await chrome.newPage();dashboard.on('pageerror',error=>errors.push(error.message));
    await dashboard.goto(`chrome-extension://${id}/dashboard.html#settings`);
    const portable=()=>dashboard.evaluate(async()=>(await chrome.runtime.sendMessage({type:'backup:export'})).data);
    const originalChrome=await portable();
    // Import uses the actual picker, including the user-facing preview and confirmation.
    const picker=dashboard.waitForEvent('filechooser');await dashboard.getByRole('button',{name:'Import profile',exact:true}).click();await(await picker).setFiles(importFile);
    await dashboard.locator('#backup-summary').filter({hasText:'2 groups · 2 channels · 1 history day · 2 sessions'}).waitFor();
    assert.deepEqual(await portable(),originalChrome,'Preview leaves Chrome data intact');
    const recoveryDownload=dashboard.waitForEvent('download');
    await dashboard.getByRole('button',{name:'Replace with this profile',exact:true}).click();
    const recoveryFile=path.join(temporary,'chrome-before-import.json');await(await recoveryDownload).saveAs(recoveryFile);
    await dashboard.locator('#backup-status').filter({hasText:'Profile imported.'}).waitFor();
    assert.deepEqual(JSON.parse(fs.readFileSync(recoveryFile,'utf8')).data,originalChrome,'Recovery file preserves the original Chrome profile');
    assert.deepEqual(await portable(),exported.data,'Every portable field survives Firefox -> Chrome');
    assert.equal(await dashboard.locator('#setting-theme').inputValue(),'retrowave');
    assert.equal(await dashboard.locator('#setting-reviewPreference').inputValue(),before.settings.reviewPreference);
    await dashboard.reload();assert.deepEqual(await portable(),exported.data,'Imported profile survives reload');
    assert.deepEqual(await evaluate("return (await browser.runtime.sendMessage({type:'backup:export'})).data;"),before,'Transfer leaves Firefox profile intact');
    // Portrait freshness in the fixture keeps this transfer test independent of external channel lookups.
    // Read the imported icon through the group UI, not just through storage.
    await dashboard.getByRole('link',{name:'Groups',exact:true}).click();
    const icon=dashboard.locator('#channel-groups-manager img').first();await icon.waitFor();
    await icon.evaluate(image=>image.decode());assert.equal(await icon.getAttribute('src'),gifURL);
    assert.equal(await icon.evaluate(image=>image.naturalWidth),32,'Chrome decodes the imported GIF');
    // Return a changed Chrome profile to Firefox through the actual import controls.
    await worker.evaluate(()=>chrome.storage.local.set({settings:Ledger.settings({theme:'classic',reviewPreference:'Saved in Chrome, returning to Firefox.'})}));
    await dashboard.reload();await dashboard.getByRole('link',{name:'Settings',exact:true}).click();
    const returningDownload=dashboard.waitForEvent('download');await dashboard.getByRole('button',{name:'Export profile',exact:true}).click();
    const returningFile=path.join(temporary,'chrome-profile.json');await(await returningDownload).saveAs(returningFile);
    const returning=JSON.parse(fs.readFileSync(returningFile,'utf8'));
    assert.equal(returning.data.settings.theme,'classic');
    const oldFile=path.join(temporary,'slow-old-profile.json');fs.copyFileSync(file,oldFile);
    await evaluate(`
      const text=File.prototype.text;
      File.prototype.text=function(){
        if(this.name==='slow-old-profile.json')return new Promise(resolve=>{window.releaseOldProfile=()=>resolve(text.call(this));});
        return text.call(this);
      };
    `);
    async function pickFirefox(filePath){
      const input=await send('script.evaluate',{expression:"document.querySelector('#backup-file')",target:{context:tab.context},awaitPromise:false});
      await send('input.setFiles',{context:tab.context,element:{sharedId:input.result.sharedId},files:[filePath]});
    }
    await pickFirefox(oldFile);await until(()=>evaluate('return !!window.releaseOldProfile;'),'Firefox delayed file read');
    await pickFirefox(returningFile);
    await until(()=>evaluate("return !document.querySelector('#backup-preview').hidden&&document.querySelector('#backup-file-info').textContent==='chrome-profile.json';"),'Firefox profile preview');
    await evaluate('window.releaseOldProfile();');await sleep(200);
    assert.equal(await evaluate("return document.querySelector('#backup-file-info').textContent;"),'chrome-profile.json','Firefox keeps the latest selection after an older file finishes');
    await evaluate("document.querySelector('#backup-restore').click();");
    await until(()=>evaluate("return document.querySelector('#backup-status').textContent.startsWith('Profile imported.');"),'Firefox import');
    assert.deepEqual(await evaluate("return (await browser.runtime.sendMessage({type:'backup:export'})).data;"),returning.data,'Chrome profile fully restores in Firefox');
    assert.equal(await evaluate("return document.querySelector('#setting-theme').value;"),'classic');
    const firefoxRecovery=await until(()=>{
      const name=fs.readdirSync(downloads).find(n=>n.startsWith('youtube-ledger-before-restore-')&&n.endsWith('.json'));
      if(!name)return;try{return JSON.parse(fs.readFileSync(path.join(downloads,name),'utf8'));}catch{return;}
    },'Firefox recovery download');
    assert.deepEqual(firefoxRecovery.data,before,'Firefox recovery copy contains its previous profile');
    // BiDi refuses privileged moz-extension reload commands; let this extension
    // page reload itself and wait for its new Settings document to initialize.
    await evaluate('window.profileReloadPending=true;setTimeout(()=>location.reload(),100);');
    await until(async()=>{
      try{return await evaluate("return !window.profileReloadPending&&document.readyState==='complete'&&document.querySelector('#setting-theme')?.value==='classic';");}
      catch{return false;}
    },'Firefox dashboard reload');
    assert.deepEqual(await evaluate("return (await browser.runtime.sendMessage({type:'backup:export'})).data;"),returning.data,'Firefox import survives reload');
    assert.deepEqual(await portable(),returning.data,'Return transfer leaves Chrome unchanged');
    assert.deepEqual(errors,[]);
    console.log('PASS: Firefox -> Chrome -> Firefox profile transfers; all portable data, GIF bytes, preview, recovery downloads, preferences, reload persistence, unchanged source profiles and latest-file selection in Firefox.');
  }finally{
    await chrome?.close();for(const item of pending.values())clearTimeout(item.timer);
    socket?.close();if(firefox.exitCode===null){const exited=once(firefox,'exit');firefox.kill();await exited;}
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
