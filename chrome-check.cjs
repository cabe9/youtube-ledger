// Actual unpacked extension test, using an isolated Chrome for Testing profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
async function until(page, predicate) {
  const deadline=Date.now()+20000;
  while (Date.now()<deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Timed out waiting for saved extension data');
}

(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-chrome-test-'));
  const extension=path.join(__dirname,'dist/chrome');
  const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let context;
  try {
    context=await launch();
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    await context.route(/^https:\/\/(?:yt3.googleusercontent.com|i.ytimg.com)\//,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#558866"/></svg>'}));
    const page=await context.newPage();
    const samples=8000*60, wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    // A real silent media stream progresses in the extension's isolated world too.
    await page.route('https://www.youtube.com/**',route=>route.fulfill(route.request().url().endsWith('fixture.wav') ? {contentType:'audio/wav',body:wav} : {contentType:'text/html',body:`<!doctype html><title>Chrome fixture - YouTube</title><ytd-masthead><div id="center" style="display:flex"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead><ytd-watch-metadata><h1>Chrome fixture</h1><div id="owner"><a id="avatar" href="/channel/UCaaaaaaaaaaaaaaaaaaaaaa"><img src="https://yt3.googleusercontent.com/ledger-test=s88-c-k-c0x00ffffff-no-rj"></a><div id="channel-name"><a href="https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa">Fixture creator</a></div></div></ytd-watch-metadata><video autoplay src="/fixture.wav"></video><ytd-watch-flexy video-id="chromefix01"><div id="related"><ytd-compact-video-renderer style="display:block;width:200px;height:100px">Recommendation</ytd-compact-video-renderer></div></ytd-watch-flexy>`}));
    await page.goto('https://www.youtube.com/watch?v=chromefix01');
    await page.bringToFront();
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    assert.equal(await page.locator('#related').isVisible(),false);
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    assert.equal(await page.locator('#related').isVisible(),true);
    const dashboard=await context.newPage();dashboard.on('pageerror',e=>console.error('DASHBOARD ERROR',e.message));dashboard.on('console',m=>{if(m.type()==='error') console.error('DASHBOARD CONSOLE',m.text());});
    await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
    await until(dashboard,async()=>{const data=await chrome.storage.local.get(null);return Object.entries(data).filter(([k])=>k.startsWith('day:')).flatMap(([,v])=>v).some(r=>r.channelUrl==='https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa'&&r.channelAvatarUrl==='https://yt3.googleusercontent.com/ledger-test=s88-c-k-c0x00ffffff-no-rj');});
    await page.bringToFront();
    await until(dashboard,async()=>{
      const data=await chrome.storage.local.get(null);
      return Object.entries(data).some(([k,v])=>k.startsWith('day:') && v.some(r=>r.videoId==='chromefix01' && r.seconds.foreground>0)) && Object.entries(data).some(([k,v])=>k.startsWith('recommendations:') && v.some(e=>e.kind==='visible'));
    });
    const progress=await dashboard.evaluate(()=>chrome.storage.local.get('videoProgress:v1'));
    assert.equal(progress['videoProgress:v1'].videos.chromefix01.observed,true);assert.ok(progress['videoProgress:v1'].videos.chromefix01.segments.length>0,'Real media playback saves position coverage');
    await dashboard.bringToFront();
    await dashboard.reload();
    await dashboard.getByRole('link',{name:'History',exact:true}).click();
    await dashboard.locator('#rows select').waitFor();
    await dashboard.locator('#rows select').selectOption('Learning');
    await dashboard.getByRole('button',{name:'Pause tracking',exact:true}).click();
    await dashboard.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    await until(dashboard,async()=>Object.entries(await chrome.storage.local.get(null)).some(([k,v])=>k.startsWith('purposes:') && v['video:chromefix01']==='Learning'));
    await dashboard.getByRole('link',{name:'Settings',exact:true}).click();
    await dashboard.locator('#setting-hideRecommendations').uncheck();
    await until(dashboard,async()=>!(await chrome.storage.local.get('settings')).settings.hideRecommendations);
    await dashboard.locator('#setting-hideRecommendations').check();
    await page.locator('#related').waitFor({state:'hidden'});
    await dashboard.locator('#setting-hideRecommendations').uncheck();
    await page.locator('#related').waitFor({state:'visible'});
    await dashboard.locator('#setting-showHeaderButton').uncheck();
    await page.getByRole('button',{name:'Hide recommendations',exact:true}).waitFor({state:'detached'});
    await dashboard.locator('#setting-showHeaderButton').check();
    await page.getByRole('button',{name:'Hide recommendations',exact:true}).waitFor();
    assert.equal(await dashboard.locator('#setting-shortMinutes').count(),0);
    await dashboard.locator('#setting-reviewPreference').fill('Focus on my learning goals.');
    await dashboard.getByRole('button',{name:'Save instructions',exact:true}).click();
    await dashboard.getByText('Instructions saved.',{exact:true}).waitFor();
    await until(dashboard,async()=>!(await chrome.storage.local.get('settings')).settings.hideRecommendations);
    await dashboard.locator('#setting-theme').selectOption('retrowave');
    await dashboard.getByText('Theme saved.',{exact:true}).waitFor();
    await dashboard.emulateMedia({reducedMotion:'no-preference'});
    await dashboard.locator('#setting-animateRetrowave').uncheck();
    assert.doesNotMatch(await dashboard.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated/);
    await dashboard.getByText('Animation setting saved.',{exact:true}).waitFor();
    await dashboard.evaluate(()=>render());
    // Scrolling the header into view can put a control under the pointer and
    // start its hover transition. Settle that before comparing static artwork.
    await dashboard.mouse.move(0,0);
    await dashboard.locator('.masthead').scrollIntoViewIfNeeded();
    await dashboard.locator('.masthead').evaluate(async header=>{
      await Promise.all(header.getAnimations({subtree:true}).filter(animation=>animation instanceof CSSTransition).map(animation=>animation.finished.catch(()=>{})));
    });
    const still1=await dashboard.locator('.masthead').screenshot();
    await dashboard.waitForTimeout(1200);
    const still2=await dashboard.locator('.masthead').screenshot();
    assert.equal(still1.equals(still2),true,'animation off must produce identical header frames');
    await context.close();context=await launch();
    const restored=await context.newPage();
    await restored.goto(`chrome-extension://${id}/dashboard.html`);
    await restored.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    await restored.getByRole('link',{name:'History',exact:true}).click();
    assert.equal(await restored.locator('#rows select').inputValue(),'Learning');
    const saved=await restored.evaluate(()=>chrome.storage.local.get(null));
    assert.ok(Object.keys(saved).some(k=>k.startsWith('day:')));
    assert.equal(saved.settings.animateRetrowave,false);
    assert.doesNotMatch(await restored.locator('.masthead').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/retrowave-animated/);
    assert.equal(saved.settings.hideRecommendations,false);assert.equal(saved.settings.reviewPreference,'Focus on my learning goals.');assert.equal(Object.hasOwn(saved.settings,'shortMinutes'),false);
    // A dashboard message after restart must wake the service worker and respond.
    await restored.locator('#rows select').selectOption('Work');
    await until(restored,async()=>Object.entries(await chrome.storage.local.get(null)).some(([k,v])=>k.startsWith('purposes:') && v['video:chromefix01']==='Work'));
    console.log('PASS: real Chrome extension loading, automatic content-script injection, playback recording, hidden/revealed recommendations, visibility event, dashboard, purpose messaging, pause, persisted data after full browser restart, and service-worker messaging after restart. YouTube page was a controlled fixture.');
  } finally {if(context) await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
