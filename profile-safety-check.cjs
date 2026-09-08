// Transfer timing regressions with real extension pages, downloads and storage.
// Artificial delays affect only a disposable test profile, never the packaged code.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-profile-safety-'));let context;
  try{
    const extension=path.join(__dirname,'dist/chrome');
    context=await chromium.launchPersistentContext(path.join(temporary,'chrome'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),errors=[];
    await worker.evaluate(()=>chrome.storage.local.set({settings:Ledger.settings({theme:'classic'}),paused:true,'goals:2026-09-06':'Original notes'}));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const url=`chrome-extension://${new URL(worker.url()).host}/dashboard.html#settings`;
    await page.goto(url);
    const read=()=>page.evaluate(async()=>(await browser.runtime.sendMessage({type:'backup:export'})).data);
    async function delaySettings(){
      await page.evaluate(()=>{
        const set=browser.storage.local.set.bind(browser.storage.local);let first=true;
        browser.storage.local.set=values=>{
          if(!values.settings||!first)return set(values);
          first=false;return new Promise((resolve,reject)=>{window.releaseSetting=()=>set(values).then(resolve,reject);});
        };
      });
    }
    async function waitForDownload(trigger,filename){
      const download=page.waitForEvent('download');let premature=false;
      const listener=()=>{premature=true;};page.on('download',listener);
      await trigger();await page.waitForTimeout(150);page.off('download',listener);
      assert.equal(premature,false,'Transfer waits for the pending settings write');
      assert.equal(await page.locator('#setting-theme').isDisabled(),true,'Settings cannot change mid-transfer');
      await page.evaluate(()=>window.releaseSetting());
      const file=path.join(temporary,filename);await(await download).saveAs(file);
      return JSON.parse(fs.readFileSync(file,'utf8'));
    }
    // Theme, every checkbox, explicit Save and Restore defaults share the queue.
    for(const [name,change,key,value] of [
      ['theme',()=>page.locator('#setting-theme').selectOption('retrowave'),'theme','retrowave'],
      ['motion',()=>page.locator('#setting-animateRetrowave').uncheck(),'animateRetrowave',false],
      ['recommendations',()=>page.locator('#setting-hideRecommendations').uncheck(),'hideRecommendations',false],
      ['navigation',()=>page.locator('#setting-resetOnNavigate').uncheck(),'resetOnNavigate',false],
      ['header',()=>page.locator('#setting-showHeaderButton').uncheck(),'showHeaderButton',false],
      ['history',()=>page.locator('#setting-showPausedOnly').check(),'showPausedOnly',true],
      ['save',async()=>{await page.locator('#setting-reviewPreference').fill('Include my latest saved prompt.');await page.getByRole('button',{name:'Save instructions',exact:true}).click();},'reviewPreference','Include my latest saved prompt.'],
      ['defaults',()=>page.locator('#settings-reset').click(),'theme','dark-green']
    ]){
      await delaySettings();await change();await page.waitForFunction(()=>window.releaseSetting);
      const exported=await waitForDownload(()=>page.locator('#backup-export').click(),name+'.json');
      assert.equal(exported.data.settings[key],value,name+' included in the downloaded profile');
      await page.locator('#backup-status').filter({hasText:'Profile exported.'}).waitFor();
      assert.equal(await page.locator('#setting-theme').isDisabled(),false,'Settings unlocked after export');
      await page.reload();
    }
    // Fast changes preserve the final choice and do not commit unfinished text.
    await page.locator('#setting-reviewPreference').fill('Unfinished draft');
    await delaySettings();await page.locator('#setting-hideRecommendations').uncheck();await page.waitForFunction(()=>window.releaseSetting);
    await page.locator('#setting-hideRecommendations').check();await page.locator('#setting-resetOnNavigate').uncheck();
    await page.locator('#setting-showHeaderButton').uncheck();await page.locator('#setting-showPausedOnly').check();
    await page.evaluate(()=>window.releaseSetting());
    await page.waitForFunction(async()=>{const {settings:s}=await browser.storage.local.get('settings');return s.hideRecommendations&&!s.resetOnNavigate&&!s.showHeaderButton&&s.showPausedOnly;});
    const rapid=(await read()).settings;assert.equal(rapid.reviewPreference,'');
    assert.equal(await page.locator('#setting-reviewPreference').inputValue(),'Unfinished draft');
    await page.reload();assert.equal(await page.locator('#setting-showPausedOnly').isChecked(),true);assert.equal(await page.locator('#setting-resetOnNavigate').isChecked(),false);
    // A failed toggle restores the saved value, exposes the failure, and can retry.
    await page.evaluate(()=>{
      const set=browser.storage.local.set.bind(browser.storage.local);let fail=true;
      browser.storage.local.set=values=>{if(values.settings&&fail){fail=false;return Promise.reject(new Error('Test setting write failure'));}return set(values);};
    });
    // Use click: this forced failure intentionally returns the checkbox to checked.
    await page.locator('#setting-hideRecommendations').click();await page.locator('#settings-status').filter({hasText:'Could not save this setting.'}).waitFor();
    assert.equal(await page.locator('#setting-hideRecommendations').isChecked(),true);assert.equal((await read()).settings.hideRecommendations,true);
    await page.locator('#setting-hideRecommendations').uncheck();await page.waitForFunction(async()=>!(await browser.storage.local.get('settings')).settings.hideRecommendations);
    await page.locator('#settings-status').filter({hasText:'Settings saved.'}).waitFor();await page.reload();
    const original=await read(),current=structuredClone(original);current['goals:2026-09-06']='Current selected profile';current.settings.theme='retrowave';
    const wrapper=data=>({format:'youtube-ledger-backup',schemaVersion:1,data});
    const currentFile=path.join(temporary,'current-profile.json');fs.writeFileSync(currentFile,JSON.stringify(wrapper(current)));
    for(const name of ['slow-first','slow-cancel','slow-error']){
      const old=structuredClone(current);old['goals:2026-09-06']='Wrong older selection';
      fs.writeFileSync(path.join(temporary,name+'.json'),name==='slow-error'?'invalid JSON':JSON.stringify(wrapper(old)));
    }
    await page.evaluate(()=>{
      const text=File.prototype.text;window.readers={};window.finished=[];
      File.prototype.text=function(){
        if(!this.name.startsWith('slow-'))return text.call(this);
        return new Promise(resolve=>{window.readers[this.name]=()=>resolve(text.call(this));}).finally(()=>window.finished.push(this.name));
      };
    });
    const select=file=>page.locator('#backup-file').setInputFiles(file);
    async function startSlow(name){await select(path.join(temporary,name+'.json'));await page.waitForFunction(name=>!!window.readers[name+'.json'],name);}
    async function release(name){await page.evaluate(name=>window.readers[name+'.json'](),name);await page.waitForFunction(name=>window.finished.includes(name+'.json'),name);await page.waitForTimeout(100);}
    const selected=()=>page.locator('#backup-file-info').filter({hasText:'current-profile.json'}).waitFor();
    await startSlow('slow-first');await select(currentFile);await selected();await release('slow-first');
    assert.equal(await page.locator('#backup-file-info').innerText(),'current-profile.json','Latest selected file owns the preview');
    assert.deepEqual(await read(),original,'Preview never replaces the stored profile');
    await startSlow('slow-cancel');await select(currentFile);await selected();await page.locator('#backup-cancel').click();await release('slow-cancel');
    assert.equal(await page.locator('#backup-preview').isHidden(),true,'An old read cannot reopen a canceled preview');
    assert.equal(await page.locator('#backup-status').innerText(),'');
    await startSlow('slow-error');await select(currentFile);await selected();await release('slow-error');
    assert.match(await page.locator('#backup-status').innerText(),/Profile checked/,'Errors from old files do not replace the current status');
    // The same selection check applies after background validation has started.
    await page.evaluate(()=>{
      const send=browser.runtime.sendMessage.bind(browser.runtime);let first=true;
      browser.runtime.sendMessage=message=>{
        if(message.type!=='backup:preview'||!first)return send(message);
        first=false;return new Promise((resolve,reject)=>{window.releasePreview=()=>send(message).then(resolve,reject);});
      };
    });
    await select(currentFile);await page.waitForFunction(()=>window.releasePreview);
    const latestFile=path.join(temporary,'latest-profile.json');fs.writeFileSync(latestFile,JSON.stringify(wrapper(current)));
    await select(latestFile);await page.locator('#backup-file-info').filter({hasText:'latest-profile.json'}).waitFor();
    await page.evaluate(()=>window.releasePreview());await page.waitForTimeout(100);
    assert.equal(await page.locator('#backup-file-info').innerText(),'latest-profile.json','Late validation cannot replace the newer preview');
    // Recovery must include a Save instructions click still in flight when Import starts.
    await delaySettings();await page.locator('#setting-reviewPreference').fill('Keep this in the recovery copy.');
    await page.getByRole('button',{name:'Save instructions',exact:true}).click();await page.waitForFunction(()=>window.releaseSetting);
    const recovery=await waitForDownload(()=>page.locator('#backup-restore').click(),'recovery.json');
    assert.equal(recovery.data.settings.reviewPreference,'Keep this in the recovery copy.');
    await page.locator('#backup-status').filter({hasText:'Profile imported.'}).waitFor();
    assert.deepEqual(await read(),current,'Import uses the latest reviewed profile and pending settings cannot overwrite it afterward');
    assert.equal(await page.locator('#setting-theme').isDisabled(),false);
    assert.equal(await page.locator('#setting-theme').inputValue(),'retrowave');
    assert.deepEqual(errors,[]);
    console.log('PASS: pending settings included in exports/recovery, latest file wins during reading and validation, cancel stays canceled, stale errors ignored, filename preview and imported settings preserved.');
  }finally{await context?.close();fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
