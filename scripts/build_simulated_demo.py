"""Edit the native emulator's synthetic-controller run into an honest local demo."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'local_private' / 'demo'
PARTS = PRIVATE / 'simulated_edit_parts'
FONT = 'apps/tv/assets/fonts/BarlowCondensed-Bold.ttf'
BEAT = ROOT / 'apps/tv/assets/audio/beat_110.wav'
RAW = PRIVATE / 'native_simulated_player_raw.mp4'
OUTPUT = PRIVATE / 'JabTempo_simulated_emulator_demo.mp4'


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def duration(path):
    result = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path)
    ], cwd=ROOT, text=True)
    return float(result.strip())


def still(name, filename, seconds):
    target = PARTS / f'{name}.mp4'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1',
        '-framerate', '30', '-i', str(ROOT / filename), '-t', str(seconds),
        '-vf', 'scale=1280:720:flags=lanczos,format=yuv420p', '-an',
        '-c:v', 'libopenh264', '-b:v', '5M', '-r', '30', '-g', '60', str(target))
    return target


def main():
    if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
        raise SystemExit('Activate amazon-tv first.')
    prefix = Path(os.environ['CONDA_PREFIX']).resolve()
    for binary in ('ffmpeg', 'ffprobe'):
        tool = shutil.which(binary)
        if not tool or not Path(tool).resolve().is_relative_to(prefix):
            raise SystemExit(f'{binary} must come from amazon-tv.')
    if not RAW.exists() or not BEAT.exists():
        raise SystemExit('Missing native simulated capture or original beat.')
    if duration(RAW) < 61:
        raise SystemExit('Simulated round capture is too short for the Summary.')
    PARTS.mkdir(parents=True, exist_ok=True)
    segments = [
        still('01_home', 'results/ui_smoke/Home.png', 5),
        still('02_hands', 'results/ui_smoke/HowToPlay.png', 4),
        still('03_calibrate', 'results/ui_smoke/Calibrate.png', 4),
    ]
    round_part = PARTS / '04_round.mp4'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(RAW),
        '-t', '63.3', '-vf', 'fps=30,format=yuv420p', '-an',
        '-c:v', 'libopenh264', '-b:v', '5M', '-r', '30', '-g', '60', str(round_part))
    segments.append(round_part)
    segments.extend([
        still('05_summary', 'results/ui_smoke/Summary.png', 9),
        still('06_family', 'results/ui_smoke/Family.png', 5),
    ])
    list_file = PARTS / 'clips.ffconcat'
    list_file.write_text('ffconcat version 1.0\n' + ''.join(f"file '{p.name}'\n" for p in segments), encoding='utf-8')
    base = PARTS / 'joined.mp4'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-safe', '0',
        '-i', str(list_file), '-c', 'copy', str(base))
    total = duration(base)
    font = FONT
    captions = [
        (0, 5, 'A RHYTHM BOXING GAME FOR THE TV'),
        (5, 9, 'PRACTICE LEFT AND RIGHT'),
        (9, 13, 'CALIBRATE BOTH HANDS'),
        (13, 25, 'START SLOW AND PUNCH AT THE WHITE LINE'),
        (25, 42, 'THE NOTE PATTERN BUILDS THROUGH THE ROUND'),
        (42, 63, 'ON BEAT AND MISS FEEDBACK KEEP THE GAME CLEAR'),
        (63, 77, 'A FULL ROUND ENDS WITH TIMING AND HAND RESULTS'),
        (77, 85, 'THE SUMMARY SUGGESTS THE NEXT PRACTICE FOCUS'),
        (85, 91, 'FAMILY CHALLENGE USES TURN BASED PLAY'),
    ]
    filters = [
        'drawbox=x=0:y=0:w=iw:h=43:color=black@0.75:t=fill',
        'drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.80:t=fill',
        f"drawtext=fontfile={font}:text='ANDROID TV EMULATOR  -  SYNTHETIC CONTROLLER':fontsize=21:fontcolor=white:x=(w-text_w)/2:y=8",
    ]
    for start, end, line in captions:
        filters.append(
            f"drawtext=fontfile={font}:text='{line}':fontsize=24:fontcolor=white:"
            f"x=(w-text_w)/2:y=h-42:enable='between(t,{start},{end})'"
        )
    video_filter = ','.join(filters)
    fade_start = max(0, total - 3)
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(base),
        '-stream_loop', '-1', '-i', str(BEAT), '-filter_complex',
        f'[0:v]{video_filter}[v];[1:a]volume=0.8,afade=t=in:st=0:d=1,afade=t=out:st={fade_start:.2f}:d=3[a]',
        '-map', '[v]', '-map', '[a]', '-t', f'{total:.3f}',
        '-c:v', 'libopenh264', '-b:v', '5M', '-r', '30', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart',
        '-metadata', 'description=Android TV emulator run with synthetic pose and punch events; no real camera person',
        str(OUTPUT))
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    manifest = {
        'kind': 'native emulator with synthetic controller and pose events',
        'sourceReport': 'results/ui_smoke/report.json',
        'rawCapture': str(RAW.relative_to(ROOT)).replace('\\', '/'),
        'output': str(OUTPUT.relative_to(ROOT)).replace('\\', '/'),
        'durationSeconds': round(duration(OUTPUT), 3),
        'sha256': digest,
        'actualPersonOrPhoneCameraInVideo': False,
        'actualFireTVHardwareInVideo': False,
        'music': 'original locally generated JabTempo beat; added during edit',
        'submissionReady': False,
    }
    (PRIVATE / 'simulated_demo_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
