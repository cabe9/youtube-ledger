/* Explicit history backfill: native history page or an inert local file preview. */
globalThis.WatchEvidenceUI=(()=>{
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const button=(text,fn)=>{const node=el('button',text,{type:'button'});node.addEventListener('click',fn);return node;};
  async function request(message){const result=await browser.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'Could not save watch status.');return result;}
  function open(theme,onClose){
    document.getElementById('ledger-watch-status-dialog')?.shadowRoot?.querySelector('dialog')?.close();
    const host=el('div',undefined,{id:'ledger-watch-status-dialog'});host.dataset.ledgerTheme=theme||'dark-green';document.body.append(host);
    const root=ChannelGroupsUI.root(host),dialog=el('dialog',undefined,{class:'sharing-dialog','aria-label':'Update watch status'}),heading=el('div',undefined,{class:'dialog-heading'}),close=button('×',()=>dialog.close());close.setAttribute('aria-label','Close update watch status');heading.append(el('h3','Update watch status'),close);
    const note=el('p','',{role:'status',class:'status'}),preview=el('p','',{class:'muted'}),file=el('input',undefined,{type:'file',accept:'.json,.html,.htm',hidden:'','aria-label':'YouTube watch-history file'});
    let closed=false,busy=false,version=0,chosen;
    const check=button('Check YouTube history',async()=>{
      if(busy)return;lock(true);note.textContent='Opening YouTube history…';
      try{await request({type:'watchEvidence:open'});dialog.close();}catch(error){note.textContent=error.message;lock(false);}
    });
    const choose=button('Choose history file',()=>file.click()),submit=button('Import seen videos',async()=>{
      if(busy||!chosen)return;lock(true);note.textContent='Saving watch status…';
      try{
        const result=await request({type:'watchEvidence:import',records:chosen.records});
        if(closed)return;note.textContent=result.changed.toLocaleString()+' video records updated. Group badges are ready.'+(result.trimmed?' The oldest '+result.trimmed.toLocaleString()+' evidence records were dropped to stay within the 20,000-video limit.':'');
        chosen=null;preview.textContent='';file.value='';
      }catch(error){if(!closed)note.textContent=error.message;}
      finally{if(!closed)lock(false);}
    });submit.className='primary';submit.disabled=true;
    function lock(value){busy=value;for(const control of [check,choose,file,submit])control.disabled=value;submit.disabled=value||!chosen;}
    file.addEventListener('change',async()=>{
      const selected=file.files?.[0],current=++version;chosen=null;submit.disabled=true;preview.textContent='';note.textContent='';if(!selected)return;
      if(selected.size>50*1024*1024){note.textContent='Choose a history file smaller than 50 MB. Export a shorter date range if needed.';return;}
      lock(true);note.textContent='Reading file…';
      try{
        // FileReader works with file inputs in Firefox’s isolated content world.
        const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this file.'));reader.readAsText(selected);});
        if(closed||current!==version)return;
        const parsed=/\.json$/i.test(selected.name)?WatchEvidence.parseJSON(text):/\.html?$/i.test(selected.name)?WatchEvidence.parseHTML(text):null;
        if(!parsed)throw Error('Choose a YouTube watch-history JSON or HTML file.');
        chosen=parsed;preview.textContent=selected.name+' · '+parsed.records.length.toLocaleString()+' unique videos'+(parsed.omitted?' · '+parsed.omitted.toLocaleString()+' beyond the 20,000-video limit will be skipped':'')+'.';
        note.textContent='Ready to import as “Seen before.” Nothing has been saved yet.';
      }catch(error){if(!closed&&current===version)note.textContent=error.message;}
      finally{if(!closed&&current===version)lock(false);}
    });
    const actions=el('div',undefined,{class:'row share-tools'});actions.append(choose,submit,file);
    dialog.append(heading,el('p','Recognize videos you played before Ledger started tracking, or on another device.',{class:'muted'}),el('h4','From YouTube'),el('p','Open your signed-in YouTube history and scroll to include older entries. Ledger reads what the page loads; it does not run a separate background crawl.',{class:'muted'}),check,el('h4','From a history export'),el('p','Choose watch-history.json or watch-history.html from Google Takeout. Only video IDs and available viewing dates are saved locally.',{class:'muted'}),actions,preview,note,el('p','History entries become “Seen before” because completion is unknown. YouTube progress of 90% or more can mark a video watched. Neither adds watch time to your Ledger totals.',{class:'muted'}),button('Done',()=>dialog.close()));
    root.append(dialog);ChannelGroupsUI.modalLifecycle(host,dialog);
    dialog.addEventListener('close',()=>{closed=true;version++;host.remove();onClose?.();},{once:true});
    let backdrop=false;const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
    dialog.addEventListener('pointerdown',event=>{backdrop=event.button===0&&outside(event);});dialog.addEventListener('pointercancel',()=>{backdrop=false;});dialog.addEventListener('click',event=>{if(backdrop&&outside(event)){event.preventDefault();event.stopPropagation();dialog.close();}backdrop=false;});
    dialog.showModal();
  }
  const launch=document.getElementById('update-watch-status');launch?.addEventListener('click',()=>open(document.getElementById('setting-theme')?.value,()=>launch.focus()));
  return {open};
})();
