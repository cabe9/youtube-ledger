"""Verify the exact Chrome store artifact, disclosures, allowlist and optional assets."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--with-assets', action='store_true')
args = parser.parse_args()
release = ROOT / 'dist/chrome-release-candidate/0.18.0'
folder = release / 'extension'
spec = importlib.util.spec_from_file_location('ledger_build', ROOT / 'build.py')
standard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(standard)
expected = (set(standard.FILES) - {'local-sync.js', 'local-sync-ui.js', 'sync-model.js'}) | {
    'vault-worker.js', 'manifest.json', 'INSTALL.txt', *['chrome-vault/' + name for name in ['crypto.js', 'store.js', 'idb.js', 'client.js', 'gate.js', 'gate.css']]}
actual = {str(p.relative_to(folder)).replace('\\', '/') for p in folder.rglob('*') if p.is_file()}
assert actual == expected, (actual - expected, expected - actual)
manifest = json.loads((folder / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3 and manifest['version'] == '0.18.0'
assert manifest['name'] == 'YouTube Ledger' and len(manifest['description']) <= 132
assert manifest['permissions'] == ['storage', 'alarms']
assert 'optional_permissions' not in manifest
assert 'key' not in manifest and 'update_url' not in manifest and 'externally_connectable' not in manifest
assert manifest['incognito'] == 'not_allowed'
assert set(manifest['host_permissions']) == {'https://www.youtube.com/*', 'https://m.youtube.com/*'}
assert manifest['content_security_policy']['extension_pages'] == "script-src 'self'; object-src 'none'; base-uri 'none'"
assert manifest['background'] == {'service_worker': 'vault-worker.js'}
worker = (folder / 'vault-worker.js').read_text()
assert 'connectNative' not in worker and 'sendNativeMessage' not in worker and 'local-sync.js' not in worker
assert "delete safe.reviewPreference" in worker
assert 'LedgerLocalSync' not in (folder / 'background.js').read_text()
assert 'Your data' in (folder / 'settings.js').read_text()
assert 'local-sync-ui.js' not in (folder / 'dashboard.html').read_text()
assert (folder / 'docs/privacy.html').read_bytes() == (ROOT / 'docs/privacy-chrome.html').read_bytes()
assert 'Chrome Preview' not in (folder / 'backup-ui.js').read_text()
assert 'sessionStorage.' not in (folder / 'watch-source.js').read_text()
assert 'sessionStorage.' not in (folder / 'groups-feed.js').read_text()
# All executable entry points resolve inside the allowlisted package.
for script in manifest['content_scripts'][0]['js']:
    assert script in expected
for script in re.findall(r"'([^']+\.js)'", worker):
    assert script in expected, script
html = (folder / 'dashboard.html').read_text()
loader = re.search(r'<script id="vault-scripts" type="application/json">(.*?)</script>', html).group(1)
assert all(script in expected for script in json.loads(loader))
assert not re.search(r'<script[^>]+src=["\'](?:https?:)?//', html)
archive_path = release / 'youtube-ledger-chrome-0.18.0.zip'
with ZipFile(archive_path) as archive:
    assert len(archive.namelist()) == len(expected) and set(archive.namelist()) == expected
    assert archive.testzip() is None
    for name in expected:
        assert archive.read(name) == (folder / name).read_bytes(), name
        assert archive.getinfo(name).date_time == (2026, 10, 3, 0, 0, 0)
if args.with_assets:
    images = release / 'store-assets'
    screenshots = sorted(images.glob('[0-9][0-9]-*.png'))
    assert len(screenshots) == 5
    for p in [*screenshots, images / 'promo-small-440x280.png', images / 'icon-128.png']:
        size = struct.unpack('>II', p.read_bytes()[16:24])
        assert size == ((440, 280) if p.name.startswith('promo-') else (128, 128) if p.name.startswith('icon-') else (1280, 800)), (p.name, size)
    assert (images / 'icon-128.png').read_bytes() == (folder / 'icons/icon-128.png').read_bytes()
    captions = (images / 'CAPTIONS.txt').read_text()
    assert all(p.name in captions for p in screenshots)
# The submitted Firefox release is immutable, if present on this machine.
receipt = ROOT / 'dist/release-candidate/0.17.5/SUBMISSION-RECEIPT.json'
if receipt.exists():
    for name, digest in json.loads(receipt.read_text())['artifacts'].items():
        assert hashlib.sha256((receipt.parent / name).read_bytes()).hexdigest() == digest, name
print('PASS: exact store allowlist/ZIP, permissions, policy identity, local script routes, companion removal, version and unchanged Firefox submission' + ('; five captioned screenshots and green icon.' if args.with_assets else '.'))
print('SHA256 ' + hashlib.sha256(archive_path.read_bytes()).hexdigest())
