// Group management through an actual unpacked extension and controlled YouTube pages.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),V='v'.repeat(11);
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-groups-test-'));
  const extension=path.join(__dirname,'dist/chrome');let context;
  const errors=[];
  async function launch(){
    const c=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:960},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    c.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await c.route('https://www.youtube.com/**',route=>{
      const u=new URL(route.request().url());const beta=u.pathname.includes('beta') || u.pathname.includes(B);const id=beta?B:A;const name=beta?'Beta channel':'Alpha & friends';
      const watch=u.pathname==='/watch';
      const shortcuts=`window.playerShortcuts=[];for(const type of ['keydown','keypress','keyup'])window.addEventListener(type,event=>{if(!['INPUT','TEXTAREA'].includes(event.target.tagName)&&[' ','k','j','l','m','f','ArrowLeft','ArrowRight','Escape'].includes(event.key)){window.playerShortcuts.push({type,key:event.key});event.preventDefault();}},true);`;
      const body=`<!doctype html><html><head><meta property="og:title" content="${name.replace('&','&amp;')}"><link rel="canonical" href="https://www.youtube.com/channel/${id}"><title>${name} - YouTube</title></head><body><ytd-masthead><div id="center"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead>${watch?'<ytd-watch-metadata><div id="owner">Alpha channel</div><h1>Test video</h1></ytd-watch-metadata>':'<ytd-browse page-subtype="channels"><yt-page-header-renderer><h1>'+name+'</h1><yt-flexible-actions-view-model style="display:flex"><div><button-view-model><button>Subscribe</button></button-view-model></div></yt-flexible-actions-view-model></yt-page-header-renderer></ytd-browse>'}<script>${shortcuts}var unrelated={"channelId":"${B}"};var ytInitialPlayerResponse = ${JSON.stringify({videoDetails:{videoId:V,channelId:A,author:'Alpha & friends'}})};</script></body></html>`;
      return route.fulfill({contentType:'text/html',body});
    });
    return c;
  }
  try{
    context=await launch();const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
    await worker.evaluate(()=>chrome.storage.local.set({settings:{theme:'retrowave'}}));
    const youtube=await context.newPage();await youtube.goto('https://www.youtube.com/watch?v='+V);
    async function checkYouTubeColors(watch){
      const action=youtube.getByRole('button',{name:'Add to group',exact:true});await action.waitFor();
      for(const {name,ink,background,hover,legacy} of [
        {name:'light',ink:'rgb(15, 15, 15)',background:'rgba(0, 0, 0, 0.05)',hover:'rgba(0, 0, 0, 0.1)'},
        {name:'dark',ink:'rgb(241, 241, 241)',background:'rgba(255, 255, 255, 0.1)',hover:'rgba(255, 255, 255, 0.2)'},
        {name:'custom',ink:'rgb(255, 244, 253)',background:'rgba(230, 200, 255, 0.15)',hover:'rgba(230, 200, 255, 0.25)',legacy:true}
      ]){
        await youtube.evaluate(({ink,background,hover,legacy})=>{
          const style=document.documentElement.style;
          const keys=legacy?['--yt-spec-text-primary','--yt-spec-badge-chip-background','--yt-spec-button-chip-background-hover']:['--yt-sys-color-baseline--text-primary','--yt-sys-color-baseline--additive-background','--yt-sys-color-baseline--button-chip-background-hover'];
          keys.forEach((key,index)=>style.setProperty(key,[ink,background,hover][index]));document.body.style.background=legacy?'repeating-linear-gradient(0deg,#160628 0 20px,#69257b 21px 22px)':ink==='rgb(15, 15, 15)'?'#fff':'#0f0f0f';
        },{ink,background,hover,legacy});
        await youtube.mouse.move(0,0);
        assert.deepEqual(await action.evaluate(button=>{const s=getComputedStyle(button);return {color:s.color,background:s.backgroundColor,shadow:s.textShadow,height:s.height};}),{color:ink,background,shadow:'none',height:watch?'36px':'40px'},name+' YouTube colors apply independently of Ledger');
        await action.hover();assert.equal(await action.evaluate(button=>getComputedStyle(button).backgroundColor),hover);
      }
    }
    await checkYouTubeColors(true);
    await youtube.getByRole('button',{name:'Add to group',exact:true}).click();
    assert.equal(await youtube.locator('#ledger-channel-groups-control').getAttribute('data-ledger-theme'),null,'The YouTube action does not import the Ledger theme');
    assert.equal(await youtube.locator('#ledger-channel-groups-dialog').getAttribute('data-ledger-theme'),'retrowave','The picker still uses the saved Ledger theme');
    const dialog=youtube.getByRole('dialog');await dialog.getByText('Alpha & friends',{exact:true}).waitFor();
    // Real keystrokes matter here: fill() bypasses YouTube's global player shortcuts.
    const name=dialog.getByRole('textbox',{name:'New group name',exact:true});await name.click();
    await name.pressSequentially('jklmf');await name.press('ControlOrMeta+A');await name.press('Backspace');
    await name.pressSequentially('Learn');await name.press('Space');await name.pressSequentially('JP');
    await name.press('ArrowLeft');await name.press('ArrowRight');
    assert.equal(await name.inputValue(),'Learn JP','Space types a space and player letters remain editable');
    await name.press('Tab');assert.equal(await dialog.getByRole('button',{name:'Create group',exact:true}).evaluate(el=>el.getRootNode().activeElement===el),true);
    await youtube.keyboard.press('Shift+Tab');assert.equal(await name.evaluate(el=>el.getRootNode().activeElement===el),true);
    await name.press('Enter');
    await dialog.getByRole('checkbox',{name:/Learn JP/}).waitFor();assert.equal(await dialog.getByRole('checkbox',{name:/Learn JP/}).isChecked(),true);
    const membership=dialog.getByRole('checkbox',{name:/Learn JP/});await membership.press('Space');
    await youtube.waitForFunction(()=>{const input=document.getElementById('ledger-channel-groups-dialog').shadowRoot.querySelector('input[type=checkbox]');return input&&!input.checked&&!input.disabled;});
    await membership.press('Space');await youtube.waitForFunction(()=>document.getElementById('ledger-channel-groups-dialog').shadowRoot.querySelector('input[type=checkbox]')?.checked===true);
    await name.press('Escape');await dialog.waitFor({state:'detached'});
    assert.deepEqual(await youtube.evaluate(()=>window.playerShortcuts),[],'no menu keys reach page capture handlers');
    // Use real pointer input against the native dialog backdrop, including a text drag.
    await youtube.getByRole('button',{name:'Add to group',exact:true}).click();await membership.waitFor();
    const panel=await dialog.boundingBox();await youtube.mouse.click(panel.x+8,panel.y+8);assert.equal(await dialog.isVisible(),true,'Inner padding keeps the picker open');
    const field=await name.boundingBox();await youtube.mouse.move(field.x+20,field.y+15);await youtube.mouse.down();await youtube.mouse.move(10,10);await youtube.mouse.up();assert.equal(await dialog.isVisible(),true,'Dragging out of a field keeps the picker open');
    await youtube.evaluate(()=>{window.backdropClicks=0;document.body.addEventListener('click',()=>window.backdropClicks++);});
    await youtube.mouse.click(10,10);await dialog.waitFor({state:'detached'});assert.equal(await youtube.evaluate(()=>window.backdropClicks),0,'Dismissal does not click through to the page');
    await youtube.getByRole('button',{name:'Add to group',exact:true}).click();await membership.waitFor();assert.equal(await membership.isChecked(),true,'Saved membership survives outside dismissal');
    await dialog.getByRole('button',{name:'Close groups',exact:true}).click();await dialog.waitFor({state:'detached'});
    await youtube.getByRole('button',{name:'Add to group',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'detached'});

    await youtube.evaluate(()=>document.activeElement.blur());await youtube.keyboard.press('Space');
    assert.ok((await youtube.evaluate(()=>window.playerShortcuts)).some(e=>e.key===' '),'player shortcuts work after closing the menu');
    const dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${id}/dashboard.html#groups`);
    const manager=dashboard.locator('#channel-groups-manager');await manager.getByRole('link',{name:'Alpha & friends',exact:true}).waitFor();
    await manager.getByRole('textbox',{name:'New group name',exact:true}).fill('Leisure');await manager.getByRole('button',{name:'Create group',exact:true}).click();
    await manager.getByRole('heading',{name:'Leisure',exact:true}).waitFor();
    await manager.getByRole('textbox',{name:'Channel address',exact:true}).fill('@beta');await manager.getByRole('button',{name:'Add channel',exact:true}).click();
    await manager.getByRole('link',{name:'Beta channel',exact:true}).waitFor();
    await manager.getByRole('textbox',{name:'Channel address',exact:true}).fill('https://evil.test/@wrong');await manager.getByRole('button',{name:'Add channel',exact:true}).click();
    await manager.getByRole('status').filter({hasText:'HTTPS YouTube'}).waitFor();
    // A native channel page resolves its canonical identity, not a related channel ID.
    await youtube.goto('https://www.youtube.com/@alpha');await checkYouTubeColors(false);await youtube.getByRole('button',{name:'Add to group',exact:true}).click();
    await youtube.getByRole('dialog').getByRole('checkbox',{name:/Leisure/}).check();
    await youtube.getByRole('dialog').getByRole('status').filter({hasText:'Saved.'}).waitFor();
    await manager.getByRole('link',{name:'Alpha & friends',exact:true}).waitFor();
    await youtube.getByRole('dialog').getByRole('checkbox',{name:/Learn JP/}).uncheck();
    await youtube.getByRole('dialog').getByRole('status').filter({hasText:'Saved.'}).waitFor();
    // Change the real setting in another tab with the picker open. Compare with the dashboard palette
    // so the isolated YouTube colors cannot silently drift, and preserve the current form and focus.
    const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/dashboard.html#settings`);
    const draft=youtube.getByRole('dialog').getByRole('textbox',{name:'New group name',exact:true});await draft.fill('Still typing');
    const paletteKeys=['--page-bg','--ink','--quiet','--accent','--line','--panel','--button-ink','--accent-hover','--control-border','--control-hover','--field-bg','--field-border','--placeholder','--danger-ink','color-scheme'];
    const actionStyle=()=>youtube.getByRole('button',{name:'Add to group',exact:true}).evaluate(button=>{const s=getComputedStyle(button);return {color:s.color,background:s.backgroundColor,border:s.border,shadow:s.textShadow,font:s.font};});
    const initialAction=await actionStyle();
    for(const theme of ['dark-green','classic','retrowave','frutiger-aero']){
      await settings.locator('#setting-theme').selectOption(theme);
      await youtube.waitForFunction(theme=>document.getElementById('ledger-channel-groups-dialog')?.dataset.ledgerTheme===theme,theme);
      const expected=await settings.evaluate(keys=>{const s=getComputedStyle(document.documentElement);return keys.map(k=>s.getPropertyValue(k).trim());},paletteKeys);
      for(const host of ['#ledger-channel-groups-dialog']){
        const actual=await youtube.locator(host).evaluate((el,keys)=>{const s=getComputedStyle(el);return keys.map(k=>s.getPropertyValue(k).trim());},paletteKeys);
        assert.deepEqual(actual,expected,theme+' palette matches dashboard on '+host);
      }
      assert.deepEqual(await actionStyle(),initialAction,'Changing Ledger to '+theme+' does not recolor the YouTube button');
      assert.equal(await draft.inputValue(),'Still typing','theme changes keep drafts');
      assert.equal(await draft.evaluate(el=>el.getRootNode().activeElement===el),true,'theme changes keep focus');
      assert.equal(await youtube.getByRole('dialog').getByRole('checkbox',{name:/Leisure/}).isChecked(),true,'theme changes keep membership');
      await youtube.getByRole('dialog').screenshot({path:path.join(__dirname,`groups-picker-${theme}-preview.png`)});
    }
    await settings.locator('#settings-reset').click();
    await youtube.waitForFunction(()=>document.getElementById('ledger-channel-groups-dialog')?.dataset.ledgerTheme==='dark-green');
    assert.equal(await draft.inputValue(),'Still typing','restoring defaults keeps drafts');
    await settings.close();
    // A navigation closes the old channel picker and remounts exactly one control.
    await youtube.evaluate(()=>{document.dispatchEvent(new Event('yt-navigate-start'));history.pushState({},'','/feed/subscriptions');document.dispatchEvent(new Event('yt-navigate-finish'));});
    assert.equal(await youtube.getByRole('dialog').count(),0);assert.equal(await youtube.locator('#ledger-channel-groups-control').count(),0);
    await manager.getByRole('textbox',{name:'Group name',exact:true}).fill('Relax');await manager.getByRole('button',{name:'Rename',exact:true}).click();await manager.getByRole('heading',{name:'Relax',exact:true}).waitFor();
    await manager.getByRole('button',{name:'Change group icon'}).click();
    await dashboard.getByRole('dialog').getByRole('button',{name:'Podcasts',exact:true}).click();
    await dashboard.getByRole('dialog').getByRole('button',{name:'Save icon'}).click();await dashboard.getByRole('dialog').waitFor({state:'detached'});
    await manager.getByRole('link',{name:'Beta channel',exact:true}).locator('xpath=ancestor::li').getByRole('button',{name:'Remove',exact:true}).click();await manager.getByRole('link',{name:'Beta channel',exact:true}).waitFor({state:'detached'});
    // Mobile layout and all themes use the same manager and preserve drafts on normal dashboard refresh.
    for(const theme of ['dark-green','classic','retrowave','frutiger-aero']){
      await dashboard.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await dashboard.setViewportSize({width:375,height:900});
      assert.equal(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' groups fit mobile');
    }
    await dashboard.setViewportSize({width:1280,height:960});await dashboard.evaluate(()=>document.documentElement.dataset.theme='dark-green');
    await dashboard.screenshot({path:path.join(__dirname,'groups-dashboard-preview.png')});
    const saved=await worker.evaluate(()=>chrome.storage.local.get('channelGroups:v1'));
    assert.equal(saved['channelGroups:v1'].groups.find(g=>g.name==='Learn JP').channelIds.length,0);
    assert.deepEqual(saved['channelGroups:v1'].groups.find(g=>g.name==='Relax').channelIds,[A]);
    // Re-run the actual content script in its extension world, keeping the old
    // instance alive as well as orphan DOM from older versions of the extension.
    for(const url of ['https://www.youtube.com/watch?v='+V,'https://www.youtube.com/@alpha']){
      await youtube.goto(url);await youtube.getByRole('button',{name:'Add to group',exact:true}).waitFor();
      const session=await context.newCDPSession(youtube),worlds=[];
      session.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await session.send('Runtime.enable');
      const world=worlds.find(world=>world.name===id||world.origin==='chrome-extension://'+id);assert.ok(world,'Find the installed extension content-script world');
      const reinject=()=>session.send('Runtime.evaluate',{contextId:world.id,expression:fs.readFileSync(path.join(__dirname,'groups-content.js'),'utf8')});
      await youtube.evaluate(()=>{const host=document.getElementById('ledger-channel-groups-control');for(let n=0;n<4;n++)host.after(host.cloneNode(true));});
      for(let n=0;n<5;n++){const result=await reinject();assert.equal(result.exceptionDetails,undefined);}
      await youtube.waitForFunction(()=>document.querySelectorAll('#ledger-channel-groups-control').length===1);
      // Wait across the old mount interval: removed copies must not return.
      await youtube.waitForTimeout(1200);assert.equal(await youtube.locator('#ledger-channel-groups-control').count(),1);
      await youtube.getByRole('button',{name:'Add to group',exact:true}).click();await youtube.getByRole('dialog').getByText('Alpha & friends',{exact:true}).waitFor();
      await reinject();await youtube.getByRole('dialog').waitFor({state:'detached'});
      await youtube.getByRole('button',{name:'Add to group',exact:true}).click();await youtube.getByRole('dialog').getByRole('checkbox',{name:/Relax/}).waitFor();
      assert.equal(await youtube.getByRole('dialog').count(),1);assert.equal(await youtube.getByRole('dialog').getByRole('checkbox',{name:/Relax/}).isChecked(),true);
      await youtube.getByRole('button',{name:'Close groups',exact:true}).click();await session.detach();
    }
    await context.close();context=await launch();const restored=await context.newPage();await restored.goto(`chrome-extension://${id}/dashboard.html#groups`);
    await restored.locator('#channel-groups-manager').getByRole('button',{name:/Relax/}).click();
    await restored.locator('#channel-groups-manager').getByRole('link',{name:'Alpha & friends',exact:true}).waitFor();
    assert.equal(await restored.locator('#channel-groups-manager .change-icon .group-icon').getAttribute('data-icon'),'microphone','Group icon survives browser restart');
    restored.once('dialog',d=>d.accept());await restored.getByRole('button',{name:'Delete group',exact:true}).click();await restored.getByRole('heading',{name:'Learn JP',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: real extension; watch/channel buttons follow YouTube light/dark/custom colors and hover states independently of Ledger; themed pickers preserve drafts, focus and membership; backdrop/X/Done/Escape dismissal, drag protection, keyboard protection, group management, navigation/reinjection cleanup, mobile layout, and restart persistence. Controlled YouTube fixtures.');
  }finally{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1)});
