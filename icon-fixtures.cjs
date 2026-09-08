// Small, generated two-frame GIF for upload and animation regression checks.
function animatedGif(){
  const size=32,word=n=>[n&255,n>>8],bytes=[...Buffer.from('GIF89a'),...word(size),...word(size),128,0,0,255,60,110,40,180,255,...Buffer.from([33,255,11]),...Buffer.from('NETSCAPE2.0'),3,1,0,0,0];
  for(const color of [0,1]){
    bytes.push(33,249,4,0,20,0,0,0,44,0,0,0,0,...word(size),...word(size),0,2);
    const data=[];let bits=0,count=0;
    function code(value){bits|=value<<count;count+=3;while(count>=8){data.push(bits&255);bits>>=8;count-=8;}}
    for(let pixel=0;pixel<size*size;pixel++){code(4);code(color);}code(5);if(count)data.push(bits);
    for(let i=0;i<data.length;i+=255){const block=data.slice(i,i+255);bytes.push(block.length,...block);}bytes.push(0);
  }
  bytes.push(59);return Buffer.from(bytes);
}
module.exports={animatedGif};

// A real, high-detail animation that needs resizing (not just padded bytes).
module.exports.largeAnimatedGif=()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),box={};vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'gif-codec.js'),'utf8'),box);
 return Buffer.from(vm.runInContext(`(()=>{const encoder=GifCodec.GIFEncoder(),palette=Array.from({length:256},(_,i)=>[i,(i*13)%256,(i*29)%256]);let seed=123;
 for(let frame=0;frame<10;frame++){const pixels=new Uint8Array(256*256);for(let i=0;i<pixels.length;i++){seed=(seed*1664525+1013904223)>>>0;pixels[i]=((seed>>>24)+frame*17)%256;}encoder.writeFrame(pixels,256,256,{palette,delay:80+frame*10,repeat:0});}encoder.finish();return Array.from(encoder.bytes());})()`,box));
};
