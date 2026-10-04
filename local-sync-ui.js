(()=>{
 const section=document.createElement('section');section.className='settings-block';section.id='local-sync';
 section.innerHTML=`<h3>Sync Chrome and Firefox</h3>
 <p>Optional: keep your Ledger data together across browsers on this computer. Ledger works on its own without sync, a companion or an account.</p>
 <p id="local-sync-status" role="status">Checking sync…</p>
 <details id="local-sync-setup"><summary>Set up optional browser sync</summary>
 <p><strong>1. Install the optional companion</strong></p><p>Sync needs Ledger in both browsers and the local companion on this computer. It shares your groups, history, notes, watch status and activity only after you pair the browsers.</p>
 <details><summary>Companion availability and setup</summary><p>Public companion installers are not available yet. If you already installed the testing companion, you can pair your browsers below.</p><a href="https://github.com/cabe9/youtube-ledger#local-browser-sync" target="_blank" rel="noreferrer">Testing companion instructions</a><p>Nothing is uploaded to a cloud service. You can also move a profile using Backup and transfer.</p></details>
 <p><strong>2. Choose this browser’s role</strong></p>
 <div class="sync-choices"><button id="local-sync-start" type="button" class="secondary" aria-pressed="true">Start here</button><button id="local-sync-join" type="button" class="secondary" aria-pressed="false">I have a pairing code</button></div>
 <p id="local-sync-help">Start in either browser. Then copy its pairing code to Ledger in your other browser.</p>
 <div id="local-sync-entry" hidden><label for="local-sync-code">Pairing code from your other browser</label><input id="local-sync-code" type="password" autocomplete="off" spellcheck="false" placeholder="Paste pairing code"></div>
 <button id="local-sync-enable" type="button">Start syncing in this browser</button>
 <p class="note">Firefox asks for permission to share browsing activity, website content and activity, and technical and interaction data; Chrome asks for companion access. Declining keeps sync off and leaves your local records available. Ledger downloads a recovery backup before merging. Deletions also sync; choose compatible history retention periods in both browsers.</p>
 </details>
 <div id="local-sync-connected" hidden><p>To connect another browser, open its Ledger Settings, choose “I have a pairing code,” and paste the code from here.</p>
 <div class="actions"><button id="local-sync-show" type="button">Show pairing code</button><button id="local-sync-now" type="button" class="secondary">Sync now</button><button id="local-sync-stop" type="button" class="secondary">Disconnect this browser</button></div>
 <div id="local-sync-share" hidden><label for="local-sync-share-code">Your pairing code</label><input id="local-sync-share-code" type="text" readonly><p class="note">Copy this into your other browser. Keep it private: it unlocks your shared profile.</p></div></div>
 <details class="sync-details"><summary>What syncs and what stays separate?</summary><p>Groups, history, notes, watch status, purpose labels, recommendation events, group browsing preferences and cached uploads sync. Tracking, permissions, theme and retention settings stay separate.</p><p>The companion stores an encrypted copy. Each browser keeps its usual local data. If offline edits conflict, an alternate version is available to download. Disconnecting keeps local data and the companion copy.</p></details>
 <button id="local-sync-conflicts" class="secondary" type="button" hidden>Download conflicting versions</button>
 <p id="local-sync-message" role="status"></p>`;
 document.getElementById('data-controls').before(section);
 const el=id=>document.getElementById('local-sync-'+id),send=(action,extra={})=>browser.runtime.sendMessage({type:'localSync:'+action,...extra}).then(r=>{if(r?.error)throw Error(r.error);return r;});
 let joining=false,busy=false;
 function choose(value){el('message').textContent='';joining=value;el('entry').hidden=!value;el('start').setAttribute('aria-pressed',String(!value));el('join').setAttribute('aria-pressed',String(value));el('enable').textContent=value?'Connect this browser':'Start syncing in this browser';el('help').textContent=value?'In your connected browser, open Ledger Settings and choose Show pairing code.':'Start in either browser. Then copy its pairing code to Ledger in your other browser.';}
 el('start').onclick=()=>choose(false);el('join').onclick=()=>choose(true);
 function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function refresh(){const s=await send('status');el('status').textContent=s.enabled?(s.error?'Sync needs attention: '+s.error:s.lastSync?'Last synced '+new Date(s.lastSync).toLocaleString(): 'Waiting for first sync.'):s.needsPermission?'Sync is paused until you allow the updated permissions.':s.error?'Sync is off. '+s.error:'Sync is off.';el('setup').hidden=s.enabled;el('connected').hidden=!s.enabled;el('now').disabled=!s.enabled||busy;el('stop').disabled=!s.enabled;el('show').disabled=!s.enabled;el('conflicts').hidden=!s.conflicts;if(s.conflicts)el('message').textContent=s.conflicts+' conflicting versions are preserved. Download them before resolving differences.';}
 async function act(fn){if(busy)return;busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);try{el('message').textContent='';await fn();await refresh();}catch(e){el('message').textContent=e.message;await refresh().catch(()=>{});}finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);await refresh().catch(()=>{});}}
 el('enable').onclick=()=>act(async()=>{
   if(joining&&!el('code').value.trim())throw Error('Paste the pairing code from your connected browser first.');
   if(!await browser.permissions.request(LedgerConnections.syncPermissions()))throw Error('Sync permission was not granted. Your local records remain available.');
   await settingsSaveQueue;
   await globalThis.LedgerNotesUI?.flush();
   const backup=await browser.runtime.sendMessage({type:'backup:export'});if(backup?.error||!backup?.data)throw Error(backup?.error||'Could not create recovery backup.');
   download('ledger-before-sync-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',backup);
   await send('enable',{code:joining?el('code').value.trim():''});el('code').value='';el('code').type='password';
 });
 el('now').onclick=()=>act(()=>send('run'));
 el('show').onclick=()=>act(async()=>{const r=await send('code');el('share-code').value=r.code;el('share').hidden=false;el('share-code').select();el('message').textContent='Paste this code into Ledger Settings in your other browser. Keep it private: it unlocks the shared profile.';});
 el('stop').onclick=()=>act(async()=>{await send('disable');el('share-code').value='';el('share').hidden=true;choose(false);});
 el('conflicts').onclick=()=>act(async()=>download('ledger-sync-conflicts.json',await send('conflicts')));
 browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes['localSync:v1'])void refresh().catch(()=>{});});
 void refresh().catch(e=>{el('status').textContent=e.message;});
})();
