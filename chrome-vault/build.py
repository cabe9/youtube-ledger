"""Build an isolated full-feature Chrome encryption candidate, never overwrite Firefox artifacts."""
import importlib.util
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent

def build(channel='preview'):
    if channel not in {'preview', 'store'}:
        raise ValueError('Unknown Chrome channel')
    spec = importlib.util.spec_from_file_location('ledger_build', ROOT / 'build.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    files = {name: (ROOT / name).read_bytes() for name in source.FILES}
    files['icons/icon-128.png'] = (ROOT / 'chrome-vault/icon-128.png').read_bytes()
    # Recent Chrome builds expose browser.* too. The vault must own its facade,
    # never overwrite the native runtime event object through that alias.
    files['compat.js'] = files['compat.js'].replace(b"if (typeof globalThis.browser === 'undefined')", b'if (true)')
    for name in ['crypto.js', 'store.js', 'idb.js', 'worker.js', 'client.js', 'gate.js', 'gate.css']:
        files['chrome-vault/' + name] = (ROOT / 'chrome-vault' / name).read_bytes()
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest.pop('browser_specific_settings', None)
    manifest.update(name='YouTube Ledger — Chrome Preview', version='0.18.0', minimum_chrome_version='114')
    # Worker URLs resolve relative to the worker directory, so keep its actual
    # entry point at the package root for the original module paths.
    manifest['background'] = {'service_worker': 'vault-worker.js'}
    files['vault-worker.js'] = files.pop('chrome-vault/worker.js')
    manifest['content_scripts'][0]['js'].insert(1, 'chrome-vault/client.js')
    html = files['dashboard.html'].decode()
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    html = re.sub(r'<script src="[^"]+"></script>', '', html)
    html = html.replace('<html', '<html class="vault-locked"', 1)
    html = html.replace('</head>', '<link rel="stylesheet" href="chrome-vault/gate.css"></head>')
    html = html.replace('</body>', '<script id="vault-scripts" type="application/json">' + json.dumps([s for s in scripts if s != 'compat.js']) + '</script><script src="compat.js"></script><script src="chrome-vault/client.js"></script><script src="chrome-vault/gate.js"></script></body>')
    html = html.replace('Records are stored in this browser profile without Ledger-managed encryption. Backups are readable JSON files; keep them somewhere private.',
        'Records and full profile backups are encrypted. Automatic access keeps an unlock key in this browser profile, so anyone who can use or copy the profile may be able to open Ledger. You can require a passphrase instead. Day, period, review-prompt and group-sharing exports are readable files you choose to share; keep them private.')
    html = html.replace('Your local records and exported backups are not encrypted by Ledger.',
        'Your records and full profile backups are encrypted. Automatic access, if enabled, keeps the unlock key in this browser profile. Individual day, review and group exports are readable files.')
    files['dashboard.html'] = html.encode()
    files['settings.js'] = files['settings.js'].replace(b"'DOMContentLoaded'", b"'ledger:dashboard-ready'")
    backup = files['backup-ui.js'].decode().replace('const backup=JSON.parse(await file.text());', 'const backup=await LedgerChromeVaultUI.openBackup(JSON.parse(await file.text()));')
    backup = backup.replace('Copy your Ledger profile between Firefox and Chrome.', 'Save an encrypted copy of your Ledger profile.')
    backup = backup.replace('Export your profile here, then open Ledger Settings in the other browser and import that file. Exporting keeps your profile in this browser.',
        'These encrypted backups open in the Chrome Preview with the passphrase or recovery key used when exported. Older readable Ledger backups can also be imported. Firefox releases do not yet read encrypted Chrome backups. Local companion sync still works after unlocking.')
    backup = backup.replace('Profile exported. In the other browser, open Ledger Settings and choose Import profile.', 'Encrypted profile exported. Keep its passphrase or recovery key separately.')
    files['backup-ui.js'] = backup.encode()
    restore = files['backup.js'].decode()
    start = restore.index('      try{await browser.storage.local.remove(obsolete);')
    end = restore.index('      // A feed refresh', start)
    restore = restore[:start] + '      await browser.storage.local.replace(values,obsolete);\n' + restore[end:]
    files['backup.js'] = restore.encode()
    files['local-sync-ui.js'] = files['local-sync-ui.js'].replace(b'!backup?.data', b"backup?.format!=='ledger-encrypted-profile'")
    policy = files['docs/privacy.html'].decode()
    policy = re.sub(r'<p>Records and preferences are stored using.*?</p>',
        '<p>This Chrome Preview stores records and preferences in an encrypted IndexedDB database in your browser profile. AES-256-GCM encrypts each record; RSA-OAEP protects its random encryption key. A passphrase or recovery key unlocks the saved profile. In passphrase-only mode, Chrome keeps the unlocked key in memory-only extension session storage until the browser restarts or the extension reloads. New viewing can be recorded using the public key while locked. Groups, saved watch status, metadata checks and companion sync resume after unlocking. No record, passphrase or recovery key is sent to the developer.</p>'
        '<p>Open automatically in this browser is a separate, optional choice. It saves a non-extractable Web Crypto private key in this extension’s IndexedDB, alongside the encrypted records. This lets Ledger reopen without an extra app or a passphrase prompt. Non-extractable restricts the Web Crypto export API; it does not guarantee that the browser encrypts that key on disk or protects it against someone copying the browser profile. Anyone who can use or copy that profile may be able to open the records. This mode is not equivalent to passphrase-only access or OS-protected key storage. The browser key and automatic-access preference are excluded from exports and sync. Full profile backups still need their original passphrase or recovery key. Disabling this option removes the saved key after confirming a working recovery credential; deletion is logical, not forensic erasure. Existing installations do not enable it automatically.</p>'
        '<p>Remember on this computer is optional and requires the local Ledger companion and native messaging permission. The companion saves a separate copy of the private unlock key in macOS Keychain or a Windows DPAPI-protected file under the current user’s local application-data folder, scoped to this Chrome extension, vault and a random device identifier. It does not save your passphrase or recovery key. Chrome retrieves that key through local native messaging to reopen your profile after a restart. Anyone using your signed-in computer account can then open Ledger. If the operating system’s protected key store or the companion is unavailable, you can use the passphrase or recovery key. Forget this computer disables automatic unlock and asks the companion to remove that key. A failed removal is reported; uninstalling the extension alone does not erase the protected key. Windows keys use current-user DPAPI, without machine-wide access, and remain separate from the sync database. The Windows cleanup tool can explicitly remove remembered keys without deleting history. This option does not enable browser sync or upload the key to a Ledger service.</p>'
        '<p>Creating the vault migrates existing readable records after verifying their encrypted copies. The readable copies are then logically removed from extension storage. This is not secure erasure of old browser files, device backups or disk remnants. Ledger cannot protect an unlocked browser from someone using it, compromised extension code, malware or operating-system memory capture.</p>'
        '<p>While locked, the encrypted recording inbox is capped at 64 MB. If it fills, recording shows a warning and retries while the YouTube tab stays open. Unlock to organize those recordings into your history. The profile’s pause state, setup-complete flag, random recording generation, vault identity, record counts and sizes are visible without unlocking; viewing details are encrypted.</p>', policy, count=1)
    policy = policy.replace('Per-tab session storage preserves feed searches, scroll positions and an observed video entry point across navigation or reload; entry-point state is cleared when tracking is paused.',
        'This Chrome Preview keeps per-tab feed searches, scroll positions and observed entry points in the content script’s memory, not in YouTube page storage. Reloading the page can lose those navigation hints.')
    policy = policy.replace('Each paired browser stores the key and a readable merge record in its local extension storage.',
        'This Chrome Preview encrypts the pairing key and merge record with the rest of its local profile. Current Firefox releases keep their usual readable local storage; enabling sync does not encrypt the Firefox copy.')
    policy = policy.replace('Encryption of the companion copy does not encrypt your existing browser storage, JSON backups or downloaded conflict files.',
        'The companion’s encryption is separate from the Chrome vault. Downloaded conflict files and explicit review or group-sharing exports are readable.')
    policy = policy.replace('Files can be moved manually between Chrome and Firefox.',
        'Full profile and pre-sync recovery backups from this Chrome Preview are encrypted. They require the passphrase or recovery key used at export time and a compatible Chrome vault build. Older readable Chrome or Firefox backups can be imported and are encrypted locally. Current Firefox releases do not open these encrypted backup files. Day, period, group, diagnostics, conflict and LLM review exports remain readable files created by explicit user actions.')
    policy = policy.replace('companion on your Mac', 'companion on your Windows PC or Mac').replace('stores it in your macOS user account', 'stores the sync copy in your local computer account')
    policy = policy.replace('<h1>Privacy policy</h1>', '<h1>Privacy policy — Chrome encryption preview</h1>')
    files['docs/privacy.html'] = policy.encode()
    # Web sessionStorage belongs to YouTube and can be restored from disk. Keep
    # navigation hints in the content-script closure in this encrypted channel.
    for name in ['watch-source.js','groups-feed.js']:
        text = files[name].decode()
        text = text.replace('sessionStorage.', 'ledgerPageMemory.')
        text = "const ledgerPageMemory = (() => {const values = new Map(); return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};})();\n" + text
        # Each content script needs its own lexical name in the shared isolated world.
        text = text.replace('ledgerPageMemory', 'ledgerPageMemorySource' if name == 'watch-source.js' else 'ledgerPageMemoryFeed')
        files[name] = text.encode()
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    if channel == 'store':
        edition_spec = importlib.util.spec_from_file_location('chrome_store_edition', ROOT / 'chrome-vault/store-edition.py')
        edition = importlib.util.module_from_spec(edition_spec)
        edition_spec.loader.exec_module(edition)
        files = edition.prepare(files)
    # Chrome owns its browser.* alias and may replace it when a worker wakes.
    # Give our storage facade a private name in every bundled first-party script.
    scripts = {name:content.decode() for name,content in files.items()
               if name.endswith('.js') and not name.startswith('vendor/') and name != 'gif-codec.js'}
    renamed = subprocess.run([os.environ.get('LEDGER_NODE', 'node'), str(ROOT / 'chrome-vault/rename-api.cjs')],
                             input=json.dumps(scripts), text=True, check=True, capture_output=True)
    files.update({name:content.encode() for name,content in json.loads(renamed.stdout).items()})
    files['INSTALL.txt'] = 'CHROME PREVIEW 0.18.0 — local testing only, not Store-approved.\nThis same extension folder works on Windows and macOS; no companion is required.\nLoad this separate folder into a disposable Chrome profile. Do not replace your everyday extension yet.\nChoose a passphrase, save its recovery key, then choose what to track and check YouTube access. Refresh existing YouTube tabs if prompted.\nOptional: Open automatically in this browser avoids repeated unlock prompts without installing another app. It keeps a key in this browser profile; anyone who can use or copy that profile may be able to open Ledger. Leave it off for passphrase-only access. Backups still need the passphrase or recovery key.\nCompanion sync and OS-protected remembered access are optional advanced features in Settings. Public companion installers are not yet available.\nExisting protected profiles keep their current access choices. Firefox submission artifacts are unchanged.\n'.encode()
    if channel == 'store':
        files['INSTALL.txt'] = ('YouTube Ledger 0.18.0 — Chrome release candidate, not yet submitted.\n'
            'This extension works without a Ledger account, subscription or companion app.\n'
            'For local testing, use a disposable Chrome profile and load this folder from chrome://extensions.\n'
            'Choose a passphrase and save the recovery key. Automatic browser access is optional; keep it off for passphrase-only protection.\n'
            'Complete the tracking choices, allow YouTube site access and refresh existing YouTube pages if prompted.\n'
            'Chrome backups are encrypted; existing Firefox releases cannot open them. Cross-browser sync is not included in this release.\n'
            'Release status and store materials are outside the extension ZIP. No personal browser data is packaged.\n').encode()
    output = ROOT / ('dist/chrome-preview/0.18.0' if channel == 'preview' else 'dist/chrome-release-candidate/0.18.0/extension')
    if output.exists(): shutil.rmtree(output)
    output.mkdir(parents=True)
    for name, content in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    archive = output.parent / ('youtube-ledger-chrome-preview-0.18.0.zip' if channel == 'preview' else 'youtube-ledger-chrome-0.18.0.zip')
    with ZipFile(archive, 'w', ZIP_DEFLATED) as zipfile:
        for name in sorted(files):
            entry = ZipInfo(name, (2026, 10, 3, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            zipfile.writestr(entry, files[name])
    print(output)
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', choices=['preview', 'store'], default='preview')
    build(parser.parse_args().channel)
