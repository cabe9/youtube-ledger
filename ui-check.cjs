const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:960}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const d=new Date(), day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const data=JSON.parse(sessionStorage.getItem('test-data') || 'null') || {['day:'+day]:[{id:'demo',title:'Example session — learning something useful',channel:'Example channel',videoId:'demo',url:'https://www.youtube.com/watch?v=demo',start:Date.now()-1800000,end:Date.now(),label:'Learning',seconds:{foreground:1200,backgroundAudio:300,backgroundSilent:0,paused:300,browsing:0,ad:0}}]};
      data['purposes:'+day]={'video:demo':'Learning'};data['recommendations:'+day]=[{kind:'reveal',at:Date.now(),page:'/'}];
      const listeners=new Set();
      window.browser={storage:{
        onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)},
        session:{get:async()=>({})},
        local:{get:async keys=>structuredClone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]))),set:async x=>{
          const changes=Object.fromEntries(Object.entries(x).map(([key,value])=>[key,{oldValue:structuredClone(data[key]),newValue:structuredClone(value)}]));
          Object.assign(data,structuredClone(x));sessionStorage.setItem('test-data',JSON.stringify(data));
          for(const listener of listeners)listener(changes,'local');
        }}
      },runtime:{sendMessage:async m=>{if(m.type==='groupLabel')data['purposes:'+m.day][m.key]=m.label;if(m.type==='channelGroups:get')return {version:1,groups:[],channels:{}};}}};
    });
    await page.goto('file://'+__dirname+'/dashboard.html');
    await page.locator('#day-summary').filter({hasText:'25m 0s playback'}).waitFor();
    await page.getByRole('link',{name:'History',exact:true}).click();
    await page.getByText('20m 0s',{exact:true}).first().waitFor();
    await page.locator('#recommendation-events li').waitFor();
    await page.locator('#rows select').selectOption('Work');
    await page.getByRole('button',{name:'Pause tracking',exact:true}).click();
    await page.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    await page.getByRole('link',{name:'Review',exact:true}).click();
    await page.getByText(/1 reveals/).waitFor();
    assert.equal(await page.locator('#review-rows select').inputValue(),'Work');
    await page.locator('#goals').fill('30 minutes of intentional learning.');
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export LLM review prompt',exact:true}).click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/^youtube-review-/);
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#setting-reviewPreference').inputValue(),'');
    await page.locator('#setting-hideRecommendations').uncheck();
    assert.equal(await page.locator('#setting-shortMinutes').count(),0);
    await page.locator('#setting-reviewPreference').fill('Focus on my learning goals.');
    await page.locator('#setting-theme').selectOption('classic');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'classic');
    await page.getByText('Theme saved.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(async()=>(await browser.storage.local.get(['settings'])).settings.theme),'classic');
    // A normal dashboard refresh cannot revert the newly selected theme.
    await page.evaluate(()=>render());
    assert.equal(await page.locator('html').getAttribute('data-theme'),'classic');
    await page.getByRole('button',{name:'Save instructions',exact:true}).click();
    await page.getByText('Instructions saved.',{exact:true}).waitFor();
    assert.equal(await page.locator('#recommendation-summary').textContent(),'1 reveals · 0 detected on screen');
    assert.equal(await page.evaluate(()=>Object.hasOwn(report().settings,'shortMinutes')),false);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'classic');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(246, 247, 242)');
    await page.screenshot({path:__dirname+'/classic-preview.png',fullPage:true});
    await page.reload();
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#setting-hideRecommendations').isChecked(),false);
    assert.equal(await page.locator('#setting-reviewPreference').inputValue(),'Focus on my learning goals.');
    assert.equal(await page.locator('#setting-theme').inputValue(),'classic');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'classic');
    await page.locator('#setting-theme').selectOption('dark-green');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-green');
    await page.getByText('Theme saved.',{exact:true}).waitFor();
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 23, 20)');
    await page.screenshot({path:__dirname+'/dark-green-preview.png',fullPage:true});
    await page.reload();
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#setting-theme').inputValue(),'dark-green');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-green');
    await page.getByRole('button',{name:'Restore defaults',exact:true}).click();
    await page.getByText('Defaults restored.',{exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark-green');
    await page.locator('#setting-theme').selectOption('retrowave');
    await page.getByText('Theme saved.',{exact:true}).waitFor();
    assert.equal(await page.locator('#setting-hideRecommendations').isChecked(),true);
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.match(await page.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated.svg/);
    const frame1=await page.locator('.masthead').screenshot();
    await page.waitForTimeout(1200);
    const frame2=await page.locator('.masthead').screenshot();
    assert.equal(frame1.equals(frame2),false);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.doesNotMatch(await page.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated.svg/);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#setting-animateRetrowave').uncheck();
    assert.doesNotMatch(await page.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated.svg/);
    await page.getByText('Animation setting saved.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Save instructions',exact:true}).click();
    await page.getByText('Instructions saved.',{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated.svg/);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:__dirname+'/dashboard-preview.png',fullPage:true});
    await page.setViewportSize({width:600,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    console.log('Dashboard checks passed: render, label, pause, goals, export, narrow layout; no JavaScript errors. Screenshot uses synthetic data.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
