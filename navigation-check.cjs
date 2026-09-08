const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:960}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.documentToken=Math.random();
      const data={settings:{theme:'dark-green'}};
      const day=new Date(); day.setHours(12,0,0,0);
      for(let i=0;i<2;i++) {
        const key=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
        data['day:'+key]=[{id:'session-'+i,videoId:'video-'+i,title:'Video '+i,url:'https://www.youtube.com/watch?v='+i,start:+day,end:+day+60000,label:'Unsorted',seconds:{foreground:60*(i+1),backgroundAudio:0,backgroundSilent:0,paused:0,browsing:0,ad:0}}];
        data['goals:'+key]='Notes '+i;
        data['recommendations:'+key]=[{kind:'reveal',at:+day,page:'/'}];
        day.setDate(day.getDate()-1);
      }
      window.browser={storage:{onChanged:{addListener(){}},session:{get:async()=>({})},local:{get:async keys=>{
        if(window.delayReads) await new Promise(resolve=>setTimeout(resolve,150));
        return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));
      },set:async value=>Object.assign(data,value)}},runtime:{sendMessage:async message=>{
        if(message.type==='groupLabel') (data['purposes:'+message.day] ||= {})[message.key]=message.label;
        if(message.type==='clear') for(const prefix of ['day:','purposes:','recommendations:']) delete data[prefix+message.day];
      }}};
    });
    await page.goto('file://'+__dirname+'/dashboard.html');
    const documentToken=await page.evaluate(()=>window.documentToken);
    const today=await page.locator('#date').inputValue();
    const nav=view=>page.getByRole('navigation').getByRole('link',{name:view,exact:true});
    async function expectView(view) {
      assert.deepEqual(await page.locator('[data-view]:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.view)),[view.toLowerCase()]);
      assert.equal(await nav(view).getAttribute('aria-current'),'page');
      assert.equal(await page.evaluate(()=>window.documentToken),documentToken,'view changes must not reload the document');
    }
    await page.locator('.trend-day').first().waitFor();
    await expectView('Overview');
    assert.equal(await page.locator('#date').isVisible(),false);
    assert.equal(await page.locator('#goals').isVisible(),false);
    assert.equal(await page.locator('#clear').isVisible(),false);
    await page.getByRole('button',{name:'Month',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.trend-day').length===30);
    await page.getByRole('button',{name:'Browsing',exact:true}).click();
    const yesterday=await page.locator('.trend-day').nth(28).getAttribute('data-day');
    await page.locator('.trend-day').nth(28).click();
    await expectView('History');
    assert.equal(await page.locator('#date').inputValue(),yesterday);
    assert.equal(await page.locator('#daily-heading').evaluate(el=>el===document.activeElement),true);
    await page.locator('#rows').filter({hasText:'Video 1'}).waitFor();
    assert.equal(await page.locator('#recommendation-events').isVisible(),true);
    await nav('Review').click(); await expectView('Review');
    assert.equal(await page.locator('#goals').inputValue(),'Notes 1');
    assert.equal(await page.locator('#recommendation-events').isVisible(),false);
    await page.locator('#goals').fill('Intentional learning');
    await page.locator('#review-rows select').selectOption('Learning');
    await nav('History').click();
    assert.equal(await page.locator('#rows select').inputValue(),'Learning');
    await nav('Settings').click(); await expectView('Settings');
    await page.locator('#setting-reviewPreference').fill('Unsaved settings draft');
    await nav('Overview').click(); await expectView('Overview');
    assert.equal(await page.locator('.trend-day').count(),30);
    assert.equal(await page.getByRole('button',{name:'Browsing',exact:true}).getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#day-summary').textContent(),/2m 0s playback/);
    await page.goBack(); await expectView('Settings');
    assert.equal(await page.locator('#setting-reviewPreference').inputValue(),'Unsaved settings draft');
    await page.goForward(); await expectView('Overview');
    await nav('Review').click();
    assert.equal(await page.locator('#goals').inputValue(),'Intentional learning');
    const downloading=page.waitForEvent('download');
    await page.locator('#export').click();
    const downloaded=await downloading;
    const report=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
    assert.equal(report.day,yesterday); assert.equal(report.notes,'Intentional learning');
    assert.equal(report.dailyVideos[0].label,'Learning'); assert.equal(report.rawSessions[0].id,'session-1');
    assert.equal(report.recommendationEvents.length,1);
    await nav('History').click();
    await page.locator('#date').fill(today); await page.locator('#date').dispatchEvent('change');
    await page.locator('#rows').filter({hasText:'Video 0'}).waitFor();
    await nav('Review').click();
    assert.equal(await page.locator('#goals').inputValue(),'Notes 0');
    // A slow previous date read must not overwrite the latest selection.
    await page.evaluate(()=>{window.delayReads=true;openDashboardView('review','2000-01-01');});
    assert.equal(await page.locator('#export').isDisabled(),true);
    await page.evaluate(day=>openDashboardView('review',day),today);
    await page.waitForFunction(()=>!document.getElementById('export').disabled);
    assert.equal(await page.locator('#goals').inputValue(),'Notes 0');
    await page.evaluate(()=>{window.delayReads=false;});
    // Empty day, deletion, and navigation still use the same storage keys.
    await nav('History').click();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#clear').click();
    await page.locator('#empty').waitFor();
    await page.locator('#recommendation-empty').waitFor();
    await nav('Review').click(); await page.locator('#review-empty').waitFor();
    assert.equal(await page.locator('#goals').inputValue(),'Notes 0','deleting activity preserves notes');
    await page.evaluate(day=>openDashboardView('review',day),yesterday);
    await page.waitForFunction(()=>document.getElementById('goals').value==='Intentional learning');
    for (const theme of ['dark-green','classic','retrowave']) {
      await nav('Settings').click(); await page.locator('#setting-theme').selectOption(theme);
      await page.setViewportSize({width:375,height:900});
      for (const view of ['Overview','History','Review','Settings']) {
        await nav(view).click(); await expectView(view);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' '+view+' fits mobile');
      }
    }
    await page.setViewportSize({width:1280,height:960});
    await nav('Settings').click(); await page.locator('#setting-theme').selectOption('dark-green');
    for (const view of ['Overview','History','Review','Settings']) {
      await nav(view).click();
      await page.screenshot({path:__dirname+'/navigation-'+view.toLowerCase()+'-preview.png',fullPage:true});
    }
    assert.deepEqual(errors,[]);
    // Reloading a copied view URL restores its date (fixture data reloads here).
    await page.goto('file://'+__dirname+'/dashboard.html#review?date='+yesterday);
    await page.reload();
    await page.locator('#review-rows select').waitFor();
    assert.equal(await page.locator('#date').inputValue(),yesterday);
    assert.equal(await page.locator('#goals').inputValue(),'Notes 1');
    console.log('Navigation checks passed: isolated views, no reloads, date routing, Back/Forward, preserved drafts and period controls, synchronized labels, exports, empty/deleted days, async date changes, and all themes on mobile.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
