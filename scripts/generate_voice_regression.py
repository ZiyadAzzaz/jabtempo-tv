"""Generate local-only synthetic command WAV fixtures using installed Windows voices.

This does not run recognition or claim speech accuracy. No downloaded models.
"""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import wave

from eval_voice import COMMANDS, FIELDS

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16000
CONDITIONS = {'quiet': 0, 'beat-low': 0.1, 'beat-medium': 0.3, 'beat-high': 0.6}
SYNTHESIS_SCRIPT = r'''
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
$format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$voices=@($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('en') } | Select-Object -First ([int]$env:JABTEMPO_VOICE_COUNT))
if($voices.Count -eq 0){throw 'No installed enabled English Windows voice'}
$commands=@('start','pause','resume','harder','easier','next round','two players')
$rows=@()
try {
  for($v=0;$v -lt $voices.Count;$v++){
    $synth.SelectVoice($voices[$v].VoiceInfo.Name)
    foreach($rate in @(-2,0,2)){
      $synth.Rate=$rate
      for($c=0;$c -lt $commands.Count;$c++){
        $name=('tts{0:D3}_rate{1}_cmd{2}.wav' -f ($v+1),$rate,$c)
        $target=Join-Path $env:JABTEMPO_VOICE_OUTPUT $name
        $synth.SetOutputToWaveFile($target,$format)
        [void]$synth.Speak($commands[$c])
        $synth.SetOutputToNull()
        $rows+=@{file=$name;command=$commands[$c];speaker=('TTS{0:D3}' -f ($v+1));rate=$rate;installedVoice=$voices[$v].VoiceInfo.Name}
      }
    }
  }
  ConvertTo-Json -Depth 5 -InputObject $rows | Set-Content -LiteralPath (Join-Path $env:JABTEMPO_VOICE_OUTPUT 'synthesis.json') -Encoding UTF8
} finally {$synth.Dispose()}
'''


def mix_samples(speech, gain, sample_rate=SAMPLE_RATE):
    if not speech or not any(speech):
        raise ValueError('synthesis returned empty/silent speech')
    if gain not in CONDITIONS.values():
        raise ValueError('unsupported beat gain')
    padding = sample_rate // 2
    peak = max(abs(v) for v in speech)
    result = []
    for i in range(len(speech) + 2 * padding):
        voice = speech[i-padding] / peak * 0.65 if padding <= i < padding+len(speech) else 0
        time = i / sample_rate
        beat_number = math.floor(time * 110 / 60)
        elapsed = time - beat_number * 60 / 110
        beat = 0.0
        if elapsed < 0.09:
            frequency = 880 if beat_number % 4 == 0 else 660
            envelope = min(1.0, elapsed/0.004)*math.exp(-elapsed*28)*min(1.0,(0.09-elapsed)/0.008)
            beat = 0.38*envelope*math.sin(2*math.pi*frequency*elapsed)
        result.append(round(max(-1, min(1, voice + gain*beat))*32767))
    return result


def private_output(output):
    resolved = output.resolve()
    if not resolved.is_relative_to((ROOT / 'local_private').resolve()):
        raise ValueError('synthetic voice assets must remain under local_private/')
    check = subprocess.run(['git', 'check-ignore', '--quiet', '--', str(resolved / 'privacy-check.wav')], cwd=ROOT, capture_output=True)
    if check.returncode != 0:
        raise ValueError('local_private/ must be gitignored before creating voice assets')
    return resolved


def generate(output, voice_count=2):
    if not 1 <= voice_count <= 3:
        raise ValueError('voice count must be 1..3 installed voices')
    output = private_output(output)
    output.mkdir(parents=True, exist_ok=True)
    if sys.platform != 'win32':
        status = {'status': 'SKIP', 'reason': 'Installed Windows speech synthesis unavailable on this platform', 'recognizerStatus': 'NOT_RUN'}
        (output / 'generation_status.json').write_text(json.dumps(status, indent=2)+'\n')
        return status
    helper = output / 'synthesize.ps1'
    helper.write_text(SYNTHESIS_SCRIPT, encoding='utf-8')
    env = {**os.environ, 'JABTEMPO_VOICE_OUTPUT': str(output), 'JABTEMPO_VOICE_COUNT': str(voice_count)}
    try:
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(helper)], env=env, check=True, capture_output=True, timeout=180)
        sources = json.loads((output / 'synthesis.json').read_text(encoding='utf-8-sig'))
        if not isinstance(sources, list) or not sources:
            raise ValueError('synthesis produced no command files')
        cases, assets = [], []
        for source in sources:
            path = output / source['file']
            with wave.open(str(path), 'rb') as stream:
                if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate()) != (1, 2, SAMPLE_RATE):
                    raise ValueError('unexpected synthesis WAV format')
                data = stream.readframes(stream.getnframes())
            speech = list(struct.unpack('<'+'h'*(len(data)//2), data))
            for condition, gain in CONDITIONS.items():
                utterance_id = path.stem + '_' + condition
                target = output / (utterance_id+'.wav')
                mixed = mix_samples(speech, gain)
                with wave.open(str(target), 'wb') as stream:
                    stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(SAMPLE_RATE)
                    stream.writeframes(struct.pack('<'+'h'*len(mixed), *mixed))
                assets.append({'file': target.name, 'command': source['command'], 'speaker': source['speaker'], 'rate': source['rate'],
                               'condition': condition, 'beatGain': gain, 'frames': len(mixed), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
                cases.append({'utterance_id': utterance_id, 'source': 'synthetic', 'speaker': source['speaker'], 'condition': condition,
                              'expected': source['command'], 'recognized': 'unknown', 'confidence': '', 'consent': 'false',
                              'on_device': 'false', 'recognition_status': 'skipped'})
        with (output / 'cases.csv').open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS);writer.writeheader();writer.writerows(cases)
        status = {'status': 'FIXTURES_GENERATED', 'recognizerStatus': 'NOT_RUN', 'label': 'synthetic speech regression',
                  'engine': 'installed Windows System.Speech; local-only test fixtures; no redistribution license claim',
                  'installedVoiceCount': len({s['speaker'] for s in sources}), 'rates': [-2, 0, 2], 'beatBpm': 110,
                  'sampleRate': SAMPLE_RATE, 'assets': assets, 'gatePass': False}
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, wave.Error) as error:
        status = {'status': 'SKIP', 'reason': f'Synthesis unavailable/failed ({type(error).__name__}); no recognizer result produced', 'recognizerStatus': 'NOT_RUN', 'gatePass': False}
    (output / 'generation_status.json').write_text(json.dumps(status, indent=2)+'\n', encoding='utf-8')
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'local_private'/'voice-regression')
    parser.add_argument('--voices', type=int, default=2)
    args = parser.parse_args()
    try:
        result = generate(args.output, args.voices)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({k: v for k, v in result.items() if k != 'assets'}, indent=2))
    if result['status'] == 'SKIP':
        raise SystemExit(2)


if __name__ == '__main__':
    main()
