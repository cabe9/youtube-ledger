const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><ytd-masthead><div id="center" style="display:flex;align-items:center;height:56px"><yt-searchbox style="display:block;width:400px;height:36px">Search</yt-searchbox></div></ytd-masthead><ytd-browse page-subtype="home"><ytd-rich-item-renderer style="display:block;width:200px;height:100px">Recommendation</ytd-rich-item-renderer></ytd-browse><div id="search">Search results remain available</div><ytd-watch-flexy><div id="related"><ytd-compact-video-renderer style="display:block;width:200px;height:100px">Related video</ytd-compact-video-renderer></div></ytd-watch-flexy></body></html>'}));
    await page.goto('https://www.youtube.com/');
    await page.evaluate(()=>{
      window.logged=[];window.storageListeners=new Set();window.storageListener=changes=>{for(const fn of window.storageListeners)fn(changes);};
      window.browser={storage:{local:{get:async()=>({paused:false})},onChanged:{addListener:fn=>window.storageListeners.add(fn),removeListener:fn=>window.storageListeners.delete(fn)}},runtime:{sendMessage:async m=>{window.logged.push(m.event);}}};
      // Make the focus signal deterministic in a headless fixture.
      document.hasFocus=()=>true;
    });
    await page.addStyleTag({path:__dirname+'/recommendations.css'});
    await page.addScriptTag({path:__dirname+'/core.js'});
    await page.addScriptTag({path:__dirname+'/recommendations.js'});
    // Extension reloads can leave content-script DOM behind in the current tab.
    // Also keep the previous script alive here to expose timer/listener leaks.
    await page.evaluate(()=>{const host=document.getElementById('youtube-ledger-control');for(let n=0;n<4;n++)host.after(host.cloneNode(true));});
    for(let n=0;n<5;n++)await page.addScriptTag({path:__dirname+'/recommendations.js'});
    assert.equal(await page.locator('#youtube-ledger-control').count(),1,'Repeated injection removes orphaned eyes and keeps one active control');
    assert.equal(await page.evaluate(()=>window.storageListeners.size),1,'The old settings listeners are disposed');
    assert.equal(await page.locator('ytd-browse').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.querySelector('#youtube-ledger-control').nextElementSibling.tagName),'YT-SEARCHBOX');
    assert.equal(await page.locator('#youtube-ledger-control').evaluate(el=>getComputedStyle(el).position),'static');
    assert.equal(await page.locator('#related').isVisible(),false);
    assert.equal(await page.locator('#search').isVisible(),true);
    // Some YouTube themes leave autocomplete in the search area's layout. Its growth
    // must not pull our centered flex item away from the input row.
    await page.evaluate(()=>{
      const center=document.querySelector('ytd-masthead #center');center.style.height='auto';
      const search=center.querySelector('yt-searchbox');search.style.height='auto';search.style.padding='10px 0';
      search.innerHTML='<input name="search_query" aria-label="Search YouTube" style="box-sizing:border-box;height:36px;width:100%"><div id="autocomplete" hidden style="height:500px">Search suggestions</div>';
    });
    const searchInput=page.getByRole('textbox',{name:'Search YouTube'});await searchInput.fill('glass heart lo');
    const control=page.getByRole('button',{name:'Show recommendations',exact:true});
    const inputPosition=await searchInput.boundingBox();
    for(const expanded of [true,false,true,false]){
      await page.evaluate(expanded=>document.getElementById('autocomplete').hidden=!expanded,expanded);
      await page.waitForFunction(()=>{
        const input=document.querySelector('input[name="search_query"]').getBoundingClientRect();
        const button=document.querySelector('#youtube-ledger-control').shadowRoot.querySelector('button').getBoundingClientRect();
        return Math.abs((button.y+button.height/2)-(input.y+input.height/2))<1;
      },null,{timeout:1500});
      assert.deepEqual(await searchInput.boundingBox(),inputPosition,'suggestions do not move the search input');
      assert.equal(await searchInput.inputValue(),'glass heart lo');
      assert.equal(await searchInput.evaluate(el=>document.activeElement===el),true,'alignment preserves search focus');
      const bounds=await control.boundingBox();assert.ok(bounds.x+bounds.width<=inputPosition.x,'control stays left of search');
    }
    await page.evaluate(()=>{
      document.getElementById('autocomplete').hidden=false;
      document.querySelector('input[name="search_query"]').addEventListener('blur',()=>{document.getElementById('autocomplete').hidden=true;});
    });
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    await page.getByRole('button',{name:'Hide recommendations',exact:true}).waitFor();
    assert.equal(await page.locator('#autocomplete').isVisible(),false,'closing suggestions during the click does not swallow the toggle');
    await page.waitForFunction(()=>window.logged.some(e=>e.kind==='visible'));
    assert.equal(await page.locator('ytd-browse').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='reveal').length),1);
    await page.getByRole('button',{name:'Hide recommendations',exact:true}).click();
    assert.equal(await page.locator('ytd-browse').isVisible(),false);
    // A strong global theme must not make the shadow-root button unreadable.
    await page.addStyleTag({content:'button{color:#ff00ff!important;background:transparent!important;font-size:40px!important}'});
    assert.equal(await page.getByRole('button',{name:'Show recommendations',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
    // Header replacement should reattach the same control without duplicating it.
    await page.evaluate(()=>{const c=document.querySelector('ytd-masthead #center'); const n=c.cloneNode(true); n.querySelector('#youtube-ledger-control').remove();c.replaceWith(n);});
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    assert.equal(await page.locator('#youtube-ledger-control').count(),1);
    await page.screenshot({path:__dirname+'/header-preview.png'});
    // Simulate DF YouTube (or any other blocker) keeping all suggestions hidden.
    await page.addStyleTag({content:'ytd-browse,#related{display:none!important}'});
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#youtube-ledger-control').shadowRoot.querySelector('#ledger-recommendations-status').textContent.startsWith('No visible recommendations detected'));
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='visible').length),1);
    await page.evaluate(()=>{history.pushState({},'', '/watch?v=next');document.dispatchEvent(new Event('yt-navigate-start'));document.dispatchEvent(new Event('yt-navigate-finish'));});
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    await page.evaluate(()=>window.storageListener({paused:{newValue:true}}));
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='reveal').length),2);
    await page.evaluate(()=>window.storageListener({paused:{newValue:false},settings:{newValue:{hideRecommendations:false,resetOnNavigate:false,showHeaderButton:false}}}));
    assert.equal(await page.locator('#youtube-ledger-control').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-ledger-recommendations')),'shown');
    await page.evaluate(()=>document.dispatchEvent(new Event('yt-navigate-start')));
    assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-ledger-recommendations')),'shown');
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='reveal').length),2);
    await page.evaluate(()=>window.storageListener({settings:{newValue:{}}}));
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    // A settings read from the retired instance may finish after its replacement.
    await page.evaluate(()=>{window.browser.storage.local.get=()=>new Promise(resolve=>window.resolveStaleSettings=resolve);});
    await page.addScriptTag({path:__dirname+'/recommendations.js'});
    await page.evaluate(()=>{window.browser.storage.local.get=async()=>({settings:{hideRecommendations:false,showHeaderButton:false}});});
    await page.addScriptTag({path:__dirname+'/recommendations.js'});
    await page.evaluate(async()=>{window.resolveStaleSettings({settings:{}});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    assert.equal(await page.locator('#youtube-ledger-control').count(),0,'A late settings result cannot resurrect the retired eye');
    assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-ledger-recommendations')),'shown','Old settings cannot override the active instance');
    await page.evaluate(()=>{window.browser.storage.local.get=async()=>({paused:false});});
    await page.addScriptTag({path:__dirname+'/recommendations.js'});
    assert.equal(await page.locator('#youtube-ledger-control').count(),1);
    assert.equal(await page.evaluate(()=>window.storageListeners.size),1,'An instance with its header button disabled is also retired');
    console.log('Recommendation checks passed: repeated injections and orphan cleanup leave one eye; old timers/listeners and late settings reads cannot restore controls; autocomplete alignment, query/focus, reveal/visible event counts, navigation reset, external blocker, pause and settings. Synthetic DOM in Chromium.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
