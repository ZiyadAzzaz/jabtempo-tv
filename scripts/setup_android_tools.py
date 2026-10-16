"""Download only official command-line tools; never accept SDK licenses."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request
import zipfile

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise SystemExit('Activate amazon-tv first.')
root = Path('D:/android-fire-TV')
free = shutil.disk_usage(root.anchor).free
if free < 15 * 1024**3:
    raise SystemExit('STOP: D: requires at least 15 GiB free before SDK setup.')
for name in ('sdk', 'avd', 'android-user', 'gradle', 'tmp', 'downloads'):
    (root / name).mkdir(parents=True, exist_ok=True)
url = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
expected = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
archive = root / 'downloads' / url.rsplit('/', 1)[1]
if not archive.exists():
    partial = archive.with_suffix('.partial')
    with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    partial.replace(archive)
actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
if actual != expected:
    raise SystemExit(f'STOP: archive SHA-256 mismatch: {actual}')
destination = root / 'sdk' / 'cmdline-tools' / 'latest'
if not (destination / 'bin' / 'sdkmanager.bat').exists():
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            relative = Path(entry.filename)
            if not relative.parts or relative.parts[0] != 'cmdline-tools':
                raise SystemExit(f'Unexpected archive root: {entry.filename}')
            target = destination.joinpath(*relative.parts[1:]).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise SystemExit('Unsafe archive path.')
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.open(entry) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
record = {'source': url, 'publishedChecksumSource': 'https://developer.android.com/studio',
          'sha256': actual, 'bytes': archive.stat().st_size,
          'destination': str(destination), 'licensesAcceptedByAgent': False,
          'sdkPackagesInstalled': False, 'g0': 'PENDING'}
Path('results/android_tools_setup.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(record, indent=2))
