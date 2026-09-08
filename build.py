"""Build store packages by default; GitHub experiments require an explicit channel."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
FILES = ['LICENSE', 'compat.js', 'core.js', 'background.js', 'content.js',
         'youtube-requests.js', 'media-ui.js', 'group-icons.js', 'channel-groups.js', 'group-sharing.js', 'groups-ui.js', 'groups-content.js', 'groups-dashboard.js',
         'group-feeds.js', 'groups-feed.js', 'watch-source.js', 'watch-later-content.js',
         'recommendations.js', 'recommendations.css', 'dashboard.html',
         'dashboard.css', 'frutiger-aero.css', 'settings.js', 'trends.js', 'dashboard.js',
         'retrowave.svg', 'retrowave-animated.svg']
FILES += ['recording.js', 'recording-buffer.js', 'recording-ui.js', 'ledger-undo.js', 'undo-ui.js', 'feed-library.js', 'group-queue.js', 'queue-content.js', 'review-period.js', 'ledger-storage.js', 'watch-status.js', 'source-contexts.js', 'backup.js', 'backup-ui.js', 'gif-codec.js', 'gif-resize.js', 'THIRD-PARTY-LICENSES.txt']
FILES += ['icons/logo.svg'] + [f'icons/icon-{n}.png' for n in [16,32,48,64,128,256]]
FILES += ['assets/frutiger-aero/water-desktop.png', 'assets/frutiger-aero/skyline-desktop.png', 'assets/frutiger-aero/landscape-mobile.png',
          'assets/frutiger-aero/foliage-left.png', 'assets/frutiger-aero/foliage-right.png']


def build(channel='store'):
    if channel not in {'store', 'experimental'}:
        raise ValueError('Unknown build channel')
    source = json.loads((ROOT / 'manifest.json').read_text())
    for browser in ['chrome', 'firefox']:
        manifest = json.loads(json.dumps(source))
        # Explicit source allowlist. No recursive source copy, tests, exports, or docs.
        files = {name: (ROOT / name).read_bytes() for name in [*FILES, 'service-worker.js']}
        if browser == 'chrome':
            manifest.pop('browser_specific_settings', None)
            manifest['minimum_chrome_version'] = '110'
            manifest['background'] = {'service_worker': 'service-worker.js'}
        if channel == 'experimental':
            spec = importlib.util.spec_from_file_location('ledger_experimental_build', ROOT / 'experimental/account-history/build.py')
            extension = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(extension)
            files, manifest = extension.extend(files, manifest, browser)
        if browser == 'firefox': files.pop('service-worker.js')
        install = ('Chrome: unzip this archive into a permanent folder. Open chrome://extensions, '
                   'enable Developer mode, click Load unpacked, and select this folder. '
                   'Pin YouTube Ledger from the extensions menu, then refresh YouTube. '
                   'For updates, replace files in the SAME folder and click Reload.\n'
                   if browser == 'chrome' else
                   'Firefox: open about:debugging#/runtime/this-firefox, click Load Temporary '
                   'Add-on, and select manifest.json. Refresh YouTube. This temporary install '
                   'ends at browser restart; a durable install needs Mozilla signing.\n')
        install += ('\nNo viewing history is included. Data stays in this browser profile; '
                    'Chrome and Firefox keep separate Ledger databases. Export data before '
                    'uninstalling. This package has not been published to a store.\n')
        if channel == 'experimental':
            install = 'EXPERIMENTAL — GitHub distribution only. Do not submit to a browser store.\nSee EXPERIMENTAL.md.\n\n' + install
        files['INSTALL.txt'] = install.encode()
        files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        folder = ROOT / 'dist' / browser if channel == 'store' else ROOT / 'dist' / 'experimental' / browser
        # Remove stale files from previous releases/channels before writing anything.
        if folder.exists(): shutil.rmtree(folder)
        folder.mkdir(parents=True)
        for name, data in files.items():
            (folder / name).parent.mkdir(parents=True, exist_ok=True)
            (folder / name).write_bytes(data)
        archive = ROOT / f'youtube-ledger-{browser}-{channel}-{source["version"]}.zip'
        with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
            for name in sorted(files): z.write(folder / name, name)
        print(archive)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', choices=['store', 'experimental'], default='store')
    build(parser.parse_args().channel)
