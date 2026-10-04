"""Build and validate the Chrome store candidate on the current OS (no upload)."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
release = ROOT / 'dist/chrome-release-candidate/0.18.0'
node = os.environ.get('LEDGER_NODE', 'node')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'LEDGER_NODE': node, 'LEDGER_EXTENSION_DIR': str(release / 'extension')}
checks = [
    ('build-portability', [sys.executable, 'chrome-vault/build.test.py']),
    ('build', [sys.executable, 'chrome-vault/build.py', '--channel', 'store']),
    ('storage-and-crypto', [node, '--test', 'chrome-vault/store.test.cjs']),
    ('recording-and-migration', [node, 'chrome-vault/browser-check.cjs']),
    ('automatic-access', [node, 'chrome-vault/automatic-check.cjs']),
    ('large-profile', [node, 'chrome-vault/large-profile-check.cjs']),
    ('release-lifecycle', [node, 'chrome-vault/release-check.cjs']),
    ('package', [sys.executable, 'scripts/check-chrome-release.py']),
]
results = []
report = release / ('VALIDATION-' + platform.system().lower() + '.json')
for name, command in checks:
    print('Running ' + name, flush=True)
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, encoding='utf-8', capture_output=True, timeout=240)
        output = result.stdout + result.stderr
        results.append({'name': name, 'passed': result.returncode == 0, 'exitCode': result.returncode, 'output': output[-16000:]})
        print(output, flush=True)
    except subprocess.TimeoutExpired:
        results.append({'name': name, 'passed': False, 'error': 'Timed out after 240 seconds'})
    archive = release / 'youtube-ledger-chrome-0.18.0.zip'
    release.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'os': platform.platform(),
        'architecture': platform.machine(), 'packageSha256': hashlib.sha256(archive.read_bytes()).hexdigest() if archive.exists() else None,
        'allChecksPassed': len(results) == len(checks) and all(r['passed'] for r in results), 'checks': results,
        'scope': 'Synthetic data and disposable Chromium profiles. No publication, live YouTube service validation or store approval.'}, indent=2) + '\n', encoding='utf-8')
    if not results[-1]['passed']:
        raise SystemExit(1)
print('PASS: release checks on ' + platform.system() + '. Report: ' + str(report))
