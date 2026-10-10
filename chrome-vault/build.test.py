"""Reproduce Windows CRLF checkouts and prove locale-independent packaging."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('source_build', ROOT / 'build.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
FILES = set(source.FILES) | {'build.py', 'manifest.json', 'docs/privacy-chrome.html'} | {
    'chrome-vault/' + name for name in ['build.py', 'store-edition.py', 'release.json', 'rename-api.cjs', 'icon-128.png',
        'crypto.js', 'store.js', 'idb.js', 'worker.js', 'client.js', 'gate.js', 'gate.css']}


class PortablePackage(unittest.TestCase):
    def test_lf_and_crlf_checkouts_build_identical_packages(self):
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8',
               'NODE_PATH': os.pathsep.join(filter(None, [str(ROOT / 'node_modules'), os.environ.get('NODE_PATH')]))}
        with tempfile.TemporaryDirectory(prefix='ledger-build-') as temporary:
            outputs = []
            for mode in ['lf', 'crlf']:
                folder = Path(temporary) / mode
                for name in FILES:
                    path = ROOT / name
                    data = path.read_bytes() if path.suffix == '.png' else path.read_text(encoding='utf-8').encode('utf-8')
                    if mode == 'crlf' and path.suffix != '.png':
                        data = data.replace(b'\n', b'\r\n')
                    target = folder / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                result = subprocess.run([sys.executable, str(folder / 'chrome-vault/build.py'), '--channel', 'store'],
                    env=env, cwd=folder, encoding='utf-8', capture_output=True, timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                version = json.loads((folder / 'chrome-vault/release.json').read_text(encoding='utf-8'))['storeVersion']
                archive = folder / 'dist/chrome-release-candidate' / version / f'youtube-ledger-chrome-{version}.zip'
                with ZipFile(archive) as package:
                    self.assertIn('Ledger'.encode('utf-8'), package.read('chrome-vault/gate.js'))
                    self.assertNotIn(b'\r\n', package.read('vault-worker.js'))
                    self.assertEqual(package.read('docs/privacy.html'), (ROOT / 'docs/privacy-chrome.html').read_text(encoding='utf-8').encode('utf-8'))
                outputs.append(hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(outputs[0], outputs[1], 'Line endings must not change the public artifact')


if __name__ == '__main__':
    unittest.main()
