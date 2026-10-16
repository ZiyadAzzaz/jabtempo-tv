"""Pinned official local lab tools, private environment installation, no system PATH edits."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request
import zipfile

TOOLS = {
    'maestro': {'version': '2.11.0', 'license': 'Apache-2.0',
        'url': 'https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip',
        'sha256': '5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a'},
    'scrcpy': {'version': '4.1', 'license': 'Apache-2.0',
        'url': 'https://github.com/Genymobile/scrcpy/releases/download/v4.1/scrcpy-win64-v4.1.zip',
        'sha256': '5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db'},
}

def install(name):
    if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv' or not os.environ.get('CONDA_PREFIX'):
        raise ValueError('Activate amazon-tv first')
    tool = TOOLS[name]
    directory = Path(os.environ['CONDA_PREFIX'])/'lab-tools'/name
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory/'release.zip'
    if not archive.exists():
        urllib.request.urlretrieve(tool['url'], archive)
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if digest != tool['sha256']:
        raise ValueError('Official archive checksum mismatch; not extracting')
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (directory/member.filename).resolve().is_relative_to(directory.resolve()):
                raise ValueError('Archive member escapes installation directory')
        bundle.extractall(directory)
    return {**tool, 'installation': str(directory), 'status': 'INSTALLED', 'deviceActionsExecuted': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tool', choices=TOOLS)
    args = parser.parse_args()
    print(json.dumps(install(args.tool)))
