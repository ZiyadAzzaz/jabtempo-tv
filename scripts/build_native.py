"""Build a managed D: native workspace; never accept licenses or publish artifacts."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise SystemExit('Activate amazon-tv and dot-source scripts/use_android_sdk.ps1 first.')
parser = argparse.ArgumentParser()
parser.add_argument('target', choices=['sample', 'jabtempo'])
parser.add_argument('--attempt', type=int, default=1)
parser.add_argument('--low-memory', action='store_true', help='One worker and a bounded Gradle heap for the development laptop.')
parser.add_argument('--force-bundle', action='store_true', help='Rerun Gradle tasks when Expo environment values changed without a source edit.')
args = parser.parse_args()
if args.target == 'jabtempo':
    required = {
        'EXPO_PUBLIC_JABTEMPO_RELAY_URL': 'ws://10.0.2.2:8789/bridge',
        'EXPO_PUBLIC_JABTEMPO_SETUP_URL': 'http://10.0.2.2:8789/connection',
    }
    for name, expected in required.items():
        if os.environ.get(name) != expected:
            raise SystemExit(f'Set {name}={expected} before building the emulator APK.')
    if not os.environ.get('EXPO_PUBLIC_JABTEMPO_PHONE_URL', '').startswith('https://'):
        raise SystemExit('Set EXPO_PUBLIC_JABTEMPO_PHONE_URL to the current HTTPS LAN /phone URL.')
workspace = Path('D:/android-fire-TV/projects') / args.target
if not (workspace / '.jabtempo-managed-workspace.json').is_file():
    raise SystemExit('Run scripts/prepare_native_workspace.py first.')
app = workspace / ('apps/expo-multi-tv' if args.target == 'sample' else 'apps/tv')
android = app / 'android'
if not (android / 'gradlew.bat').exists():
    raise SystemExit('Generate Android project with Expo prebuild --platform android --no-install first.')
(android / 'local.properties').write_text('sdk.dir=D:/android-fire-TV/sdk\n')
gradle = android / 'app/build.gradle'
source = gradle.read_text()
if 'debuggableVariants = []' not in source:
    source = source.replace('react {', 'react {\n    // Bundle this debug build for standalone emulator execution.\n    debuggableVariants = []', 1)
    gradle.write_text(source)
environment = dict(os.environ, EXPO_NO_METRO_WORKSPACE_ROOT='1', EXPO_TV='1',
                   EXPO_NO_TELEMETRY='1', NODE_ENV='development', DEBUG='')
log = Path('D:/android-fire-TV/tmp') / f'{args.target}-build-{args.attempt}.log'
command = [str(android / 'gradlew.bat'), 'assembleDebug', '-PreactNativeArchitectures=x86',
           '--max-workers=1' if args.low_memory else '--max-workers=2', '--no-daemon', '--console=plain']
if args.low_memory:
    command.append('-Dorg.gradle.jvmargs=-Xmx768m -XX:MaxMetaspaceSize=384m')
if args.force_bundle:
    command.append('--rerun-tasks')
started = datetime.datetime.now(datetime.timezone.utc)
print(f'Building {args.target} x86 debug APK. Log: {log}', flush=True)
with log.open('w') as output:
    result = subprocess.run(command, cwd=android, env=environment,
                            stdout=output, stderr=subprocess.STDOUT)
apk = android / 'app/build/outputs/apk/debug/app-debug.apk'
record = {'target': args.target, 'attempt': args.attempt, 'startedUtc': started.isoformat(),
          'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'exitCode': result.returncode, 'log': str(log), 'workspace': str(workspace),
          'apkBuilt': result.returncode == 0 and apk.is_file(), 'emulatorRun': False,
          'nativeRoundWithIPhone': False, 'g0': 'PENDING',
          'setupPatches': ['Bundle debug for standalone execution', 'EXPO_NO_METRO_WORKSPACE_ROOT=1'],
          'nativeArchitecture': 'x86 emulator only'}
record['lowMemoryBuild'] = args.low_memory
if record['apkBuilt']:
    record.update(apk=str(apk), bytes=apk.stat().st_size)
    with apk.open('rb') as stream:
        record['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
output = Path('results/native'); output.mkdir(exist_ok=True)
(output / f'{args.target}_build_{args.attempt}.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(record, indent=2), flush=True)
raise SystemExit(result.returncode)
