/* Shared, style-isolated group controls for Ledger and YouTube. */
globalThis.ChannelGroupsUI = (() => {
  const disposeDialogs='ledger-group-dialogs-dispose';document.dispatchEvent(new Event(disposeDialogs));
  // YouTube hosts do not inherit the dashboard palette. Scope the same colors to our Shadow DOM hosts.
  const themeCss = `
    :host([data-ledger-theme]){
      color-scheme:dark;
      --page-bg:#101714;--ink:#f0f0e6;--quiet:#a1afa3;--accent:#d0e59b;--line:#344136;--panel:#18221c;
      --button-ink:#182015;--accent-hover:#dfedb8;--control-border:#445246;--control-hover:#253127;
      --field-bg:#141d17;--field-border:#435144;--placeholder:#8e9e91;--danger-ink:#d9aa91;
      --group-control-bg:var(--panel);--group-primary-bg:var(--accent);--group-dialog-bg:var(--page-bg);
    }
    :host([data-ledger-theme="classic"]){
      color-scheme:light;
      --page-bg:#f6f7f2;--ink:#223c30;--quiet:#5e6e60;--accent:#275e43;--line:#d7dfd0;--panel:#ffffff;
      --button-ink:#fff;--accent-hover:#19492f;--control-border:#b7c4b0;--control-hover:#e8eee2;
      --field-bg:#fff;--field-border:#bdcaba;--placeholder:#6b7b6e;--danger-ink:#8a4131;
    }
    :host([data-ledger-theme="retrowave"]){
      --page-bg:#110b1c;--ink:#f7edff;--quiet:#b7a9cb;--accent:#f8a3e2;--line:#443052;--panel:#1c122b;
      --button-ink:#29132b;--accent-hover:#ffc5ed;--control-border:#6f477d;--control-hover:#342041;
      --field-bg:#160e23;--field-border:#624470;--placeholder:#b3a0c5;--danger-ink:#f1afb6;
    }
    :host([data-ledger-theme="frutiger-aero"]){
      color-scheme:light;
      --page-bg:#b9eaf1;--ink:#073e65;--quiet:#35617a;--accent:#0066b7;--line:#97c9d6;--panel:#e5f7fb;
      --button-ink:#fff;--accent-hover:#00579b;--control-border:#88c2dc;--control-hover:#eafaff;
      --field-bg:#f3fcff;--field-border:#87baca;--placeholder:#506e80;--danger-ink:#973c29;
      --group-control-bg:linear-gradient(#f4fdff,#cdeef7);
      --group-primary-bg:linear-gradient(#45baff,#168ce0 48%,#0875c8 49%,#078bdd);
      --group-dialog-bg:linear-gradient(135deg,#f4fdff,#d6f3ff);
    }
  `;
  const css = LedgerMedia.css+GroupIcons.css+`
    :host{display:block;font:15px/1.5 system-ui,sans-serif;color:var(--ink,#eff5ee);color-scheme:inherit}
    *{box-sizing:border-box}button,input{font:inherit}button,a,input{touch-action:manipulation}
    button{border:1px solid var(--control-border,#45624c);border-radius:8px;padding:9px 14px;cursor:pointer;background:var(--group-control-bg,var(--panel,#18231c));color:inherit}
    button:hover{background:var(--control-hover,#263b2c)}button:disabled{opacity:.55;cursor:wait}
    button.primary{background:var(--group-primary-bg,var(--accent,#cce69d));color:var(--button-ink,#1b2b19);border-color:transparent;font-weight:600}
    button.primary:hover{background:var(--accent-hover,var(--accent,#cce69d))}
    button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--accent,#cce69d);outline-offset:3px}
    input:not([type=checkbox]){min-width:0;width:100%;padding:10px 12px;border:1px solid var(--field-border,#45624c);border-radius:8px;background:var(--field-bg,#111c15);color:inherit}
    input::placeholder{color:var(--placeholder,#9db09f)}input[type=checkbox]{width:19px;height:19px;accent-color:var(--accent,#cce69d);flex-shrink:0}
    h3{font-size:21px;margin:0 0 12px}p{margin:8px 0}small,.muted{color:var(--quiet,#abbcaf)}
    a{color:inherit;text-underline-offset:3px;overflow-wrap:anywhere}label{display:block}form{margin:0}
    .row{display:flex;align-items:center;gap:10px}.row>input{flex:1}.row>button{flex-shrink:0}
    .add-channel-row{align-items:flex-end}.add-channel-row label>input{display:block}.add-channel-row>button{padding-block:10px}
    .manager{display:grid;grid-template-columns:260px minmax(0,1fr);gap:24px}.panel{border:1px solid var(--line,#38513e);border-radius:14px;padding:22px;background:var(--panel,#18231c);min-width:0}
    .manager>.panel:first-child>form{display:grid;gap:10px}
    .manager-close-row{display:flex;justify-content:flex-end;margin-bottom:18px}
    .group-list{display:grid;gap:8px;margin-top:20px}.group-choice{display:flex;text-align:left;align-items:center;justify-content:space-between;gap:10px;overflow-wrap:anywhere}
    .group-choice[aria-pressed=true]{border-color:var(--accent,#cce69d);box-shadow:inset 3px 0 var(--accent,#cce69d)}
    .group-choice span{min-width:0}.group-label{display:flex;align-items:center;gap:12px;flex:1;min-width:0}.group-choice small{flex-shrink:0}.space{margin-top:24px}.heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
    .heading h3{margin:0;overflow-wrap:anywhere}.channel-list{list-style:none;padding:0;margin:20px 0 0}.channel-list li{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line,#38513e);padding:14px 0}
    .channel-list li>div{min-width:0}.channel-list small{display:block;overflow-wrap:anywhere;font-size:11px}.danger{color:var(--danger-ink,#f1b2a2)}
    .status{min-height:24px;margin:14px 0;color:var(--quiet,#abbcaf);overflow-wrap:anywhere}.status.error{color:var(--danger-ink,#f1b2a2)}
    .membership{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--line,#38513e);cursor:pointer;overflow-wrap:anywhere}
    .membership span{min-width:0}.membership small{display:block}.empty{padding:16px 0;color:var(--quiet,#abbcaf)}
    dialog{color:var(--ink,#eff5ee);background:var(--group-dialog-bg,var(--page-bg,#101714));border:1px solid var(--line,#38513e);border-radius:18px;width:min(500px,calc(100vw - 28px));max-height:calc(100dvh - 40px);padding:26px;overflow:auto;box-shadow:0 24px 90px #0008}
    dialog::backdrop{background:#0008}.dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.dialog-heading h3{margin:0}.close{padding:6px 12px;font-size:20px}
    .icon-editor{width:min(440px,calc(100vw - 28px))}.icon-preview{display:flex;align-items:center;gap:14px;padding:18px 0;overflow-wrap:anywhere}.icon-preview>span:last-child{min-width:0}.icon-preview>.group-icon{width:40px;height:40px;flex-basis:40px;background:var(--panel);border-radius:10px}.icon-preview svg{width:26px;height:26px}.icon-preview .emoji{font-size:28px}
    .icon-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin:8px 0 20px}.icon-option{display:flex;align-items:center;justify-content:center;aspect-ratio:1;padding:0;min-width:0;background:transparent;border-color:transparent}.icon-option[aria-pressed=true]{color:var(--accent);background:var(--control-hover);border-color:var(--accent)}.icon-caption{font-size:13px;color:var(--quiet);margin:5px 0 0}.icon-actions{justify-content:flex-end}.change-icon{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;flex-shrink:0}.change-icon span:last-child{font-size:13px}
    .icon-upload{margin-top:20px}.icon-upload .row{flex-wrap:wrap}.upload-name{font-size:13px;overflow-wrap:anywhere;margin:7px 0 0}.file-input{display:none}.icon-preview>.group-icon[data-icon=image]{width:56px;height:56px;flex-basis:56px;background:transparent}
    .share-tools{flex-wrap:wrap;margin-top:16px}.share-tools button{font-size:13px;padding:7px 10px}.sharing-dialog{width:min(580px,calc(100vw - 28px))}.share-list{max-height:40vh;overflow:auto;margin:12px 0}.share-item{border-bottom:1px solid var(--line)}.share-item .membership{border:0}.share-item details{margin:0 0 12px 35px;font-size:13px}.share-item summary{cursor:pointer;color:var(--quiet)}.share-channels{max-height:160px;overflow:auto;display:grid;gap:5px;padding-top:8px}.share-option{display:flex;align-items:center;gap:10px;margin:12px 0}.share-actions{flex-wrap:wrap;justify-content:flex-end}.share-filename{overflow-wrap:anywhere}
    @media(max-width:440px){.icon-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.icon-option{aspect-ratio:auto;min-height:42px}.icon-editor{padding:20px}}
    @media(max-width:700px){.manager{grid-template-columns:minmax(0,1fr)}.panel{padding:17px}.group-list{grid-template-columns:repeat(2,minmax(0,1fr))}.row{flex-wrap:wrap}.row>input{flex-basis:160px}.heading{flex-wrap:wrap}}
  `;
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
  const button=(text,click,kind='')=>{const node=el('button',text,{type:'button',class:kind});node.addEventListener('click',click);return node;};
  const input=(label,placeholder)=>el('input',undefined,{'aria-label':label,placeholder,required:'',maxlength:'2000'});
  const request=async message=>{const result=await browser.runtime.sendMessage(message);if(result?.channelGroupError)throw new Error(result.channelGroupError);return result;};
  function root(host){const shadow=host.attachShadow({mode:'open'});shadow.append(el('style',themeCss+css));return shadow;}
  function modalLifecycle(host,dialog){
    const close=()=>dialog.close(),changed=(changes,area)=>{if(area==='local'&&changes.settings&&host.hasAttribute('data-ledger-theme'))host.dataset.ledgerTheme=Ledger.settings(changes.settings.newValue).theme;};
    document.addEventListener('yt-navigate-start',close);document.addEventListener(disposeDialogs,close);browser.storage.onChanged.addListener(changed);
    dialog.addEventListener('close',()=>{document.removeEventListener('yt-navigate-start',close);document.removeEventListener(disposeDialogs,close);browser.storage.onChanged.removeListener(changed);},{once:true});
  }
  function status(node,text,error=false){node.textContent=text;node.classList.toggle('error',error);}
  function newGroupForm(onCreate,label='New group name') {
    const form=el('form');const field=input(label,'e.g. Podcasts');field.maxLength=80;
    const create=el('button','Create group',{type:'submit',class:'primary'});form.className='row';form.append(field,create);
    form.addEventListener('submit',async event=>{event.preventDefault();create.disabled=true;try{if(await onCreate(field.value)!==false)field.value='';}finally{create.disabled=false;}});
    return form;
  }
  function manager(host,options={}) {
    const shadow=root(host), layout=el('div',undefined,{class:'manager'}), sidebar=el('section',undefined,{class:'panel'}), detail=el('section',undefined,{class:'panel'});
    const list=el('div',undefined,{class:'group-list','aria-label':'Your groups'}), note=el('p','Loading groups…',{class:'status',role:'status'});
    let state={groups:[],channels:{}}, selected=options.groupId||null, busy=false, revision=0;
    let portraitSelection='';
    function requestPortraits(){
      const group=state.groups.find(g=>g.id===selected);if(!group||!host.getClientRects().length)return;
      const signature=JSON.stringify([group.id,group.channelIds]);if(signature===portraitSelection)return;
      portraitSelection=signature;LedgerMedia.portraits(group.channelIds);
    }
    // The dashboard mounts all panels up front. Wait until Groups is actually shown.
    const visibility=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))requestPortraits();});visibility.observe(host);
    sidebar.append(el('h3','Your groups'),newGroupForm(async name=>{
      return mutate({action:'create',name},'Group created.',true);
    }),list);layout.append(sidebar,detail);
    const sharing=el('div',undefined,{class:'row share-tools'});
    for(const mode of ['Share','Import'])sharing.append(button(mode+' groups',()=>shareGroups(mode,selected,host.dataset.ledgerTheme,result=>{if(result?.groups?.length)selected=result.groups[0].id;reload();sharing.querySelector('button')?.focus();})));
    sidebar.insertBefore(sharing,list);
    let dialog;
    if(options.modal){
      dialog=el('dialog',undefined,{'aria-label':'Manage group'});dialog.style.width='min(920px,calc(100vw - 28px))';
      const closeRow=el('div',undefined,{class:'manager-close-row'});closeRow.append(button('Close',()=>dialog.close()));
      dialog.append(closeRow,layout,note);shadow.append(dialog);modalLifecycle(host,dialog);dialog.showModal();
    }else shadow.append(layout,note);
    async function mutate(message,success,selectNew=false) {
      if(busy)return false;busy=true;
      for(const control of shadow.querySelectorAll('button,input'))control.disabled=true;
      try {state=await request({type:'channelGroups:change',...message});revision++;if(selectNew)selected=state.groups.at(-1).id;status(note,success);LedgerUndoUI.show(shadow,success,state.undoToken,()=>{selected=message.groupId;return reload();});return true;}
      catch(error){status(note,error.message||'Could not save groups.',true);return false;}
      finally{busy=false;for(const control of shadow.querySelectorAll('button,input'))control.disabled=false;render();}
    }
    function render(){
      if(!state.groups.some(g=>g.id===selected))selected=state.groups[0]?.id;
      list.replaceChildren();
      for(const group of state.groups){const choice=button('',()=>{selected=group.id;render();});choice.className='group-choice';choice.setAttribute('aria-pressed',String(group.id===selected));const label=el('span',undefined,{class:'group-label'});label.append(GroupIcons.create(group.icon),el('span',group.name));choice.append(label,el('small',String(group.channelIds.length)));list.append(choice);}
      detail.replaceChildren();const group=state.groups.find(g=>g.id===selected);
      requestPortraits();
      if(!group){detail.append(el('h3','Make room for your interests'),el('p','Create a group, then add channels here or from a YouTube channel or watch page.',{class:'muted'}));return;}
      const heading=el('div',undefined,{class:'heading'}),title=el('div',undefined,{class:'group-label'}),edit=button('',()=>editIcon(group,undefined,()=>detail.querySelector('.change-icon')?.focus()),'change-icon');edit.setAttribute('aria-label','Change group icon');edit.title='Change group icon';edit.append(GroupIcons.create(group.icon),el('span','Edit icon'));title.append(edit,el('h3',group.name));heading.append(title,button('Delete group',()=>{
        mutate({action:'delete',groupId:group.id},'Group deleted.');
      },'danger'));detail.append(heading);
      const rename=el('form',undefined,{class:'row'}),nameField=input('Group name','Group name');nameField.value=group.name;nameField.maxLength=80;
      rename.append(nameField,el('button','Rename',{type:'submit'}));rename.addEventListener('submit',event=>{event.preventDefault();mutate({action:'rename',groupId:group.id,name:nameField.value},'Group renamed.');});detail.append(rename);
      const order=el('div',undefined,{class:'row space'}),index=state.groups.indexOf(group);
      for(const [label,delta] of [['Move up',-1],['Move down',1]]){const move=button(label,()=>{const ids=state.groups.map(g=>g.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];mutate({action:'reorder',ids},'Group order saved.');});move.disabled=index+delta<0||index+delta>=state.groups.length;order.append(move);}
      order.append(button('Add multiple channels',()=>bulk(group.id,host.dataset.ledgerTheme)));detail.append(order);
      const add=el('form',undefined,{class:'space'}),label=el('label','Add a channel'),field=input('Channel address','@handle, channel URL, or channel ID'),row=el('div',undefined,{class:'row add-channel-row'}),submit=el('button','Add channel',{type:'submit',class:'primary'});
      label.append(field);row.append(label,submit);label.style.flex='1';add.append(row,el('p','A channel can belong to more than one group.',{class:'muted'}));
      add.addEventListener('submit',async event=>{
        event.preventDefault();if(busy)return;submit.disabled=true;field.disabled=true;status(note,'Finding channel…');
        try {const channel=await request({type:'channelGroups:resolve',input:field.value});await mutate({action:'membership',groupId:group.id,channel,member:true},`Added ${channel.name}.`);}
        catch(error){status(note,error.message||'Could not find that channel.',true);}
        finally{submit.disabled=false;field.disabled=false;}
      });detail.append(add);
      const members=el('ul',undefined,{class:'channel-list'});
      for(const id of group.channelIds){const c=state.channels[id];if(!c)continue;const item=el('li'),text=el('div');text.append(LedgerMedia.channelLink(c));item.append(text,button('Remove',()=>mutate({action:'membership',groupId:group.id,channel:c,member:false},`Removed ${c.name} from ${group.name}.`)));members.append(item);}
      detail.append(members);if(!group.channelIds.length)detail.append(el('p','No channels yet.',{class:'empty'}));
    }
    async function reload(){const version=++revision;try{const next=await request({type:'channelGroups:get'});if(version!==revision||busy)return;if(!next?.groups)throw new Error('Reload the extension to enable groups.');state=next;render();status(note,'Saved in this browser.');}catch(error){status(note,error.message,true);}}
    const changed=changes=>{
      const next=changes['channelGroups:v1']?.newValue;if(!next||busy)return;
      // Portraits arriving in the background must not erase a channel/name draft.
      if(JSON.stringify(next.groups)===JSON.stringify(state.groups)){state=next;LedgerMedia.updateChannels(detail,state.channels);}
      else reload();
    };browser.storage.onChanged?.addListener(changed);
    if(dialog)dialog.addEventListener('close',()=>{visibility.disconnect();browser.storage.onChanged.removeListener(changed);host.remove();},{once:true});
    reload();return {reload};
  }
  async function shareGroups(mode,selected,theme,onClose,single=false){
    document.getElementById('ledger-group-sharing-dialog')?.shadowRoot?.querySelector('dialog')?.close();
    const host=el('div',undefined,{id:'ledger-group-sharing-dialog'});if(theme)host.dataset.ledgerTheme=theme;document.body.append(host);
    const caption=mode+(single?' group':' groups');
    const shadow=root(host),dialog=el('dialog',undefined,{class:'sharing-dialog','aria-label':caption}),heading=el('div',undefined,{class:'dialog-heading'}),note=el('p','Loading groups…',{class:'status',role:'status'});
    const close=button('×',()=>dialog.close(),'close');close.setAttribute('aria-label','Close '+caption.toLowerCase());heading.append(el('h3',caption),close);
    dialog.append(heading,note);shadow.append(dialog);modalLifecycle(host,dialog);dialog.showModal();
    let closed=false,busy=false,result,chosen=null,selectionVersion=0;
    dialog.addEventListener('close',()=>{closed=true;++selectionVersion;host.remove();onClose?.(result);},{once:true});
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    let backdrop=false;const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
    dialog.addEventListener('pointerdown',event=>{backdrop=event.button===0&&outside(event);});
    dialog.addEventListener('pointercancel',()=>{backdrop=false;});
    dialog.addEventListener('click',event=>{if(backdrop&&outside(event)&&!busy){event.preventDefault();event.stopPropagation();dialog.close();}backdrop=false;});
    function lock(value){busy=value;for(const control of dialog.querySelectorAll('button,input'))control.disabled=value;}
    const count=(n,noun)=>n+' '+noun+(n===1?'':'s');
    try{
      const state=await request({type:'channelGroups:get'});if(closed)return;
      const description=el('p',single?'Send this group to another Ledger user. The file includes its name, channels, and optional icon.':mode==='Share'?'Choose groups to send to another Ledger user. Only group names, channels, and the icons you choose are included.':'Choose a shared groups file to preview its channels. Selected groups are added as new groups; matching names get a number.',{class:'muted'});
      const body=el('div'),actions=el('div',undefined,{class:'row space share-actions'}),list=el('div',undefined,{class:'share-list'}),summary=el('p','',{class:'muted',role:'status'});
      const iconsLabel=el('label',undefined,{class:'share-option'}),icons=el('input',undefined,{type:'checkbox'});icons.checked=true;iconsLabel.append(icons,el('span',single?'Include group icon':'Include group icons'));
      const allLabel=el('label',undefined,{class:'share-option'}),all=el('input',undefined,{type:'checkbox'});allLabel.append(all,el('span','Select all groups'));
      let entries=[],channels=new Map(),picked=new Set();
      const submit=button(single?'Download group file':mode==='Share'?'Download groups file':'Import selected groups',async()=>{
        if(busy||!picked.size||mode==='Import'&&!chosen)return;
        lock(true);status(note,mode==='Share'?'Preparing groups…':'Adding groups…');
        try{
          if(mode==='Share'){
            const exported=await request({type:'channelGroups:share:export',ids:[...picked],includeIcons:icons.checked});if(closed)return;
            const url=URL.createObjectURL(new Blob([exported.text],{type:'application/json'})),link=el('a',undefined,{href:url,download:'ledger-groups-'+new Date().toISOString().slice(0,10)+'.json'});
            shadow.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
            status(note,'Groups file downloaded. Send it to someone who uses Ledger; they can open Groups → Import groups.');
          }else{
            result=await request({type:'channelGroups:share:import',text:chosen,indices:[...picked],includeIcons:icons.checked});if(closed)return;
            body.replaceChildren(el('p','Added '+count(result.groups.length,'group')+' with '+count(result.channels,'channel')+'.'),el('p',result.groups.map(g=>g.name).join(' · '),{class:'muted'}));
            actions.replaceChildren(button('Done',()=>dialog.close(),'primary'));status(note,'Your imported groups are ready in the sidebar.');chosen=null;
          }
        }catch(error){if(!closed)status(note,error.message||'Could not save these groups.',true);}
        finally{if(!closed){lock(false);submit.disabled=!picked.size;}}
      },'primary');
      function updateSelection(){
        const selectedEntries=entries.filter(g=>picked.has(g.key)),channelCount=new Set(selectedEntries.flatMap(g=>g.channelIds)).size;
        summary.textContent=count(selectedEntries.length,'group')+' · '+count(channelCount,'channel')+' selected';submit.disabled=!picked.size;
        all.checked=!!entries.length&&picked.size===entries.length;all.indeterminate=picked.size>0&&picked.size<entries.length;
      }
      function renderList(){
        list.replaceChildren();
        for(const g of entries){
          const item=el('div',undefined,{class:'share-item'}),label=el(single?'div':'label',undefined,{class:'membership'}),check=el('input',undefined,{type:'checkbox'}),text=el('span',g.name);
          text.append(el('small',count(g.channelIds.length,'channel')));check.checked=picked.has(g.key);
          check.addEventListener('change',()=>{if(check.checked)picked.add(g.key);else picked.delete(g.key);updateSelection();});if(!single)label.append(check);else label.style.cursor='default';label.append(GroupIcons.create(icons.checked?g.icon:undefined),text);item.append(label);
          if(g.channelIds.length){
            const details=el('details'),links=el('div',undefined,{class:'share-channels'});details.append(el('summary','View channels'),links);
            // Build long channel lists only if the recipient opens the preview.
            details.addEventListener('toggle',()=>{if(!details.open||links.childElementCount)return;for(const id of g.channelIds)links.append(el('a',channels.get(id)?.name||id,{href:'https://www.youtube.com/channel/'+id,target:'_blank',rel:'noopener noreferrer'}));});item.append(details);
          }
          list.append(item);
        }
        updateSelection();
      }
      all.addEventListener('change',()=>{picked=new Set(all.checked?entries.map(g=>g.key):[]);renderList();});icons.addEventListener('change',renderList);
      actions.append(button('Cancel',()=>dialog.close()),submit);
      dialog.replaceChildren(heading,description,body,actions,note);
      if(mode==='Share'){
        entries=state.groups.filter(g=>!single||g.id===selected).map(g=>({...g,key:g.id}));channels=new Map(Object.values(state.channels).map(c=>[c.id,c]));picked=new Set(entries.filter(g=>g.id===selected).map(g=>g.id));
        if(!single)body.append(allLabel);body.append(list,iconsLabel,summary);renderList();status(note,entries.length?'':single?'This group is no longer available.':'Create a group first, then share its channels.');
      }else{
        const file=el('input',undefined,{type:'file',accept:'.json,application/json',class:'file-input','aria-label':'Shared groups file'}),filename=el('p','',{class:'share-filename muted'}),preview=el('div');preview.hidden=true;
        const choose=button('Choose groups file',()=>file.click());body.append(choose,file,filename,preview);preview.append(allLabel,list,iconsLabel,summary);submit.disabled=true;status(note,'Your existing groups, settings, and history will be kept.');
        file.addEventListener('change',async()=>{
          const selectedFile=file.files[0];file.value='';if(busy)return;
          const version=++selectionVersion;chosen=null;picked.clear();preview.hidden=true;submit.disabled=true;filename.textContent='';if(!selectedFile)return;
          status(note,'Reading groups…');
          try{
            if(selectedFile.size>10*1024*1024)throw new Error('Choose a groups file under 10 MB.');
            const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=()=>reject(new Error('This file could not be read.'));reader.readAsText(selectedFile);});
            if(closed||version!==selectionVersion)return;
            const parsed=await request({type:'channelGroups:share:preview',text});if(closed||version!==selectionVersion)return;
            chosen=text;entries=parsed.groups.map(g=>({...g,key:g.index}));channels=new Map(parsed.channels.map(c=>[c.id,c]));picked=new Set(entries.map(g=>g.key));filename.textContent=selectedFile.name;
            renderList();preview.hidden=false;status(note,'Choose the groups you want to add, then import.');
          }catch(error){if(!closed&&version===selectionVersion)status(note,error.message||'Could not read this groups file.',true);}
        });
      }
    }catch(error){if(!closed)status(note,error.message||'Could not load groups.',true);}
  }
  async function picker(host,channelInput,onClose) {
    const shadow=root(host), dialog=el('dialog',undefined,{'aria-labelledby':'group-picker-title'}),heading=el('div',undefined,{class:'dialog-heading'});
    const title=el('h3','Add to groups',{id:'group-picker-title'}),note=el('p','Finding channel…',{class:'status',role:'status'}),body=el('div');
    heading.append(title,button('×',()=>dialog.close(),'close'));heading.lastChild.setAttribute('aria-label','Close groups');dialog.append(heading,body,note);shadow.append(dialog);
    // Native dialog backdrops target the dialog itself, as does its inner padding.
    // Require the gesture to begin and end outside so dragging text does not dismiss it.
    let backdropPress=false;
    const onBackdrop=event=>{const rect=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);};
    dialog.addEventListener('pointerdown',event=>{backdropPress=event.button===0&&onBackdrop(event);});
    dialog.addEventListener('pointercancel',()=>{backdropPress=false;});
    dialog.addEventListener('click',event=>{const dismiss=backdropPress&&onBackdrop(event);backdropPress=false;if(dismiss){event.preventDefault();event.stopPropagation();dialog.close();}});
    let state,channel,busy=false,closed=false;
    const changed=changes=>{if(changes['channelGroups:v1']&&!busy&&channel&&!closed)load().catch(error=>status(note,error.message,true));};
    dialog.addEventListener('close',()=>{closed=true;browser.storage.onChanged.removeListener?.(changed);host.remove();onClose?.();},{once:true});
    dialog.showModal();
    async function save(message){
      if(busy||closed)return false;busy=true;for(const control of body.querySelectorAll('button,input'))control.disabled=true;
      try{state=await request({type:'channelGroups:change',...message});if(!closed){render();status(note,'Saved.');LedgerUndoUI.show(shadow,'Channel removed from group.',state.undoToken);}return true;}
      catch(error){if(!closed){render();status(note,error.message,true);}return false;}
      finally{busy=false;}
    }
    function render(){
      body.replaceChildren();body.append(LedgerMedia.channelLink(channel));
      if(!state.groups.length)body.append(el('p','Create your first group for this channel.',{class:'empty'}));
      for(const group of state.groups){const label=el('label',undefined,{class:'membership'}),check=el('input',undefined,{type:'checkbox'});check.checked=group.channelIds.includes(channel.id);const text=el('span',group.name);text.append(el('small',`${group.channelIds.length} channel${group.channelIds.length===1?'':'s'}`));check.addEventListener('change',()=>save({action:'membership',groupId:group.id,channel,member:check.checked}));label.append(check,GroupIcons.create(group.icon),text);body.append(label);}
      const create=el('div',undefined,{class:'space'});create.append(newGroupForm(name=>save({action:'create',name,channel})));body.append(create);
      const actions=el('div',undefined,{class:'row space'});actions.append(button('Manage groups',()=>request({type:'channelGroups:open'}).catch(error=>status(note,error.message,true))),button('Done',()=>dialog.close(),'primary'));body.append(actions);
    }
    async function load(){state=await request({type:'channelGroups:get'});if(!closed)render();}
    try{channel=await request({type:'channelGroups:resolve',input:channelInput});if(closed)return;await load();if(!closed){status(note,'Choose any groups for this channel. Changes save automatically.');browser.storage.onChanged.addListener(changed);}}
    catch(error){if(!closed)status(note,error.message||'Could not identify this channel.',true);}
  }
  function editIcon(group,theme,onClose) {
    document.getElementById('ledger-group-icon-dialog')?.shadowRoot.querySelector('dialog')?.close();
    const host=el('div',undefined,{id:'ledger-group-icon-dialog'});if(theme)host.dataset.ledgerTheme=theme;document.body.append(host);
    const shadow=root(host),dialog=el('dialog',undefined,{class:'icon-editor','aria-labelledby':'icon-picker-title'}),heading=el('div',undefined,{class:'dialog-heading'});
    heading.append(el('h3','Group icon',{id:'icon-picker-title'}),button('×',()=>dialog.close(),'close'));heading.lastChild.setAttribute('aria-label','Close icon picker');
    let selected;try{selected=GroupIcons.normalize(group.icon);}catch{selected=GroupIcons.normalize();}
    let busy=false,closed=false,uploading=false,uploadRevision=0;
    const preview=el('div',undefined,{class:'icon-preview'}),grid=el('div',undefined,{class:'icon-grid',role:'group','aria-label':'Choose an icon'}),form=el('form');
    const label=el('label','Custom emoji'),emoji=input('Custom emoji','e.g. 🎧');emoji.required=false;emoji.maxLength=32;emoji.setAttribute('aria-describedby','emoji-hint');emoji.autocomplete='off';emoji.spellcheck=false;emoji.value=selected.kind==='emoji'?selected.value:'';label.append(emoji);
    const hint=el('p','Paste one emoji or use your emoji keyboard.',{id:'emoji-hint',class:'icon-caption'}),note=el('p','',{class:'status',role:'status'}),actions=el('div',undefined,{class:'row icon-actions'}),save=el('button','Save icon',{type:'submit',class:'primary'});
    const upload=el('div',undefined,{class:'icon-upload'}),uploadActions=el('div',undefined,{class:'row'}),file=el('input',undefined,{type:'file',class:'file-input',accept:'image/png,image/jpeg,image/webp,image/gif','aria-label':'Image or GIF file',tabindex:'-1'});
    const uploadButton=button('Upload image or GIF',()=>file.click()),removeImage=button('Remove image',()=>choose(GroupIcons.normalize())),fileName=el('p',selected.kind==='image'?'Current uploaded image':'',{class:'upload-name muted'});
    uploadActions.append(uploadButton,removeImage);upload.append(uploadActions,file,fileName,el('p','PNG, JPG, WebP or GIF, up to 10 MB. Large GIFs resize automatically and keep their animation. Preview before saving.',{class:'icon-caption'}));
    actions.append(button('Cancel',()=>dialog.close()),save);
    function update(){
      let current;try{current=GroupIcons.normalize(selected);}catch{current=GroupIcons.normalize();}
      preview.replaceChildren(GroupIcons.create(current),el('span',group.name));
      for(const option of grid.children)option.setAttribute('aria-pressed',String(selected.kind==='symbol'&&selected.value===option.dataset.icon));
      removeImage.hidden=selected.kind!=='image';fileName.hidden=!fileName.textContent;
    }
    function choose(icon){uploadRevision++;uploading=false;save.disabled=false;selected=icon;file.value='';fileName.textContent='';if(icon.kind!=='emoji')emoji.value='';emoji.removeAttribute('aria-invalid');status(note,'');update();}
    for(const option of GroupIcons.options){const choice=button('',()=>choose({kind:'symbol',value:option.id}),'icon-option');choice.dataset.icon=option.id;choice.setAttribute('aria-label',option.label);choice.title=option.label;choice.append(GroupIcons.create({kind:'symbol',value:option.id}));grid.append(choice);}
    emoji.addEventListener('input',()=>choose(emoji.value.trim()?{kind:'emoji',value:emoji.value}:GroupIcons.normalize()));
    file.addEventListener('change',async()=>{
      const image=file.files[0];if(!image||busy)return;
      const revision=++uploadRevision;uploading=true;save.disabled=true;status(note,'Reading image…');
      try{
        const icon=await GroupIcons.fromFile(image,text=>{if(closed||revision!==uploadRevision)throw new Error('Image selection changed.');status(note,text);});if(closed||revision!==uploadRevision)return;
        selected=icon;emoji.value='';emoji.removeAttribute('aria-invalid');fileName.textContent=image.name;const savedBytes=Math.floor(icon.value.split(',')[1].length*3/4);status(note,(savedBytes<image.size?'Reduced '+Math.ceil(image.size/1024)+' KB to '+Math.ceil(savedBytes/1024)+' KB. ':'')+'Image ready. Choose Save icon to apply it.');update();
      }catch(error){if(!closed&&revision===uploadRevision)status(note,error.message||'Could not read this image.',true);}
      finally{if(!closed&&revision===uploadRevision){uploading=false;save.disabled=false;file.value='';}}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||uploading)return;
      let icon;try{icon=GroupIcons.normalize(selected);}catch(error){emoji.setAttribute('aria-invalid','true');status(note,error.message,true);emoji.focus();return;}
      busy=true;for(const control of dialog.querySelectorAll('button,input'))control.disabled=true;status(note,'Saving…');
      try{await request({type:'channelGroups:change',action:'icon',groupId:group.id,icon});if(!closed)dialog.close();}
      catch(error){if(!closed)status(note,error.message||'Could not save this icon.',true);}
      finally{busy=false;if(!closed)for(const control of dialog.querySelectorAll('button,input'))control.disabled=false;}
    });
    const themeChanged=(changes,area)=>{if(area==='local'&&changes.settings&&theme)host.dataset.ledgerTheme=Ledger.settings(changes.settings.newValue).theme;};
    const navigate=()=>dialog.close();
    dialog.addEventListener('close',()=>{closed=true;browser.storage.onChanged.removeListener?.(themeChanged);document.removeEventListener('yt-navigate-start',navigate);host.remove();onClose?.();},{once:true});
    browser.storage.onChanged.addListener(themeChanged);document.addEventListener('yt-navigate-start',navigate);
    form.append(grid,label,hint,upload,note,actions);dialog.append(heading,preview,form);shadow.append(dialog);update();dialog.showModal();
    grid.querySelector('[aria-pressed=true]')?.focus();if(selected.kind==='emoji')emoji.focus();
  }
  function manageGroup(group,theme,onClose){
    document.getElementById('ledger-group-manager-dialog')?.shadowRoot?.querySelector('dialog')?.close();
    const host=el('div',undefined,{id:'ledger-group-manager-dialog'});host.dataset.ledgerTheme=theme||Ledger.settings().theme;document.body.append(host);manager(host,{groupId:group.id,modal:true});if(onClose)host.shadowRoot.querySelector('dialog').addEventListener('close',onClose,{once:true});
  }
  async function bulk(groupId,theme){
    document.getElementById('ledger-group-bulk-dialog')?.shadowRoot?.querySelector('dialog')?.close();
    const host=el('div',undefined,{id:'ledger-group-bulk-dialog'});if(theme)host.dataset.ledgerTheme=theme;document.body.append(host);
    const shadow=root(host),dialog=el('dialog',undefined,{'aria-label':'Add multiple channels'}),note=el('p','Loading channels…',{class:'status',role:'status'});
    dialog.style.width='min(640px,calc(100vw - 28px))';dialog.append(el('h3','Add multiple channels'),note);shadow.append(dialog);modalLifecycle(host,dialog);dialog.showModal();
    let closed=false,busy=false;dialog.addEventListener('close',()=>{closed=true;host.remove();},{once:true});
    try{
      const state=await request({type:'channelGroups:get'});if(closed)return;
      const choices=new Map(Object.values(state.channels).map(c=>[c.url,{...c,input:c.url}])),picked=new Set(),list=el('div'),destinations=el('div');
      list.style.maxHeight='240px';list.style.overflow='auto';
      function scan(){
        for(const link of document.querySelectorAll('ytd-channel-renderer a[href],ytd-guide-entry-renderer a[href]')){
          let url;try{url=new URL(link.href);}catch{continue;}
          if(url.origin!=='https://www.youtube.com'||!/^\/(?:channel\/UC[\w-]{22}|@[^/]+)(?:\/|$)/.test(url.pathname))continue;
          const path=url.pathname.split('/').slice(0,url.pathname.startsWith('/channel/')?3:2).join('/'),input=url.origin+path,name=link.getAttribute('title')||link.querySelector('#text')?.textContent?.trim()||link.textContent?.trim();
          if(name&&!choices.has(input)&&choices.size<2000)choices.set(input,{input,name:name.slice(0,200),...(path.startsWith('/channel/')?{id:path.split('/')[2],url:input}:{})});
        }renderChoices();
      }
      function renderChoices(){
        list.replaceChildren();for(const [key,c] of choices){const label=el('label',undefined,{class:'membership'}),check=el('input',undefined,{type:'checkbox'});check.checked=picked.has(key);check.addEventListener('change',()=>check.checked?picked.add(key):picked.delete(key));label.append(check,el('span',c.name));list.append(label);}
      }
      const scanButton=button('Scan loaded channels',scan),browse=button('Browse subscriptions',()=>request({type:'channelGroups:subscriptions'}).catch(e=>status(note,e.message,true)));
      const tools=el('div',undefined,{class:'row'});tools.append(scanButton,browse);
      const paste=el('textarea',undefined,{'aria-label':'Channel addresses',placeholder:'Paste channel URLs or @handles, one per line',rows:'4'});paste.style.cssText='box-sizing:border-box;width:100%;margin:12px 0;padding:12px;background:var(--field-bg);color:inherit;border:1px solid var(--field-border);border-radius:8px;font:inherit';
      for(const group of state.groups){const label=el('label',undefined,{class:'membership'}),check=el('input',undefined,{type:'checkbox',value:group.id});check.checked=group.id===groupId;label.append(check,GroupIcons.create(group.icon),el('span',group.name));destinations.append(label);}
      const save=button('Add selected channels',async()=>{
        if(busy)return;const groupIds=[...destinations.querySelectorAll('input:checked')].map(c=>c.value),inputs=[...new Set([...picked,...paste.value.split(/\n/).map(s=>s.trim()).filter(Boolean)])];
        if(!inputs.length||inputs.length>2000||!groupIds.length){status(note,'Choose channels and at least one group. Up to 2,000 channels can be added at once.',true);return;}
        busy=true;for(const c of dialog.querySelectorAll('button,input,textarea'))c.disabled=true;
        try{
          let index=0,complete=0;const channels=new Array(inputs.length),errors=[];
          await Promise.all(Array.from({length:Math.min(4,inputs.length)},async()=>{while(index<inputs.length&&!closed){const i=index++,known=choices.get(inputs[i]);try{channels[i]=known?.id?{id:known.id,name:known.name,url:known.url}:await request({type:'channelGroups:resolve',input:inputs[i]});}catch(e){errors.push(inputs[i]+': '+e.message);}status(note,'Finding channels '+(++complete)+' / '+inputs.length+'…');}}));
          if(closed)return;if(errors.length)throw new Error('Nothing added. Check these addresses: '+errors.join(' · '));
          await request({type:'channelGroups:change',action:'bulk',channels,groupIds});status(note,'Added '+new Set(channels.map(c=>c.id)).size+' channels to '+groupIds.length+' groups.');picked.clear();paste.value='';renderChoices();
        }catch(e){status(note,e.message,true);}finally{busy=false;for(const c of dialog.querySelectorAll('button,input,textarea'))c.disabled=false;}
      },'primary');
      const actions=el('div',undefined,{class:'row space'});actions.append(save,button('Done',()=>dialog.close()));
      dialog.replaceChildren(el('h3','Add multiple channels'),el('p','Choose saved channels or channels currently loaded on this YouTube page. Scroll the subscriptions page to load more, then scan again.',{class:'muted'}),tools,list,paste,el('h3','Add to groups'),destinations,actions,note);scan();status(note,state.groups.length?'Your YouTube subscriptions stay as they are.':'Create a group first, then return here.');
    }catch(e){status(note,e.message,true);dialog.append(button('Close',()=>dialog.close()));}
  }
  return {manager,picker,editIcon,manageGroup,bulk,themeCss,shareGroup:(id,theme,onClose)=>shareGroups('Share',id,theme,onClose,true)};
})();
