"""Prepare a pinned, Apache-2.0 English Vosk model for local browser use; no microphone access."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request
import zipfile

if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
    raise RuntimeError('Activate amazon-tv before preparing voice assets.')
url = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
expected = '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'
cache = Path('.cache/models')
cache.mkdir(parents=True, exist_ok=True)
archive = cache / 'vosk-model-small-en-us-0.15.zip'
if not archive.exists():
    partial = archive.with_suffix('.partial')
    with urllib.request.urlopen(url, timeout=60) as response, partial.open('wb') as target:
        while chunk := response.read(1024 * 1024):
            target.write(chunk)
    partial.replace(archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Pinned voice model checksum differs; do not load it.')
output = cache / 'voice-en.tar.gz'
# Convert within archives, without extracting paths onto disk. Vosk expects a model/ directory.
with zipfile.ZipFile(archive) as source, output.open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as target:
            directory = tarfile.TarInfo('model/')
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            target.addfile(directory)
            for item in sorted(source.infolist(), key=lambda item: item.filename):
                parts = PurePosixPath(item.filename).parts
                if len(parts) == 1 and item.is_dir():
                    continue
                if len(parts) < 2 or '..' in parts or parts[0] != 'vosk-model-small-en-us-0.15':
                    raise RuntimeError('Unexpected model archive path.')
                if item.is_dir():
                    info = tarfile.TarInfo('model/' + '/'.join(parts[1:]) + '/')
                    info.type = tarfile.DIRTYPE
                    info.mode = 0o755
                    target.addfile(info)
                    continue
                data = source.read(item)
                info = tarfile.TarInfo('model/' + '/'.join(parts[1:]))
                info.size = len(data)
                info.mode = 0o644
                target.addfile(info, io.BytesIO(data))
manifest = dict(url=url, sourceSha256=expected, bytes=output.stat().st_size,
                sha256=hashlib.sha256(output.read_bytes()).hexdigest(), model='vosk-model-small-en-us-0.15',
                license='Apache-2.0', licenseEvidence='https://alphacephei.com/vosk/models',
                runtime='Optional local browser worker; no cloud recognition',
                iPhoneVerified=False, humanVoiceAccuracyVerified=False)
Path('results/voice_asset.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print(json.dumps(manifest))
