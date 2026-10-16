"""Prepare a private Y4M fixture. No footage download or camera access.

Default is an original synthetic empty-scene negative fixture; it tests plumbing,
not human motion. Real input requires a consent manifest from the recording lab.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def prepare(output, video=None, manifest=None, start=0, duration=8, minimum_punches=1, negative=False):
    if not 0 <= start <= 3600 or not 1 <= duration <= 60 or minimum_punches < 0:
        raise ValueError('Select a bounded 1..60-second snippet, nonnegative start and punch count')
    output = output.resolve()
    private = (ROOT / 'local_private').resolve()
    if not output.is_relative_to(private):
        raise ValueError('Fixtures must stay under ignored local_private/')
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which('ffmpeg')
    prefix = Path(os.environ.get('CONDA_PREFIX', 'missing')).resolve()
    if not ffmpeg or not Path(ffmpeg).resolve().is_relative_to(prefix):
        raise ValueError('Install ffmpeg in amazon-tv first; system ffmpeg is not used.')
    if video:
        video = video.resolve()
        if not video.is_relative_to(private) or not manifest:
            raise ValueError('Consented video and manifest must be under local_private/')
        manifest = manifest.resolve()
        if not manifest.is_relative_to(private):
            raise ValueError('Consent manifest must be under local_private/')
        provenance = json.loads(manifest.read_text(encoding='utf-8'))
        if provenance.get('synthetic') is not False or provenance.get('consent', {}).get('localVideoTesting') is not True:
            raise ValueError('Explicit local-video-testing consent required')
        if provenance.get('videoSha256') != hashlib.sha256(video.read_bytes()).hexdigest():
            raise ValueError('Consent manifest must identify the exact video SHA256')
        args = ['-ss', str(start), '-i', str(video), '-t', str(duration), '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=30']
        kind = 'consented-human-video-regression'
    else:
        args = ['-f', 'lavfi', '-i', 'color=c=gray:s=640x480:r=30:d=4']
        kind = 'synthetic-empty-scene-negative'
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *args,
                    '-pix_fmt', 'yuv420p', '-an', '-f', 'yuv4mpegpipe', str(output)], check=True)
    result = {'v': 1, 'fixtureKind': kind, 'synthetic': not bool(video), 'localOnly': True,
              'camera': 'Chromium file-backed fake device; never a physical camera',
              'expected': {'trackingLost': not bool(video), 'minimumPunchEvents': minimum_punches if video and not negative else 0,
                           'maximumPunchEvents': 0 if negative or not video else None},
              'snippet': {'startSeconds': start, 'durationSeconds': duration} if video else None,
              'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size,
              'sourceConsentManifest': str(manifest.relative_to(ROOT)) if manifest else None}
    output.with_suffix('.manifest.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--consent-manifest', type=Path)
    parser.add_argument('--start-seconds', type=float, default=0)
    parser.add_argument('--duration-seconds', type=float, default=8)
    parser.add_argument('--minimum-punch-events', type=int, default=1)
    parser.add_argument('--negative', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT/'local_private/fixtures/empty-scene.y4m')
    args = parser.parse_args()
    if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
        parser.error('Activate amazon-tv first')
    print(json.dumps(prepare(args.output, args.input, args.consent_manifest, args.start_seconds, args.duration_seconds, args.minimum_punch_events, args.negative)))
