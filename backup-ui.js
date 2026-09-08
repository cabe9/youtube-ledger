(()=>{
  const section=document.createElement('section');section.className='settings-block';
  section.innerHTML='<h3>Profile backup and transfer</h3><p>Copy your Ledger profile between Firefox and Chrome. Your groups, images and GIFs, settings, watch history, watch state, labels and notes travel together in one file.</p><p>Export your profile here, then open Ledger Settings in the other browser and import that file. Exporting keeps your profile in this browser.</p><button type="button" id="backup-export">Export profile</button> <button type="button" id="backup-pick">Import profile</button><input type="file" id="backup-file" accept=".json,application/json" hidden><p id="backup-status" role="status"></p><div id="backup-preview" hidden><p id="backup-file-info" style="overflow-wrap:anywhere"></p><p id="backup-summary"></p><p>Importing replaces the Ledger profile in this browser; it does not merge histories. Your current profile will download first as a recovery backup. Close YouTube tabs before importing so new playback does not get mixed into the imported history.</p><button type="button" id="backup-restore">Replace with this profile</button> <button type="button" id="backup-cancel">Cancel</button></div>';
  document.querySelector('[data-view="settings"]').append(section);
  let chosen,busy=false,selectionRevision=0;
  const note=$('backup-status'),fileInput=$('backup-file'),preview=$('backup-preview');
  async function request(message){
    const result=await browser.runtime.sendMessage(message);
    if(result?.error)throw new Error(result.error);
    return result;
  }
  function lockControls(){
    busy=true;++selectionRevision;
    const controls=[...document.querySelectorAll('#settings-form input,#settings-form select,#settings-form textarea,#settings-form button'),...section.querySelectorAll('button,input')].map(input=>[input,input.disabled]);
    for(const [input] of controls)input.disabled=true;
    return ()=>{for(const [input,disabled] of controls)input.disabled=disabled;busy=false;};
  }
  async function exportFull(prefix='youtube-ledger-backup'){
    // Include settings changes already submitted before the transfer started.
    await settingsSaveQueue;
    const backup=await request({type:'backup:export'});
    download(prefix+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(backup),'application/json');
  }
  $('backup-export').onclick=async()=>{
    if(busy)return;
    const unlock=lockControls();note.textContent='Preparing your profile…';
    try{await exportFull();note.textContent='Profile exported. In the other browser, open Ledger Settings and choose Import profile.';}
    catch(e){note.textContent=e.message;}
    finally{unlock();}
  };
  $('backup-pick').onclick=()=>{if(!busy)fileInput.click();};
  $('backup-cancel').onclick=()=>{
    if(busy)return;
    ++selectionRevision;chosen=null;preview.hidden=true;note.textContent='';
  };
  fileInput.onchange=async()=>{
    const file=fileInput.files[0];fileInput.value='';
    if(busy)return;
    const revision=++selectionRevision;
    chosen=null;preview.hidden=true;note.textContent='';
    if(!file)return;
    note.textContent='Checking '+file.name+'…';
    const current=()=>revision===selectionRevision&&!busy;
    try{
      if(file.size>100*1024*1024)throw new Error('Choose a backup under 100 MB.');
      const backup=JSON.parse(await file.text());
      if(!current())return;
      const info=await request({type:'backup:preview',backup});
      if(!current())return;
      chosen=backup;$('backup-file-info').textContent=file.name;
      const count=(n,label)=>`${n} ${label}${n===1?'':'s'}`;
      $('backup-summary').textContent=[count(info.groups,'group'),count(info.channels,'channel'),count(info.days,'history day'),count(info.sessions,'session')].join(' · ');
      preview.hidden=false;note.textContent='Profile checked. Review it before importing. Existing Ledger backup files work here too.';
    }catch(e){if(current())note.textContent=e instanceof SyntaxError?'This file is not valid JSON.':e.message;}
  };
  $('backup-restore').onclick=async()=>{
    if(!chosen||busy)return;
    const backup=chosen,unlock=lockControls();note.textContent='Saving your current profile, then importing…';
    try{
      await exportFull('youtube-ledger-before-restore');
      await request({type:'backup:restore',backup});
      chosen=null;preview.hidden=true;note.textContent='Profile imported. Refresh open YouTube and Ledger tabs to use it.';
      const data=await browser.storage.local.get('settings');fillSettings(data.settings);await render();
    }catch(e){note.textContent=e.message;}
    finally{unlock();}
  };
})();
