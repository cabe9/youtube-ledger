const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const size of [16,32,48,64,128,256]){
   const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
   await page.goto('file://'+__dirname+'/icons/logo.svg');
   await page.evaluate(n=>{document.documentElement.setAttribute('width',n);document.documentElement.setAttribute('height',n);},size);
   await page.screenshot({path:__dirname+`/icons/icon-${size}.png`,omitBackground:true});
   await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
