"""Stage native sources/dependencies on D: without deleting or moving owner files."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise SystemExit('Activate amazon-tv first.')
parser = argparse.ArgumentParser()
parser.add_argument('target', choices=['sample', 'jabtempo'])
args = parser.parse_args()
repo = Path.cwd().resolve()
source = repo / '.cache/amazon-tv-sample' if args.target == 'sample' else repo
destination = Path('D:/android-fire-TV/projects') / args.target
marker = destination / '.jabtempo-managed-workspace.json'
if destination.exists() and not marker.exists():
    raise SystemExit('STOP: destination exists without our marker; owner files will not be overwritten.')
if shutil.disk_usage('D:/').free < 4 * 1024**3:
    raise SystemExit('STOP: staging requires at least 4 GiB free on D:.')
destination.mkdir(parents=True, exist_ok=True)
marker.write_text(json.dumps({'source': str(source), 'target': args.target}, indent=2))

def copy_tree(src, dst, excludes=()):
    dst.mkdir(parents=True, exist_ok=True)
    command = ['robocopy', str(src), str(dst), '/E', '/XJ', '/MT:8', '/R:1', '/W:1',
               '/NFL', '/NDL', '/NJH', '/NJS', '/NP']
    if excludes:
        command += ['/XD', *excludes]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode >= 8:
        raise SystemExit(f'Copy failed ({result.returncode}): {result.stdout[-1500:]}')

if args.target == 'sample':
    copy_tree(source, destination, ('.git', 'node_modules', '.yarn', '.gradle', 'build'))
    dependency_paths = ['node_modules', 'apps/expo-multi-tv/node_modules', 'packages/shared-ui/node_modules']
else:
    for name in ['packages', 'apps/tv', 'apps/dev-web']:
        copy_tree(source / name, destination / name, ('node_modules', '.gradle', 'android', '.yarn'))
    for name in ['package.json', 'tsconfig.json']:
        shutil.copy2(source / name, destination / name)
    dependency_paths = ['node_modules', 'apps/tv/node_modules']

# Copy existing dependencies rather than writing Gradle build outputs into E: junction targets.
for relative in dependency_paths:
    src = source / relative
    if not src.exists():
        continue
    dst = destination / relative
    copy_tree(src, dst)
    for current, dirs, _ in os.walk(src, followlinks=False):
        for name in list(dirs):
            link = Path(current, name)
            if not (os.lstat(link).st_file_attributes & 0x400):
                continue
            dirs.remove(name)
            target = link.resolve()
            if not target.is_relative_to(source):
                raise SystemExit(f'External dependency junction needs review: {link}')
            copied_link = destination / link.relative_to(source)
            copied_target = destination / target.relative_to(source)
            if not copied_link.exists():
                subprocess.run(['powershell', '-NoProfile', '-Command', 'New-Item',
                                '-ItemType', 'Junction', '-Path', str(copied_link),
                                '-Target', str(copied_target)], check=True, capture_output=True)
print(f'Staged {args.target} native workspace: {destination}')
