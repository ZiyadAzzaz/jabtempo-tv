"""Original deterministic PCM beat loops and hit cues; generated audio is CC0-1.0.

Run after `conda activate amazon-tv`. No downloaded music, recordings or dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import wave

SAMPLE_RATE = 48000
GENERATOR_VERSION = 2


def tone(frequency: float, duration: float, gain: float = 0.3) -> list[float]:
    """Short sine cue with attack/release envelope to avoid abrupt edges."""
    frames = round(duration * SAMPLE_RATE)
    result = []
    for i in range(frames):
        t = i / SAMPLE_RATE
        envelope = min(1.0, t / 0.004) * math.exp(-t * 28)
        envelope *= min(1.0, (frames - 1 - i) / (0.008 * SAMPLE_RATE))
        result.append(gain * envelope * math.sin(2 * math.pi * frequency * t))
    return result


def beat_loop(bpm: int, beats: int) -> list[float]:
    """Original warm percussion/bass pattern; exact beat boundaries prevent drift."""
    if bpm not in (90, 110, 130) or beats < 4 or beats % 4:
        raise ValueError('BPM must be 90/110/130; beats must be a positive multiple of four')
    frames = round(beats * 60 * SAMPLE_RATE / bpm)
    samples = [0.0] * frames
    def mix(start, cue):
        for i, sample in enumerate(cue):
            if start+i < frames:
                samples[start+i] += sample
    for beat in range(beats):
        start = round(beat * 60 * SAMPLE_RATE / bpm)
        # A short high cue leaves the scoring beat unambiguous; a bass pulse adds warmth.
        mix(start, tone(880 if beat % 4 == 0 else 660, 0.07, 0.17 if beat % 4 == 0 else 0.11))
        mix(start, tone(55 if beat % 4 in (0,2) else 82.4069, .24, .34))
        if beat % 2:
            mix(start, tone(220, .09, .12))
            mix(start, tone(329.6276, .065, .08))
        half = start+round(30*SAMPLE_RATE/bpm)
        mix(half, tone(3520, .025, .055))
        # Sparse original pentatonic motif keeps the track friendly and leaves room for SFX.
        if beat % 2 == 0:
            melody=(261.6256,329.6276,391.9954,440,391.9954,329.6276,293.6648,261.6256)
            mix(half,tone(melody[(beat//2)%8],.21,.08))
    return samples


def write_wav(path: Path, samples: list[float]) -> dict:
    pcm = bytearray()
    peak = 0
    for sample in samples:
        value = round(max(-1.0, min(1.0, sample)) * 32767)
        peak = max(peak, abs(value))
        pcm.extend(struct.pack('<h', value))
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(pcm)
    return {'file': path.name, 'frames': len(samples), 'durationSeconds': len(samples) / SAMPLE_RATE,
            'sampleRate': SAMPLE_RATE, 'channels': 1, 'bitsPerSample': 16, 'peakPcm': peak,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def generate(output: Path, beats: int = 16) -> dict:
    if beats < 4 or beats % 4 or beats > 256:
        raise ValueError('beats must be a multiple of four in 4..256')
    output.mkdir(parents=True, exist_ok=True)
    assets = []
    for bpm in (90, 110, 130):
        entry = write_wav(output / f'beat_{bpm}.wav', beat_loop(bpm, beats))
        entry.update(bpm=bpm, beats=beats, loop=True, firstBeatMs=0)
        assets.append(entry)
    for name, frequency in [('perfect', 1320), ('good', 990), ('guard', 1760), ('miss', 330), ('combo', 2093)]:
        assets.append(write_wav(output / f'hit_{name}.wav', tone(frequency, 0.12, 0.25)))
    manifest = {'generator': 'scripts/gen_beats.py', 'generatorVersion': GENERATOR_VERSION,
                'license': 'CC0-1.0', 'provenance': 'Original mathematical sine-wave synthesis; no recordings or third-party samples',
                'assets': assets}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('apps/tv/assets/audio'))
    parser.add_argument('--beats', type=int, default=16, help='Loop length, multiple of four (default 16)')
    args = parser.parse_args()
    manifest = generate(args.output, args.beats)
    print(json.dumps({'output': str(args.output.resolve()), 'assets': len(manifest['assets']),
                      'license': manifest['license'], 'sampleRate': SAMPLE_RATE}))


if __name__ == '__main__':
    main()
