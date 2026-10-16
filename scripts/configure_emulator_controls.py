"""Enable laptop input on our development TV AVD, only while it is stopped."""
import json
import os
from pathlib import Path
import subprocess

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise SystemExit('Activate amazon-tv and dot-source scripts/use_android_sdk.ps1 first.')
root = Path('D:/android-fire-TV/avd').resolve()
config = (root / 'JabTempo_TV_1080p.avd/config.ini').resolve()
if not config.is_relative_to(root) or not config.is_file():
    raise SystemExit('Our named development AVD config was not found.')
adb = Path(os.environ['ANDROID_HOME']) / 'platform-tools/adb.exe'
devices = subprocess.check_output([str(adb), 'devices'], text=True)
if 'emulator-5580' in devices:
    raise SystemExit('Close JabTempo_TV_1080p before changing its input configuration.')
source = config.read_text()
if 'hw.device.name=tv_1080p' not in source or 'android-tv' not in source:
    raise SystemExit('Config is not the expected Android TV development AVD.')
backup = config.with_name('config.before-laptop-controls.ini')
if not backup.exists():
    backup.write_text(source)
values = {'hw.keyboard': 'yes', 'hw.keyboard.lid': 'no', 'hw.screen': 'multi-touch', 'hw.dPad': 'yes'}
lines = source.splitlines()
for key, value in values.items():
    indices = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
    if len(indices) > 1:
        raise SystemExit(f'Duplicate config property: {key}')
    if indices:
        lines[indices[0]] = f'{key}={value}'
    else:
        lines.append(f'{key}={value}')
config.write_text('\n'.join(lines) + '\n')
print(json.dumps({'config': str(config), 'backup': str(backup), 'settings': values,
                  'scope': 'Laptop development emulator only; physical TV D-pad support remains required'}))
