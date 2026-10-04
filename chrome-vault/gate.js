/* Unlock before loading any code that reads or renders the saved profile. */
(() => {
  const companionAvailable = (chrome.runtime.getManifest().optional_permissions || []).includes('nativeMessaging');
  const entry = document.createElement('section'); entry.id = 'vault-entry';
  entry.innerHTML = '<div class="vault-brand"><img src="icons/icon-128.png" alt="">YouTube Ledger</div><h1 id="vault-heading">Opening Ledger…</h1><p id="vault-explainer"></p><form id="vault-form" hidden><label for="vault-secret">Passphrase</label><input id="vault-secret" type="password" autocomplete="current-password" maxlength="1024" required><div id="vault-confirm-row" hidden><label for="vault-confirm">Confirm passphrase</label><input id="vault-confirm" type="password" autocomplete="new-password" maxlength="1024"></div><label id="vault-recovery-row"><input id="vault-recovery" type="checkbox"> Use my recovery key</label><button id="vault-submit">Unlock Ledger</button></form><div id="vault-key" hidden><p>Save this recovery key somewhere private, separate from this browser. It can unlock your encrypted history if you forget your passphrase.</p><textarea id="vault-key-value" rows="3" readonly aria-label="Recovery key"></textarea><label><input id="vault-key-saved" type="checkbox"> I saved my recovery key</label><button id="vault-continue" disabled>Continue to Ledger</button></div><p id="vault-message" class="vault-error" role="status"></p><small>Saved data stays encrypted on this computer. Unlock once after restarting Chrome or reloading the extension. Ledger has no account or password-reset service.</small>';
  document.body.append(entry);
  const browserRow = document.createElement('div'); browserRow.className = 'vault-access-choice';
  browserRow.innerHTML = '<label><input id="vault-browser-remember" type="checkbox" aria-describedby="vault-browser-help"> Open automatically in this browser</label><p id="vault-browser-help">No extra app or password prompt after restarting Chrome. Anyone who can use or copy this browser profile may be able to open your Ledger. Leave this off to require your passphrase each session.</p>';
  entry.querySelector('#vault-submit').before(browserRow);
  const rememberRow = document.createElement('details'); rememberRow.id = 'vault-remember-row'; rememberRow.hidden = true;
  rememberRow.innerHTML = '<summary>Already use the Ledger companion?</summary><label><input id="vault-remember" type="checkbox"> Remember on this computer</label><small>Optional: use Windows Data Protection or macOS Keychain to protect the remembered key. Requires the separately installed companion. Anyone using your signed-in computer account can open Ledger.</small>';
  entry.querySelector('#vault-submit').before(rememberRow);
  entry.querySelector(':scope > small').textContent = 'No Ledger account or subscription. Keep your passphrase and recovery key for backups.' + (companionAvailable ? ' Sync is optional and can be set up later.' : '');
  const element = id => document.getElementById(id);
  let loading = false;
  const request = message => browser.runtime.sendMessage(message);
  async function showLedger() {
    if (loading) return; loading = true;
    for (const source of JSON.parse(document.getElementById('vault-scripts').textContent)) {
      await new Promise((resolve,reject) => {
        const script = document.createElement('script'); script.src = source; script.onload = resolve;
        script.onerror = () => reject(Error('Ledger could not load. Reload this page to retry.')); document.body.append(script);
      });
    }
    document.dispatchEvent(new Event('ledger:dashboard-ready'));
    document.documentElement.classList.remove('vault-locked'); entry.remove();
    installTools();
  }
  async function start() {
    const state = await request({type:'vault:status'});
    if (state.unlocked) return showLedger();
    rememberRow.hidden = !companionAvailable || !['mac','win'].includes((await chrome.runtime.getPlatformInfo()).os);
    element('vault-remember').checked = companionAvailable && state.remembered;
    rememberRow.open = companionAvailable && state.remembered;
    element('vault-browser-remember').checked = state.browserUnlock;
    element('vault-browser-remember').onchange = () => {if(element('vault-browser-remember').checked) element('vault-remember').checked = false;};
    element('vault-remember').onchange = () => {if(element('vault-remember').checked) element('vault-browser-remember').checked = false;};
    if (state.rememberError || state.browserUnlockError || state.sessionUnlockError) element('vault-message').textContent = state.rememberError || state.browserUnlockError || state.sessionUnlockError;
    element('vault-heading').textContent = state.configured ? 'Unlock your Ledger' : 'Welcome to Ledger';
    element('vault-explainer').textContent = state.configured
      ? (state.paused ? 'Tracking is paused. Unlock to view your history and change your settings.' : 'New viewing is being saved in encrypted form. Unlock to view your history and use your groups.' + (companionAvailable ? ' Browser sync resumes after unlocking.' : ''))
      : 'First, choose a passphrase for your saved history and backups. Use at least 12 characters. Next, you’ll choose what to track and check your YouTube connection.';
    if (state.migrationPending) element('vault-explainer').textContent = 'Your encrypted copy was saved, but migration needs to finish. Unlock with the passphrase you chose so Ledger can verify it and remove the old readable records.';
    if (state.pendingBatches) element('vault-explainer').textContent += state.pendingBytes >= state.inboxLimit * .9
      ? ' The encrypted recording inbox is almost full. Unlock now to make room for more viewing.'
      : ' You have new viewing ready to add to your history.';
    element('vault-form').hidden = false; element('vault-confirm-row').hidden = state.configured;
    element('vault-recovery-row').hidden = !state.configured;
    element('vault-confirm').required = !state.configured;
    element('vault-secret').minLength = state.configured ? 1 : 12;
    element('vault-secret').autocomplete = state.configured ? 'current-password' : 'new-password';
    element('vault-submit').textContent = state.configured ? 'Unlock Ledger' : 'Continue';
    element('vault-secret').focus();
    element('vault-recovery').onchange = () => {entry.querySelector('label[for="vault-secret"]').textContent = element('vault-recovery').checked ? 'Recovery key' : 'Passphrase';};
    element('vault-form').onsubmit = async event => {
      event.preventDefault(); const button = element('vault-submit'); button.disabled = true;
      element('vault-message').textContent = state.configured ? 'Unlocking and organizing saved viewing…' : 'Encrypting your Ledger…';
      try {
        // Request permission in the click's user-gesture turn, before any work.
        const remember = companionAvailable && element('vault-remember').checked;
        if (remember && !(await browser.permissions.request({permissions:['nativeMessaging']}))) throw Error('Companion permission was not allowed. Uncheck Remember on this computer to unlock for this session.');
        const secret = element('vault-secret').value;
        if (!state.configured && secret !== element('vault-confirm').value) throw Error('The passphrases do not match.');
        const result = await request({type:state.configured ? 'vault:unlock' : 'vault:create',secret,recovery:element('vault-recovery').checked});
        element('vault-secret').value = ''; element('vault-confirm').value = ''; element('vault-message').textContent = '';
        let rememberWarning = '';
        if (remember) {
          try {await request({type:'vault:remember',enabled:true});}
          catch (error) {rememberWarning = error.message + ' Ledger is unlocked for this session.';}
        }
        else if (companionAvailable && state.remembered) rememberWarning = (await request({type:'vault:remember',enabled:false})).warning || '';
        try {
          const enabled = element('vault-browser-remember').checked;
          if (enabled || state.browserUnlock) await request({type:'vault:browserUnlock',enabled,secret,recovery:element('vault-recovery').checked});
        } catch(error) {rememberWarning += ' ' + error.message + ' Check automatic access in Settings.';}
        if (rememberWarning) element('vault-message').textContent = rememberWarning;
        if (result.recoveryKey) {
          element('vault-form').hidden = true; element('vault-heading').textContent = 'Save your recovery key';
          element('vault-explainer').textContent = 'Your Ledger is encrypted. This key is shown only here.';
          element('vault-key').hidden = false; element('vault-key-value').value = result.recoveryKey;
          element('vault-key-saved').onchange = () => {element('vault-continue').disabled = !element('vault-key-saved').checked;};
          element('vault-continue').onclick = () => showLedger().catch(error => {element('vault-message').textContent = error.message;});
        } else if (rememberWarning) {
          element('vault-form').hidden = true;
          const continueButton = document.createElement('button'); continueButton.type = 'button'; continueButton.textContent = 'Continue to Ledger';
          continueButton.onclick = () => showLedger().catch(error => {element('vault-message').textContent = error.message;});
          element('vault-message').after(continueButton);
        } else await showLedger();
      } catch (error) {
        element('vault-message').textContent = error.message;
        if (!state.configured && (await request({type:'vault:status'}).catch(()=>null))?.configured) await start();
      }
      finally {button.disabled = false;}
    };
  }
  function confirmBrowserAccess() {
    return new Promise((resolve,reject) => {
      const dialog = document.createElement('dialog'); dialog.className = 'vault-dialog';
      dialog.innerHTML = '<h2>Open automatically in this browser?</h2><p>Ledger will save an unlock key in this browser profile. You won’t need an extra app or a passphrase after restarting Chrome.</p><p>Anyone who can use or copy this browser profile may be able to open your history and notes. This does not provide the same protection as keeping the key outside the browser profile.</p><div class="actions"><button type="button" data-accept>Enable automatic access</button><button type="button" class="secondary" data-cancel>Cancel</button></div>';
      const finish = accepted => {dialog.close(); dialog.remove(); accepted ? resolve() : reject(Error('Canceled.'));};
      dialog.querySelector('[data-accept]').onclick = () => finish(true);
      dialog.querySelector('[data-cancel]').onclick = () => finish(false);
      dialog.addEventListener('cancel',event => {event.preventDefault();finish(false);});
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').focus();
    });
  }
  function askSecret(title, changing = false) {
    return new Promise((resolve,reject) => {
      const dialog = document.createElement('dialog'); dialog.className = 'vault-dialog';
      dialog.innerHTML = '<form><h2></h2><label>Passphrase <input name="secret" type="password" autocomplete="current-password" required maxlength="1024"></label><label><input name="recovery" type="checkbox"> Use a recovery key instead</label>' +
        (changing ? '<label>New passphrase <input name="next" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label><label>Confirm new passphrase <input name="confirm" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label>' : '') +
        '<button type="submit">Continue</button> <button type="button" class="secondary">Cancel</button><p role="status"></p></form>';
      dialog.querySelector('h2').textContent = title;
      const cancel = () => {dialog.close(); dialog.remove(); reject(Error('Canceled.'));};
      dialog.addEventListener('cancel', event => {event.preventDefault(); cancel();});
      dialog.querySelector('button[type=button]').onclick = cancel;
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault(); const fields = event.target.elements;
        if (changing && fields.next.value !== fields.confirm.value) {dialog.querySelector('[role=status]').textContent = 'The new passphrases do not match.'; return;}
        const result = {secret:fields.secret.value,recovery:fields.recovery.checked,...(changing ? {next:fields.next.value} : {})};
        dialog.close(); dialog.remove(); resolve(result);
      };
      document.body.append(dialog); dialog.showModal();
    });
  }
  globalThis.LedgerChromeVaultUI = {
    async openBackup(backup) {
      if (backup?.format !== 'ledger-encrypted-profile') return backup;
      try {return await request({type:'vault:openBackup',backup});}
      catch {const secret = await askSecret('Unlock this backup'); return request({type:'vault:openBackup',backup,...secret});}
    }
  };
  function installTools() {
    const tools = document.createElement('div'); tools.className = 'vault-tools';
    tools.innerHTML = '<h3>Access to your Ledger</h3><p data-unlock-status></p><div class="vault-browser-tools"><button type="button" class="secondary" data-browser-remember>Open automatically in this browser</button><p>No extra app needed. Anyone who can use or copy this browser profile may be able to open Ledger. Passphrase-only access keeps the unlock key out of the saved browser profile.</p></div><div class="actions"><button type="button" class="secondary" data-password>Change passphrase</button><button type="button" class="secondary" data-recovery>Replace recovery key</button></div><details class="vault-remember-tools" hidden><summary>Use the optional companion for remembered access</summary><p>The local Ledger companion can unlock Ledger after Chrome restarts. Windows Data Protection or macOS Keychain protects the unlock key. Anyone using your signed-in computer account can open Ledger.</p><button type="button" class="secondary" data-remember>Remember on this computer</button><a href="https://github.com/cabe9/youtube-ledger#local-browser-sync" target="_blank" rel="noreferrer">Companion setup</a></details><span role="status"></span>';
    document.getElementById('data-controls').prepend(tools);
    let remembered = false, browserUnlock = false;
    const updateRemember = async () => {
      const state = await request({type:'vault:status'}); remembered = companionAvailable && state.remembered; browserUnlock = state.browserUnlock;
      tools.querySelector('[data-unlock-status]').textContent = browserUnlock ? 'Opens automatically using a key saved in this browser profile.' : remembered ? 'Opens automatically using the companion’s protected key store.' : 'Passphrase required after restarting Chrome. New viewing can still be recorded while locked.';
      tools.querySelector('[data-browser-remember]').textContent = browserUnlock ? 'Require a passphrase after restart' : 'Open automatically in this browser';
      tools.querySelector('[data-remember]').textContent = remembered ? 'Forget this computer' : 'Remember on this computer';
      tools.querySelector('.vault-remember-tools').hidden = !companionAvailable || !['mac','win'].includes((await chrome.runtime.getPlatformInfo()).os);
    };
    void updateRemember().catch(error => {tools.querySelector('[role=status]').textContent = error.message;});
    tools.querySelector('[data-browser-remember]').onclick = async event => {
      const button = event.currentTarget, status = tools.querySelector('[role=status]'); button.disabled = true;
      try {
        let values = {};
        if (browserUnlock) values = await askSecret('Confirm your passphrase before turning off automatic access');
        else await confirmBrowserAccess();
        let warning = '';
        // Remove native auto-unlock too when requesting passphrase-only access.
        if (remembered) warning = (await request({type:'vault:remember',enabled:false})).warning || '';
        await request({type:'vault:browserUnlock',enabled:!browserUnlock,...values});
        status.textContent = warning || (browserUnlock ? 'Ledger will ask for your passphrase after the next restart.' : 'Ledger will open automatically in this browser. Keep your recovery key for backups.');
        await updateRemember();
      } catch (error) {status.textContent = error.message; await updateRemember();}
      finally {button.disabled = false;}
    };
    tools.querySelector('[data-remember]').onclick = async event => {
      const button = event.currentTarget, status = tools.querySelector('[role=status]'); button.disabled = true;
      try {
        if (!remembered && !(await browser.permissions.request({permissions:['nativeMessaging']}))) throw Error('Companion permission was not allowed. Ledger stays unlocked for this session.');
        let values;
        if (!remembered) {values = await askSecret('Confirm your passphrase to remember this computer'); await request({type:'vault:unlock',...values});}
        const result = await request({type:'vault:remember',enabled:!remembered});
        if (result.remembered && browserUnlock) {
          // The user just confirmed a working credential above. The worker will
          // verify it again before deleting the browser key.
          await request({type:'vault:browserUnlock',enabled:false,...values});
        }
        status.textContent = result.warning || (result.remembered ? 'This computer will unlock Ledger automatically. Keep your passphrase and recovery key for backups.' : 'This computer is forgotten. Ledger will ask you to unlock after the next restart.');
        await updateRemember();
      } catch (error) {status.textContent = error.message;}
      finally {button.disabled = false;}
    };
    tools.querySelector('[data-password]').onclick = async () => {
      const status = tools.querySelector('[role=status]');
      try {const values = await askSecret('Change your passphrase',true); await request({type:'vault:password',...values}); status.textContent = 'Passphrase changed. Existing backups still use their original passphrase; your recovery key is unchanged.';}
      catch (error) {status.textContent = error.message;}
    };
    tools.querySelector('[data-recovery]').onclick = async () => {
      const status = tools.querySelector('[role=status]');
      try {
        const values = await askSecret('Confirm before replacing your recovery key');
        const result = await request({type:'vault:recovery',...values}), dialog = document.createElement('dialog'); dialog.className = 'vault-dialog';
        dialog.innerHTML = '<h2>Save your new recovery key</h2><p>This key replaces the previous key for this browser. Keep older keys for backups exported before this change.</p><textarea rows="3" readonly aria-label="New recovery key"></textarea><button type="button">I saved this key</button>';
        dialog.querySelector('textarea').value = result.recoveryKey;
        const finish = () => {dialog.close(); dialog.remove();};
        dialog.querySelector('button').onclick = finish; dialog.addEventListener('cancel',event=>{event.preventDefault();});
        document.body.append(dialog); dialog.showModal(); status.textContent = 'Recovery key replaced.';
      } catch (error) {status.textContent = error.message;}
    };
  }
  start().catch(error => {element('vault-heading').textContent = 'Ledger needs attention'; element('vault-message').textContent = error.message;});
})();
