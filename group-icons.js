/* Shared local icon choices, emoji, and locally stored raster images. */
globalThis.GroupIcons = (() => {
  const options = [
    ['folder','Folder','M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V7Z'],
    ['headphones','Headphones','M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z'],
    ['music','Music','M10 17V5l10-2v12M10 9l10-2M10 17c0 1.7-1.8 3-4 3s-3-1-3-2.5S4.8 15 7 15c1.2 0 2.2.4 3 1m10-1c0 1.7-1.8 3-4 3s-3-1-3-2.5S14.8 13 17 13c1.2 0 2.2.4 3 1'],
    ['microphone','Podcasts','M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8'],
    ['book','Books','M12 6C9 4 5 4 2 5v14c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v14'],
    ['learning','Learning','m2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6m4-2v8'],
    ['moon','Relaxation','M20.5 14.2A9 9 0 0 1 9.8 3.5a9 9 0 1 0 10.7 10.7Z'],
    ['focus','Focus','M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5m0-9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
    ['gamepad','Gaming','M7 7h10c2 0 3 2 3.5 4l1 6c.5 3-2 4-4 2l-2-2h-7l-2 2c-2 2-4.5 1-4-2l1-6C4 9 5 7 7 7Zm0 3v5m-2.5-2.5h5m6-.5h.01m3 2h.01'],
    ['globe','World','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c5 5 5 13 0 18-5-5-5-13 0-18Z'],
    ['news','News','M4 4h16v16H4V4Zm4 4h3v4H8V8Zm7 0h2m-2 4h2m-9 4h9'],
    ['play','Videos','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM10 8v8l6-4-6-4Z'],
    ['star','Favorites','m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z'],
    ['heart','Heart','M12 21 3.5 12.5a5.3 5.3 0 0 1 7.5-7.5l1 1 1-1a5.3 5.3 0 0 1 7.5 7.5L12 21Z'],
    ['sparkles','Inspiration','m9 3 2.2 6.8L18 12l-6.8 2.2L9 21l-2.2-6.8L0 12l6.8-2.2L9 3Zm11-2v6m-3-3h6m-3 13v6m-3-3h6'],
    ['code','Technology','m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18']
  ].map(([id,label,path])=>({id,label,path}));
  const fallback={kind:'symbol',value:'folder'};
  const maxImageBytes=512*1024,maxSourceBytes=10*1024*1024,imageBudget=2*1024*1024;
  function imageType(prefix){
    if(prefix.startsWith('\x89PNG\r\n\x1a\n'))return 'png';
    if(prefix.startsWith('\xff\xd8\xff'))return 'jpeg';
    if(prefix.startsWith('GIF87a')||prefix.startsWith('GIF89a'))return 'gif';
    if(prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP')return 'webp';
    throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
  }
  function imageURL(value){
    if(typeof value!=='string'||value.length>Math.ceil(maxImageBytes/3)*4+64)throw new Error('Choose an image or GIF under 512 KB.');
    const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if(!match||match[2].length%4)throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
    const bytes=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
    if(bytes>maxImageBytes)throw new Error('Choose an image or GIF under 512 KB.');
    let type;try{type=imageType(atob(match[2].slice(0,16)));}catch{throw new Error('This image could not be read. Choose another file.');}
    if(type!==match[1])throw new Error('This image could not be read. Choose another file.');
    return value;
  }
  function readBase64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=reader.onabort=()=>reject(new Error('This image could not be read. Choose another file.'));
      reader.readAsDataURL(blob);
    });
  }
  async function fromFile(file,notify=()=>{}){
    if(!file||!file.size)throw new Error('Choose an image file.');
    if(file.size>maxSourceBytes)throw new Error('Choose an image or GIF under 10 MB.');
    // FileReader strings cross Firefox's content-script boundary safely. Typed-array
    // slice on a Blob.arrayBuffer() result can fail through its Xray wrapper.
    const type=imageType(atob(await readBase64(file.slice(0,12))));
    const url='data:image/'+type+';base64,'+await readBase64(file);
    if(type==='gif'&&file.size>maxImageBytes)return normalize({kind:'image',value:await GifResize.compress(url.split(',')[1],maxImageBytes,notify)});
    const image=new Image();image.src=url;
    try{await image.decode();}catch{throw new Error('This image could not be read. Choose another file.');}
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('This image could not be read. Choose another file.');
    // Preserve GIF bytes instead of flattening animation into a canvas frame.
    if(type==='gif')return normalize({kind:'image',value:url});
    const scale=Math.min(1,128/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');context.drawImage(image,0,0,canvas.width,canvas.height);
    return normalize({kind:'image',value:canvas.toDataURL('image/png')});
  }
  function normalize(value) {
    if(value===undefined||value===null)return {...fallback};
    if(value.kind==='symbol'&&options.some(option=>option.id===value.value))return {kind:'symbol',value:value.value};
    if(value.kind==='image')return {kind:'image',value:imageURL(value.value)};
    if(value.kind==='emoji'&&typeof value.value==='string'){
      const emoji=value.value.trim();
      if(emoji.length<=32&&/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\d#*]\uFE0F?\u20E3)/u.test(emoji)&&[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(emoji)].length===1)return {kind:'emoji',value:emoji};
    }
    throw new Error('Choose an icon, enter a single emoji, or upload an image.');
  }
  function create(value) {
    let icon;try{icon=normalize(value);}catch{icon=fallback;}
    const node=document.createElement('span');node.className='group-icon';node.setAttribute('aria-hidden','true');node.dataset.icon=icon.kind==='image'?'image':icon.value;
    if(icon.kind==='emoji'){node.classList.add('emoji');node.textContent=icon.value;return node;}
    if(icon.kind==='image'){
      const image=document.createElement('img');image.alt='';image.width=24;image.height=24;image.draggable=false;
      image.addEventListener('error',()=>node.replaceChildren(create().firstChild),{once:true});image.src=icon.value;node.append(image);return node;
    }
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'24',height:'24',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'}))svg.setAttribute(key,value);
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',options.find(option=>option.id===icon.value).path);svg.append(path);node.append(svg);return node;
  }
  const css='.group-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 24px;line-height:1;vertical-align:middle}.group-icon svg{display:block;width:100%;height:100%;overflow:visible}.group-icon img{display:block;width:100%;height:100%;object-fit:contain;border-radius:4px}.group-icon.emoji{font:21px/1 "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}';
  return {options,normalize,create,fromFile,css,imageBudget};
})();
