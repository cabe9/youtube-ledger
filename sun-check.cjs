const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:300}});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto('file://'+__dirname+'/retrowave-animated.svg');
    async function frame(time) {
      return page.evaluate(ms=>{
        for(const animation of document.getAnimations()){animation.pause();animation.currentTime=ms;}
        const matrix=new DOMMatrix(getComputedStyle(document.querySelector('.sun-gap')).transform);
        return {y:matrix.f,thickness:matrix.d,color:getComputedStyle(document.querySelector('.sun-top')).stopColor};
      },time);
    }
    const first=await frame(1000);
    await page.screenshot({path:__dirname+'/sun-first-preview.png'});
    const later=await frame(9000);
    await page.screenshot({path:__dirname+'/sun-later-preview.png'});
    assert.ok(later.y<first.y,'gaps move upward');
    assert.ok(later.thickness<first.thickness,'gaps narrow as they rise');
    assert.notEqual(later.color,first.color,'sun colors change');
    assert.equal(await page.locator('.sun-gap').count(),11);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.sun-gap').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    console.log('Sun checks passed: upward travel, narrowing transparent gaps, hue cycle, and reduced motion.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
