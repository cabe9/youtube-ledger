"""Explicit, GitHub-only overlay. Never imported by the default store build."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNTIME_FILES = ['account-history.js', 'account-history-parser.js',
                 'account-history-rpc.js', 'account-history-source.js', 'account-history-sync.js',
                 'account-history-ui.js', 'account-history.css']


def apply_overlay(files):
    # Exact-context hunks, without fuzzy matching. Base UI changes must be reviewed
    # here before an experimental package can be built; store builds are independent.
    lines = (HERE / 'integration.patch').read_text().splitlines(keepends=True)
    index = 0
    while index < len(lines):
        if not lines[index].startswith('--- a/'):
            raise ValueError('Invalid experimental patch header')
        name = lines[index][6:].strip()
        index += 1
        if lines[index].strip() != '+++ b/' + name or name not in files:
            raise ValueError('Unknown experimental patch target: ' + name)
        index += 1
        source = files[name].decode()
        while index < len(lines) and lines[index].startswith('@@ '):
            index += 1
            before, after = [], []
            while index < len(lines) and not lines[index].startswith(('@@ ', '--- a/')):
                line = lines[index]
                if line[0] in ' -': before.append(line[1:])
                if line[0] in ' +': after.append(line[1:])
                if line[0] not in ' +-': raise ValueError('Unsupported experimental patch line')
                index += 1
            old, new = ''.join(before), ''.join(after)
            if not old or source.count(old) != 1:
                raise ValueError('Experimental integration needs review: ' + name)
            source = source.replace(old, new, 1)
        files[name] = source.encode()
    return files


def extend(files, manifest, browser):
    apply_overlay(files)
    for name in RUNTIME_FILES:
        files[name] = (HERE / name).read_bytes()
    manifest['name'] = 'YouTube Ledger Experimental'
    manifest['description'] = 'Experimental GitHub build. Local playback tracking and optional account history snapshots.'
    manifest['optional_host_permissions'] = ['https://myactivity.google.com/*']
    if browser == 'chrome':
        manifest['minimum_chrome_version'] = '116'
        manifest['permissions'].append('offscreen')
        for name in ['account-history-offscreen.html', 'account-history-offscreen.js']:
            files[name] = (HERE / name).read_bytes()
    else:
        scripts = manifest['background']['scripts']
        scripts[scripts.index('background.js'):scripts.index('background.js')] = RUNTIME_FILES[:5]
    files['EXPERIMENTAL.md'] = (HERE / 'README.md').read_bytes()
    files['model-notes.md'] = (HERE / 'model-notes.md').read_bytes()
    return files, manifest
