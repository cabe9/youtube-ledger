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
    const page=await context.newPage();
    const samples=8000*60, wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    // A real silent media stream progresses in the extension's isolated world too.
    await page.route('https://www.youtube.com/**',route=>route.fulfill(route.request().url().endsWith('fixture.wav') ? {contentType:'audio/wav',body:wav} : {contentType:'text/html',body:`<!doctype html><title>Chrome fixture - YouTube</title><ytd-masthead><div id="center" style="display:flex"><yt-searchbox>Search</yt-searchbox></div></ytd-masthead><ytd-watch-metadata><h1>Chrome fixture</h1></ytd-watch-metadata><video autoplay src="/fixture.wav"></video><ytd-watch-flexy><div id="related"><ytd-compact-video-renderer style="display:block;width:200px;height:100px">Recommendation</ytd-compact-video-renderer></div></ytd-watch-flexy>`}));
    await page.goto('https://www.youtube.com/watch?v=chrome-fixture');
    await page.bringToFront();
    await page.getByRole('button',{name:'Show recommendations',exact:true}).waitFor();
    assert.equal(await page.locator('#related').isVisible(),false);
    await page.getByRole('button',{name:'Show recommendations',exact:true}).click();
    assert.equal(await page.locator('#related').isVisible(),true);
    const dashboard=await context.newPage();dashboard.on('pageerror',e=>console.error('DASHBOARD ERROR',e.message));dashboard.on('console',m=>{if(m.type()==='error') console.error('DASHBOARD CONSOLE',m.text());});
    await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
    await page.bringToFront();
    await until(dashboard,async()=>{
      const data=await chrome.storage.local.get(null);
      return Object.entries(data).some(([k,v])=>k.startsWith('day:') && v.some(r=>r.videoId==='chrome-fixture' && r.seconds.foreground>0)) && Object.entries(data).some(([k,v])=>k.startsWith('recommendations:') && v.some(e=>e.kind==='visible'));
    });
    await dashboard.bringToFront();
    await dashboard.reload();
    await dashboard.getByRole('combobox').waitFor();
    await dashboard.getByRole('combobox').selectOption('Learning');
    await dashboard.getByRole('button',{name:'Pause tracking',exact:true}).click();
    await dashboard.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    await until(dashboard,async()=>Object.entries(await chrome.storage.local.get(null)).some(([k,v])=>k.startsWith('purposes:') && v['video:chrome-fixture']==='Learning'));
    await dashboard.getByText('Advanced settings',{exact:true}).click();
    await dashboard.locator('#setting-hideRecommendations').uncheck();
    await dashboard.locator('#setting-shortMinutes').fill('7');
    await dashboard.getByRole('button',{name:'Save settings',exact:true}).click();
    await dashboard.getByText('Settings saved.',{exact:true}).waitFor();
    await until(dashboard,async()=>!(await chrome.storage.local.get('settings')).settings.hideRecommendations);
    await dashboard.emulateMedia({reducedMotion:'no-preference'});
    await dashboard.locator('#setting-animateRetrowave').uncheck();
    assert.doesNotMatch(await dashboard.locator('header').evaluate(el=>getComputedStyle(el).backgroundImage),/retrowave-animated/);
    await dashboard.getByText('Animation setting saved.',{exact:true}).waitFor();
    await dashboard.evaluate(()=>render());
    const still1=await dashboard.locator('header').screenshot();
    await dashboard.waitForTimeout(1200);
    const still2=await dashboard.locator('header').screenshot();
    assert.equal(still1.equals(still2),true,'animation off must produce identical header frames');
    await context.close();context=await launch();
    const restored=await context.newPage();
    await restored.goto(`chrome-extension://${id}/dashboard.html`);
    await restored.getByRole('button',{name:'Resume tracking',exact:true}).waitFor();
    assert.equal(await restored.getByRole('combobox').inputValue(),'Learning');
    const saved=await restored.evaluate(()=>chrome.storage.local.get(null));
    assert.ok(Object.keys(saved).some(k=>k.startsWith('day:')));
    assert.equal(saved.settings.animateRetrowave,false);
    assert.doesNotMatch(await restored.locator('header').evaluate(el=>getComputedStyle(el).backgroundImage),/retrowave-animated/);
    assert.equal(saved.settings.hideRecommendations,false);assert.equal(saved.settings.shortMinutes,7);
    // A dashboard message after restart must wake the service worker and respond.
    await restored.getByRole('combobox').selectOption('Work');
    await until(restored,async()=>Object.entries(await chrome.storage.local.get(null)).some(([k,v])=>k.startsWith('purposes:') && v['video:chrome-fixture']==='Work'));
    console.log('PASS: real Chrome extension loading, automatic content-script injection, playback recording, hidden/revealed recommendations, visibility event, dashboard, purpose messaging, pause, persisted data after full browser restart, and service-worker messaging after restart. YouTube page was a controlled fixture.');
  } finally {if(context) await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
