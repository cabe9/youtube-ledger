const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><ytd-masthead><div id="center" style="display:flex;align-items:center;height:56px"><yt-searchbox style="display:block;width:400px;height:36px">Search</yt-searchbox></div></ytd-masthead><ytd-browse page-subtype="home"><ytd-rich-item-renderer style="display:block;width:200px;height:100px">Recommendation</ytd-rich-item-renderer></ytd-browse><div id="search">Search results remain available</div><ytd-watch-flexy><div id="related"><ytd-compact-video-renderer style="display:block;width:200px;height:100px">Related video</ytd-compact-video-renderer></div></ytd-watch-flexy></body></html>'}));
    await page.goto('https://www.youtube.com/');
    await page.evaluate(()=>{
      window.logged=[];window.storageListener=null;
      window.browser={storage:{local:{get:async()=>({paused:false})},onChanged:{addListener:fn=>window.storageListener=fn}},runtime:{sendMessage:async m=>{window.logged.push(m.event);}}};
      // Make the focus signal deterministic in a headless fixture.
      document.hasFocus=()=>true;
    });
    await page.addStyleTag({path:__dirname+'/recommendations.css'});
    await page.addScriptTag({path:__dirname+'/recommendations.js'});
    assert.equal(await page.locator('ytd-browse').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.querySelector('#youtube-ledger-control').nextElementSibling.tagName),'YT-SEARCHBOX');
    assert.equal(await page.locator('#youtube-ledger-control').evaluate(el=>getComputedStyle(el).position),'static');
    assert.equal(await page.locator('#related').isVisible(),false);
    assert.equal(await page.locator('#search').isVisible(),true);
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
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
    await page.waitForFunction(()=>document.querySelector('#youtube-ledger-control').shadowRoot.querySelector('button').title.startsWith('No visible recommendations detected'));
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='visible').length),1);
    await page.evaluate(()=>{history.pushState({},'', '/watch?v=next');document.dispatchEvent(new Event('yt-navigate-start'));document.dispatchEvent(new Event('yt-navigate-finish'));});
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    await page.evaluate(()=>window.storageListener({paused:{newValue:true}}));
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.logged.filter(e=>e.kind==='reveal').length),2);
    console.log('Recommendation checks passed: hidden default, reveal count, visible count, hide, navigation reset, external blocker, tracking pause, search preserved. Synthetic DOM in Chromium; Firefox/YouTube live validation still needed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
