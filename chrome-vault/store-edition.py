"""First public Chrome edition: browser-only; keep companion development separate."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OMITTED = {'sync-model.js', 'local-sync.js', 'local-sync-ui.js'}


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Store transform no longer matches source: ' + before[:100])
    return text.replace(before, after, 1)


def prepare(files):
    files = {name: content for name, content in files.items() if name not in OMITTED}
    manifest = json.loads(files['manifest.json'])
    manifest['name'] = 'YouTube Ledger'
    manifest['description'] = 'Understand your YouTube viewing with local history, channel groups, notes and recommendation controls.'
    manifest.pop('optional_permissions', None)
    manifest['content_security_policy'] = {
        'extension_pages': "script-src 'self'; object-src 'none'; base-uri 'none'"
    }
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()

    html = files['dashboard.html'].decode()
    html = replace_once(html, ', "local-sync-ui.js"', '')
    html = replace_once(html,
        'With sync enabled, history deletions and watch-status resets also reach paired browsers. Deleting all Ledger data disconnects this browser and reloads it with tracking off; paired browsers and the companion copy remain.',
        'Deleting all Ledger data removes automatic browser access and reloads Ledger with tracking off. Your passphrase and recovery key still open the empty profile.')
    files['dashboard.html'] = html.encode()
    controls = files['data-controls-ui.js'].decode()
    for sentence in [
        ' With local sync enabled, these deletions also reach paired browsers.',
        ' With local sync enabled, this deletion also reaches paired browsers.',
        ' With local sync enabled, watch-status changes also reach paired browsers.',
    ]:
        if sentence not in controls:
            raise ValueError('Missing sync disclosure in data controls: ' + sentence)
        controls = controls.replace(sentence, '')
    controls = replace_once(controls,
        'This disconnects only this browser; paired browsers and the companion copy remain.',
        'Automatic browser access is removed; your passphrase and recovery key still open the empty profile.')
    files['data-controls-ui.js'] = controls.encode()
    settings = files['settings.js'].decode()
    settings = replace_once(settings, "['data','Sync & data','Browsers, backups and storage']",
                            "['data','Your data','Access, backups and storage']")
    settings = replace_once(settings, "panels.get('data').append(backup,storage,sync);",
                            "panels.get('data').append(backup,storage);")
    files['settings.js'] = settings.encode()
    backup = files['backup-ui.js'].decode()
    backup = backup.replace('the Chrome Preview', 'YouTube Ledger for Chrome')
    backup = replace_once(backup, ' Local companion sync still works after unlocking.', '')
    files['backup-ui.js'] = backup.encode()

    # Exclude native host calls entirely, not just the visible setup controls.
    worker = files['vault-worker.js'].decode()
    start = worker.index("  let rememberError = '';\n")
    end = worker.index('  let draining;\n', start)
    worker = worker[:start] + """  const rememberError = '';
  const started = Promise.all([nativeLocal.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    api.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}), vault.init()]);
""" + worker[end:]
    worker = replace_once(worker, 'await rememberDevice(false);', 'await vault.setDevice(null);')
    start = worker.index("    if (message?.type === 'vault:remember') {")
    end = worker.index("    if (message?.type === 'vault:browserUnlock') {", start)
    worker = worker[:start] + """    if (message?.type === 'vault:remember' || message?.type?.startsWith('localSync:')) {
      throw Error('The local companion is not included in this release.');
    }
""" + worker[end:]
    worker = replace_once(worker, "'sync-model.js','local-sync.js',", '')
    worker = worker.replace('saved groups, watch status and sync.', 'saved groups and watch status.')
    files['vault-worker.js'] = worker.encode()
    background = files['background.js'].decode()
    background = replace_once(background, 'globalThis.LedgerLocalSync?.start();', '')
    background = replace_once(background,
        "  if(message?.type?.startsWith('localSync:'))return LedgerLocalSync.handle(message,sender).catch(error=>({error:String(error.message||error)}));", '')
    files['background.js'] = background.encode()
    # This is also the exact file intended for the separately hosted Chrome URL.
    files['docs/privacy.html'] = (ROOT / 'docs/privacy-chrome.html').read_text(encoding='utf-8').encode('utf-8')
    return files
