"""Fetch the explicitly Apache-2.0 licensed MediaPipe full pose model once.
No camera, audio, telemetry or cloud inference. Run inside amazon-tv.
"""
import hashlib
import json
from pathlib import Path
import urllib.request
from gen_beats import generate

url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
destination = Path('.cache/models/pose_landmarker_full.task')
destination.parent.mkdir(parents=True, exist_ok=True)
expected_sha256 = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'
if not destination.exists():
    temporary = destination.with_suffix('.partial')
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temporary.replace(destination)
actual_sha256 = hashlib.sha256(destination.read_bytes()).hexdigest()
if actual_sha256 != expected_sha256:
    raise RuntimeError('Pinned pose model checksum mismatch. Do not use or distribute this asset.')
manifest = {'url': url, 'sha256': actual_sha256,
            'bytes': destination.stat().st_size, 'license': 'Apache-2.0',
            'licenseEvidence': 'https://github.com/google-ai-edge/mediapipe/issues/6306',
            'runtime': 'Local worker; no remote inference'}
Path('results').mkdir(exist_ok=True)
Path('results/model_asset.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
generate(Path('.cache/beats'))
generate(Path('apps/tv/assets/audio'), beats=144)
print(json.dumps(manifest))
