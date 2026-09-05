"""Build clean, shareable Firefox and Chrome packages from the same source."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
FILES = ['LICENSE', 'compat.js', 'core.js', 'background.js', 'content.js',
         'recommendations.js', 'recommendations.css', 'dashboard.html',
         'dashboard.css', 'settings.js', 'dashboard.js', 'retrowave.svg', 'retrowave-animated.svg']
FILES += ['icons/logo.svg'] + [f'icons/icon-{n}.png' for n in [16,32,48,64,128,256]]
source = json.loads((ROOT / 'manifest.json').read_text())
for browser in ['chrome', 'firefox']:
    manifest = json.loads(json.dumps(source))
    files = list(FILES)
    if browser == 'chrome':
        manifest.pop('browser_specific_settings', None)
        manifest['minimum_chrome_version'] = '110'
        manifest['background'] = {'service_worker': 'service-worker.js'}
        files.append('service-worker.js')
    folder = ROOT / 'dist' / browser
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for name in files:
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes((ROOT / name).read_bytes())
    install = ('Chrome: unzip this archive into a permanent folder. Open chrome://extensions, '
               'enable Developer mode, click Load unpacked, and select this folder. '
               'Pin YouTube Ledger from the extensions menu, then refresh YouTube. '
               'Keep this folder in place; the extension loads from it. For updates, replace '
               'files in this SAME folder and click Reload in chrome://extensions.\n'
               if browser == 'chrome' else
               'Firefox: open about:debugging#/runtime/this-firefox, click Load Temporary '
               'Add-on, and select manifest.json. Refresh YouTube. This temporary install '
               'ends at browser restart; a durable install needs Mozilla signing.\n')
    install += ('\nNo viewing history is included. Data stays in this browser profile; '
                'Chrome and Firefox do not sync their histories. Export data before '
                'uninstalling. This package has not been published to a store.\n')
    (folder / 'INSTALL.txt').write_text(install)
    archive = ROOT / f'youtube-ledger-{browser}-{source["version"]}.zip'
    with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
        for name in ['manifest.json', 'INSTALL.txt', *files]:
            z.write(folder / name, name)
    print(archive)
