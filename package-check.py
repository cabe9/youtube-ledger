"""Verify the store exclusion boundary in actual ZIPs and unpacked outputs."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ledger_build', ROOT / 'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
version = json.loads((ROOT / 'manifest.json').read_text())['version']
forbidden = re.compile(rb'account[-_ ]?history|cross[-_ ]?device|myactivity\.google|history-parser|EXPERIMENTAL', re.I)
subprocess.run([sys.executable, str(ROOT / 'build.py'), '--channel', 'experimental'], check=True)

# A dirty old output must never leak files into the clean default build.
for browser in ['chrome', 'firefox']:
    folder = ROOT / 'dist' / browser
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'account-history-stale.js').write_text('stale experiment sentinel')
    (folder / 'private-export.json').write_text('{}')
subprocess.run([sys.executable, str(ROOT / 'build.py')], check=True)
for browser in ['chrome', 'firefox']:
    archive = ROOT / f'youtube-ledger-{browser}-store-{version}.zip'
    expected = set(builder.FILES) | {'manifest.json', 'INSTALL.txt'}
    if browser == 'chrome': expected.add('service-worker.js')
    with ZipFile(archive) as package:
        assert set(package.namelist()) == expected, 'Store archive allowlist mismatch'
        manifest = json.loads(package.read('manifest.json'))
        assert manifest['name'] == 'YouTube Ledger'
        if browser == 'firefox':
            assert manifest['background']['scripts'].index('youtube-requests.js') < manifest['background']['scripts'].index('channel-groups.js')
        else:
            assert package.read('service-worker.js').index(b"'youtube-requests.js'") < package.read('service-worker.js').index(b"'channel-groups.js'")
        assert manifest['permissions'] == ['storage']
        assert not manifest.get('optional_permissions') and not manifest.get('optional_host_permissions')
        assert manifest['host_permissions'] == ['https://www.youtube.com/*', 'https://m.youtube.com/*']
        for name in package.namelist():
            assert not forbidden.search(name.encode()), name
            if Path(name).suffix in {'.js','.html','.css','.json','.txt','.md'}:
                assert not forbidden.search(package.read(name)), 'Forbidden reference in ' + name
            assert package.read(name) == (ROOT / 'dist' / browser / name).read_bytes()
        actual = {str(p.relative_to(ROOT/'dist'/browser)) for p in (ROOT/'dist'/browser).rglob('*') if p.is_file()}
        assert actual == expected, 'Stale file in unpacked store output'
# Public policy and entry page are not experimental distribution channels.
for name in ['docs/privacy.html', 'docs/index.html']:
    assert not forbidden.search((ROOT / name).read_bytes()), name
for browser in ['chrome','firefox']:
    archive = ROOT / f'youtube-ledger-{browser}-experimental-{version}.zip'
    with ZipFile(archive) as package:
        manifest = json.loads(package.read('manifest.json'))
        assert manifest['name'] == 'YouTube Ledger Experimental'
        assert manifest['optional_host_permissions'] == ['https://myactivity.google.com/*']
        assert 'scripting' not in manifest.get('permissions', []) + manifest.get('optional_permissions', [])
        assert 'EXPERIMENTAL.md' in package.namelist()
        assert 'account-history-source.js' in package.namelist()
        assert ('offscreen' in manifest['permissions']) == (browser == 'chrome')
        assert set(package.namelist()).isdisjoint({'integration.patch','build.py','README.md','account-history.test.cjs'})
        for name in ['core.js','content.js','settings.js','dashboard.css','frutiger-aero.css','recommendations.js']:
            assert package.read(name) == (ROOT / name).read_bytes(), 'Direct tracking or shared UI changed: ' + name
print('Package checks passed: store ZIPs and folders contain no experiment or stale files; public policy is clean; experimental manifests and unchanged shared code verified.')
