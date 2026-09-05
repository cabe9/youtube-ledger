const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const data={settings:{theme:'dark-green'}};
   const d=new Date();d.setHours(12,0,0,0);
   for(let i=0;i<60;i++){
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    data['day:'+key]=[{id:'example-'+i,videoId:'example',title:'Example video',channel:'Example channel',url:'https://www.youtube.com/watch?v=example',start:d.getTime(),end:d.getTime()+100000,label:'Learning',seconds:{foreground:(i%7+1)*600,backgroundAudio:300,backgroundSilent:60,browsing:0,paused:0,ad:0}}];
    data['recommendations:'+key]=Array.from({length:i%4},()=>({kind:'reveal',at:d.getTime(),page:'/'}));
    d.setDate(d.getDate()-1);
   }
   window.browser={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async value=>Object.assign(data,value)}},runtime:{sendMessage:async()=>{}}};
  });
  await page.goto('file://'+__dirname+'/dashboard.html');
  await page.locator('.trend-day').first().waitFor();
  assert.equal(await page.locator('.trend-day').count(),7);
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.trend-day').length===30);
  await page.getByRole('button',{name:'Reveals',exact:true}).click();
  assert.equal(await page.locator('#trend-chart .bar-reveals').count(),30);
  await page.getByRole('button',{name:'Playback',exact:true}).click();
  const downloadReady=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export period as JSON',exact:true}).click();
  const downloaded=await downloadReady;
  const report=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
  assert.equal(report.dayCount,30);assert.equal(report.days.length,30);assert.equal(report.previousDays.length,30);
  const first=report.days[0].day;
  await page.locator('.trend-day').first().focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#date').inputValue(),first);
  await page.getByRole('button',{name:'Previous period',exact:true}).click();
  const prior=report.previousDays.at(-1).day;
  assert.equal(await page.locator('#trend-end').inputValue(),prior);
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await page.locator('.trends').screenshot({path:__dirname+'/trends-preview.png'});
  await page.setViewportSize({width:600,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Trends checks passed: week/month, metrics, export values, keyboard day navigation, period navigation, and narrow layout. Synthetic viewing history.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
