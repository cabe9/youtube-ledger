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
    const sources=[{kind:'recommendations'},{kind:'channel'},{kind:'group',groupId:'learning',groupName:'Learn JP'},{kind:'group',groupId:'music',groupName:'Study Music'},{kind:'subscriptions'},{kind:'search'},{kind:'watchLater'},{kind:'autoplay'},{kind:'unknown'}];
    data['day:'+key]=sources.map((source,n)=>({id:'example-'+i+'-'+n,videoId:n===2?'g'.repeat(11):'v'+String(i).padStart(8,'0')+String(n).padStart(2,'0'),title:'Source episode '+n,channel:'Example channel',url:'https://www.youtube.com/watch?v=example',start:d.getTime()+n*1000,end:d.getTime()+100000,label:'Learning',source,seconds:{foreground:[420,240,180,90,60,30,4,1,120][n]*(i%7+1),backgroundAudio:0,backgroundSilent:0,browsing:0,paused:0,ad:0}}));
    data['recommendations:'+key]=Array.from({length:i%4},()=>({kind:'reveal',at:d.getTime(),page:'/'}));
    d.setDate(d.getDate()-1);
   }
   window.ledgerTestData=data;
   window.browser={storage:{onChanged:{addListener(){}},session:{get:async()=>({})},local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async value=>Object.assign(data,value)}},runtime:{sendMessage:async message=>{if(message.type==='groupLabel')(data['purposes:'+message.day]||={})[message.key]=message.label;}}};
  });
  await page.goto('file://'+__dirname+'/dashboard.html');
  await page.locator('.trend-day').first().waitFor();
  assert.equal(await page.locator('.trend-day').count(),7);
  const playbackHeights=await page.locator('.trend-stack').evaluateAll(nodes=>nodes.map(n=>n.style.height));
  await page.getByRole('button',{name:'Sources',exact:true}).click();
  assert.deepEqual(await page.locator('.trend-stack').evaluateAll(nodes=>nodes.map(n=>n.style.height)),playbackHeights,'Sources use the same playback totals and scale');
  assert.equal(await page.locator('.source-summary-row').count(),8,'Groups begin combined');
  assert.match(await page.locator('.source-summary-row[data-source="watchLater"]').innerText(),/<1%/);
  assert.equal(await page.locator('.source-summary-row[data-source="groups"]').count(),1);
  assert.equal(await page.locator('.source-segment[data-source="unknown"]').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(133, 131, 140)','Uncaptured sources are neutral gray');
  assert.equal(await page.evaluate(()=>trendData.days.every(d=>Math.abs(d.playback-d.sources.reduce((n,s)=>n+s.seconds,0))<.0001)),true);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.source-day')].every(day=>Math.abs([...day.querySelectorAll('.source-segment')].reduce((n,b)=>n+Number(b.dataset.seconds),0)-trendData.days.find(d=>d.day===day.dataset.day).playback)<.0001)),true);
  // Totals open the full selected period; cells and keyboard links both work.
  await page.locator('.source-summary-row[data-source="recommendations"] td').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===7);
  assert.equal(await page.locator('#source-filter').inputValue(),'recommendations');assert.match(page.url(),/period=7/);
  assert.equal(await page.locator('#cards').isVisible(),false);assert.equal(await page.locator('#clear').isVisible(),false);
  assert.equal(await page.locator('#history-period-controls').isVisible(),true);
  await page.locator('#daily-history').screenshot({path:'/tmp/ledger-period-history.png'});
  await page.setViewportSize({width:375,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#daily-history').screenshot({path:'/tmp/ledger-period-history-mobile.png'});await page.setViewportSize({width:1280,height:1000});
  assert.equal(await page.locator('#rows tr').evaluateAll(nodes=>new Set(nodes.map(n=>n.dataset.day)).size),7);
  assert.equal(await page.locator('#rows tr').evaluateAll(nodes=>nodes.every(n=>n.children[1].textContent.includes(new Date(n.dataset.day+'T12:00:00').getFullYear()))),true);
  await page.locator('#source-filter').selectOption('groups');await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===14);
  const repeated=page.locator('#rows select[data-key="video:ggggggggggg"]');assert.equal(await repeated.count(),7);
  const labelDay=await repeated.last().getAttribute('data-day');await repeated.last().selectOption('Leisure');
  assert.equal(await repeated.last().inputValue(),'Leisure');assert.equal(await repeated.first().inputValue(),'Learning','The same video on other dates retains its label');
  assert.equal(await page.evaluate(day=>ledgerTestData['purposes:'+day]['video:ggggggggggg'],labelDay),'Leisure');
  assert.equal(await page.evaluate(()=>report().rawSessions.length),9,'Daily review exports keep the selected day');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===14);assert.match(page.url(),/period=7/);assert.equal(await page.locator('#source-filter').inputValue(),'groups');
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Sources',exact:true}).click();
  await page.locator('.source-summary-row[data-source="unknown"] a').focus();await page.evaluate(()=>renderTrends());assert.equal(await page.evaluate(()=>document.activeElement.closest('tr')?.dataset.source),'unknown','Summary refresh preserves focus');
  await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===7);assert.equal(await page.locator('#source-filter').inputValue(),'unknown');
  await page.goBack();await page.getByRole('checkbox',{name:'Break down groups'}).check();await page.locator('.source-summary-row[data-source="group:learning"] a').click();await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===7);assert.equal(await page.locator('#source-filter').inputValue(),'group:learning');
  await page.getByRole('button',{name:'View one day',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===1);assert.equal(await page.locator('#date').isVisible(),true);assert.doesNotMatch(page.url(),/period=/);
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('checkbox',{name:'Break down groups'}).uncheck();
  const sourceDay=await page.locator('.source-segment[data-source="groups"]').first().getAttribute('data-day');
  await page.locator('.source-segment[data-source="groups"]').first().click();await page.locator('#rows .source-badges').first().waitFor();
  assert.equal(await page.locator('#date').inputValue(),sourceDay);assert.equal(await page.locator('#source-filter').inputValue(),'groups');
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===2);assert.doesNotMatch(await page.locator('#rows').innerText(),/Recommendations/);assert.match(page.url(),/source=groups/);
  await page.goBack();await page.getByRole('button',{name:'Sources',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sources',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('checkbox',{name:'Break down groups'}).check();assert.equal(await page.locator('.source-summary-row').count(),9);
  await page.locator('.source-segment[data-source="group:learning"]').first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===1);assert.equal(await page.locator('#source-filter').inputValue(),'group:learning');assert.match(await page.locator('#rows').innerText(),/Group: Learn JP/);
  await page.reload();await page.locator('#rows .source-badges').first().waitFor();assert.equal(await page.locator('#source-filter').inputValue(),'group:learning','The filtered date survives reload');assert.equal(await page.locator('#rows tr').count(),1);
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Sources',exact:true}).click();await page.getByRole('checkbox',{name:'Break down groups'}).check();
  for(const theme of ['retrowave','classic','dark-green','frutiger-aero']){
    await page.evaluate(async theme=>{ledgerTestData.settings.theme=theme;await render();},theme);
    assert.equal(await page.locator('.source-day .trend-date[aria-pressed="true"]').evaluate(node=>getComputedStyle(node).backgroundImage),'none','Date labels stay plain in '+theme);
    assert.equal(await page.locator('.source-segment').first().evaluate(node=>getComputedStyle(node).boxShadow),'none','Source segments retain accurate flat colors in '+theme);
    await page.locator('.chart-panel').screenshot({path:'/tmp/ledger-sources-'+theme+'.png'});
    await page.setViewportSize({width:375,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,theme+' sources fit narrow screens');
    await page.locator('.chart-panel').screenshot({path:'/tmp/ledger-sources-'+theme+'-mobile.png'});await page.setViewportSize({width:1280,height:1000});
  }
  // Missing previous-period data should not produce repeated comparisons against zero.
  await page.evaluate(async()=>{for(const d of trendData.previousDays){delete ledgerTestData['day:'+d.day];delete ledgerTestData['recommendations:'+d.day];}await renderTrends();});
  assert.equal(await page.locator('#source-change-heading').isVisible(),false);assert.equal(await page.locator('.source-change').count(),0);assert.doesNotMatch(await page.locator('#trend-source-summary').innerText(),/from 0/);
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.trend-day').length===30);
  const monthDays=await page.evaluate(()=>trendData.days.filter(d=>d.sources.some(s=>s.key==='channel')).length);
  await page.locator('.source-summary-row[data-source="channel"] a').click();await page.waitForFunction(count=>document.querySelectorAll('#rows tr').length===count,monthDays);assert.match(page.url(),/period=30/);assert.equal(await page.locator('#source-filter').inputValue(),'channel');
  await page.getByRole('link',{name:'Overview',exact:true}).click();
  assert.equal(await page.locator('.source-day').count(),30);await page.locator('.source-segment[data-source=channel]').last().focus();const focused=await page.locator('.source-segment[data-source=channel]').last().getAttribute('data-day');await page.evaluate(()=>renderTrends());assert.equal(await page.evaluate(()=>document.activeElement.dataset.day),focused,'Automatic refresh retains keyboard focus');
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
  assert.equal(await page.locator('[data-view=history]').isVisible(),true);
  await page.getByRole('link',{name:'Overview',exact:true}).click();
  await page.getByRole('button',{name:'Previous period',exact:true}).click();
  const prior=report.previousDays.at(-1).day;
  assert.equal(await page.locator('#trend-end').inputValue(),prior);
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await page.locator('.trends').screenshot({path:__dirname+'/trends-preview.png'});
  await page.setViewportSize({width:600,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Sources',exact:true}).click();await page.evaluate(async()=>{for(const key of Object.keys(ledgerTestData))if(key.startsWith('day:'))delete ledgerTestData[key];await renderTrends();});assert.equal(await page.locator('.source-segment').count(),0);assert.equal(await page.locator('#source-summary-empty').isVisible(),true);assert.equal(await page.getByRole('checkbox',{name:'Break down groups'}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Trends checks passed: daily source totals, clickable week/month totals, period filters and dates, per-day labels, combined/split groups, source/date drilldown, reload, muted missing-source category, theme/mobile layouts, missing-baseline comparisons, empty state, refresh focus, week/month, metrics, export values, keyboard day navigation, period navigation, and narrow layout. Synthetic viewing history.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
