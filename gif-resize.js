/* Composite frames before reducing dimensions; preserve loop count and frame delays. */
globalThis.GifResize=(()=>{
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function compress(base64,maxBytes,notify=()=>{}){
    // Construct bytes in this realm from a primitive string (Firefox content-script safe).
    const binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),gif=GifCodec.parseGIF(bytes.buffer),frames=gif.frames.filter(f=>f.image);
    const width=gif.lsd?.width,height=gif.lsd?.height;
    if(!width||!height||width>2048||height>2048||!frames.length||frames.length>400||frames.reduce((n,f)=>n+f.image.descriptor.width*f.image.descriptor.height,0)>100000000)throw new Error('This animation is too complex to resize here. Use a GIF up to 2048 × 2048 with at most 400 frames, or shorten it first.');
    for(const frame of frames){const d=frame.image.descriptor;if(!d.width||!d.height||d.left+d.width>width||d.top+d.height>height||frame.image.data.minCodeSize<2||frame.image.data.minCodeSize>8)throw new Error('This GIF contains an invalid frame.');}
    const application=gif.frames.find(f=>['NETSCAPE2.0','ANIMEXTS1.0'].includes(f.application?.id))?.application;
    const loop=application?.blocks?.[0]===1?application.blocks[1]|application.blocks[2]<<8:-1;
    const transparent=frames.some(f=>f.gce?.extras.transparentColorGiven),background=gif.gct?.[gif.lsd.backgroundColorIndex]||[0,0,0];
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const patchCanvas=document.createElement('canvas'),patchContext=patchCanvas.getContext('2d');
    for(const [size,colors] of [[128,128],[96,64],[64,32]]){
      const scale=Math.min(1,size/Math.max(width,height)),out=document.createElement('canvas');out.width=Math.max(1,Math.round(width*scale));out.height=Math.max(1,Math.round(height*scale));const target=out.getContext('2d',{willReadFrequently:true}),encoder=GifCodec.GIFEncoder();
      function clear(x=0,y=0,w=width,h=height){if(transparent)ctx.clearRect(x,y,w,h);else{ctx.fillStyle='rgb('+background.join(',')+')';ctx.fillRect(x,y,w,h);}}
      clear();let previous,restore;
      for(let i=0;i<frames.length;i++){
        if(previous?.disposalType===2)clear(previous.dims.left,previous.dims.top,previous.dims.width,previous.dims.height);
        else if(previous?.disposalType===3&&restore)ctx.putImageData(restore,0,0);
        const frame=GifCodec.decompressFrame(frames[i],gif.gct,true),d=frame.dims;
        restore=frame.disposalType===3?ctx.getImageData(0,0,width,height):null;
        patchCanvas.width=d.width;patchCanvas.height=d.height;const pixels=patchContext.createImageData(d.width,d.height);for(let p=0;p<frame.patch.length;p++)pixels.data[p]=frame.patch[p];patchContext.putImageData(pixels,0,0);ctx.drawImage(patchCanvas,d.left,d.top);
        target.clearRect(0,0,out.width,out.height);target.drawImage(canvas,0,0,out.width,out.height);
        const nativePixels=target.getImageData(0,0,out.width,out.height).data,rgba=new Uint8Array(nativePixels.length);for(let p=0;p<rgba.length;p++)rgba[p]=nativePixels[p];
        const palette=GifCodec.quantize(rgba,colors,{format:'rgba4444',oneBitAlpha:true}),indexed=GifCodec.applyPalette(rgba,palette,'rgba4444'),transparentIndex=palette.findIndex(c=>c[3]===0);
        encoder.writeFrame(indexed,out.width,out.height,{palette,transparent:transparentIndex>=0,transparentIndex:Math.max(0,transparentIndex),delay:frames[i].gce?.delay>=2?frames[i].gce.delay*10:100,repeat:loop,dispose:2});previous=frame;
        if(i%4===0){notify('Resizing animation '+(i+1)+' / '+frames.length+'…');await yieldFrame();}
      }
      encoder.finish();const output=encoder.bytesView();if(output.length<=maxBytes){let result='';for(let i=0;i<output.length;i+=8192)result+=String.fromCharCode(...output.subarray(i,i+8192));return 'data:image/gif;base64,'+btoa(result);}
    }
    throw new Error('This GIF is still over 512 KB after resizing. Shorten its duration or choose a simpler animation.');
  }
  return {compress};
})();
