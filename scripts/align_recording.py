"""Propose labels from instructions/raw wrist speeds; every decision requires independent review.

conda activate amazon-tv
python scripts/align_recording.py session.jsonl session.script.json --output local_private/review
python scripts/align_recording.py session.jsonl session.script.json --output local_private/review --finalize --reviewer reviewer01
The first invocation creates pending confirmations.csv and doubtful review_sheet.csv, never truth.
Edit confirmations.csv after video/keypoint inspection, add missed punches, then finalize explicitly.
"""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path

FIELDS = ['id', 'category', 'expected_kind', 'start_phone_ms', 'end_phone_ms',
          'proposed_peak_ms', 'video_offset_ms', 'proposed_hand', 'ambiguous',
          'reason', 'decision', 'reviewed_peak_ms', 'reviewed_kind', 'reviewed_hand', 'review_notes']


def read_session(path):
    records = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    if not records or records[0].get('consent') is not True:
        raise ValueError('Recording consent required.')
    frames = [r for r in records if r.get('type') == 'keypoints']
    if len(frames) < 3:
        raise ValueError('At least three recorded keypoint frames are required.')
    return records, frames


def raw_peaks(frames, aspect):
    """Independent diagnostic signal, not MotionDetector outputs or trusted labels."""
    speeds = {'left': [], 'right': []}
    for previous, frame in zip(frames, frames[1:]):
        dt = (frame['t'] - previous['t']) / 1000
        if not 0 < dt <= .25:
            continue
        for hand, wrist in [('left', 15), ('right', 16)]:
            required = [11, 12, wrist]
            if any(min(previous['landmarks'][i]['visibility'], frame['landmarks'][i]['visibility']) < .5 for i in required):
                continue
            def normalized(record):
                points = record['landmarks']
                left, right, point = [points[i] for i in required]
                width = math.hypot(right['x']-left['x'], (right['y']-left['y'])/aspect)
                if width < .02:
                    return None
                return ((point['x']-(left['x']+right['x'])/2)/width,
                        (point['y']-(left['y']+right['y'])/2)/(aspect*width))
            a, b = normalized(previous), normalized(frame)
            if a is not None and b is not None:
                speeds[hand].append((frame['t'], math.hypot(b[0]-a[0], b[1]-a[1])/dt))
    peaks = []
    for hand, samples in speeds.items():
        for i in range(1, len(samples)-1):
            t, speed = samples[i]
            if speed >= 1.0 and speed > samples[i-1][1] and speed >= samples[i+1][1]:
                peaks.append({'t': t, 'hand': hand, 'speed': speed})
    return sorted(peaks, key=lambda p: p['t'])


def propose(frames, script, stance, aspect):
    if script.get('labelsAreExpectedOnly') is not True or script.get('durationMs') != 600000:
        raise ValueError('Need the guided expected-only script, not a purported ground-truth file.')
    start = script['startAtPhoneMs']
    peaks = raw_peaks(frames, aspect)
    rows, covered = [], set()
    for cue in script['instructions']:
        if cue['category'] not in ('punch', 'negative', 'free'):
            continue
        begin, end = start+cue['startMs'], start+cue['endMs']
        candidates = [(i, peak) for i, peak in enumerate(peaks) if begin-300 <= peak['t'] <= end+500] if cue['category'] == 'punch' else []
        kind = cue.get('expectedKind', '')
        lead = 'left' if stance == 'orthodox' else 'right'
        expected_hand = lead if kind == 'jab' else ('right' if lead == 'left' else 'left') if kind else ''
        candidates.sort(key=lambda item: (-item[1]['speed'], item[1]['t']))
        peak = candidates[0][1] if candidates else None
        covered.update(index for index, _ in candidates)
        ambiguous = cue['category'] != 'punch' or len(candidates) != 1 or peak['hand'] != expected_hand
        reason = 'Inspect entire negative/free interval for unprompted punches.' if cue['category'] != 'punch' else 'Multiple/no raw-speed peaks, or hand disagrees with instruction.' if ambiguous else 'Single proposal; human confirmation still mandatory.'
        rows.append(dict(zip(FIELDS, [cue['id'], cue['category'], kind, begin, end,
                                    peak['t'] if peak else '', peak['t']-start if peak else '',
                                    peak['hand'] if peak else '', str(ambiguous).lower(), reason,
                                    'PENDING', '', '', '', ''])))
    # Unprompted peaks, including negatives, are explicit review rows; never silently discarded.
    for i, peak in enumerate(peaks):
        if i not in covered:
            rows.append(dict(zip(FIELDS, [f'extra-{i}', 'extra', '', peak['t']-200, peak['t']+200,
                                         peak['t'], peak['t']-start, peak['hand'], 'true',
                                         'Unprompted motion: decide punch or negative.', 'PENDING', '', '', '', ''])))
    return rows


def finalize(records, rows, reviewer):
    if not reviewer or not all(c.isalnum() or c in '_-' for c in reviewer) or len(reviewer) > 64:
        raise ValueError('Use a pseudonymous independent reviewer ID.')
    labels = []
    if not rows:
        raise ValueError('Empty review cannot be complete.')
    frames = [r for r in records if r.get('type') == 'keypoints']
    for row in rows:
        decision = row.get('decision', '').upper()
        if decision not in ('CONFIRM', 'OMIT', 'INTERVAL_REVIEWED') or not row.get('review_notes', '').strip():
            raise ValueError(f"Every row needs an independent decision and review notes: {row.get('id')}")
        if row['category'] in ('negative', 'free'):
            if decision != 'INTERVAL_REVIEWED':
                raise ValueError('Review negative/free intervals and add each missed punch as an extra row.')
            if row['category'] == 'negative' and row['reviewed_kind'] not in ('idle', 'dance', 'talk'):
                raise ValueError('Independently identify each negative interval as idle, dance or talk.')
            continue
        if decision == 'INTERVAL_REVIEWED':
            raise ValueError('A punch proposal must be confirmed or omitted.')
        if decision == 'CONFIRM':
            peak = float(row['reviewed_peak_ms'])
            kind, hand = row['reviewed_kind'], row['reviewed_hand']
            if not math.isfinite(peak) or not frames[0]['t'] <= peak <= frames[-1]['t'] or kind not in ('jab', 'cross') or hand not in ('left', 'right'):
                raise ValueError('Confirmed punches need independently inspected peak timestamp, kind and hand.')
            labels.append({'type': 'label', 't': peak, 'kind': kind, 'hand': hand})
    if len({label['t'] for label in labels}) != len(labels):
        raise ValueError('Duplicate confirmed peaks; review one-to-one labels.')
    header = {**records[0], 'labelsExpected': False}
    return [header, *frames, *sorted(labels, key=lambda label: label['t'])]


def main():
    if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
        raise SystemExit('Activate amazon-tv first.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recording', type=Path)
    parser.add_argument('script', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--finalize', action='store_true')
    parser.add_argument('--reviewer')
    args = parser.parse_args()
    records, frames = read_session(args.recording)
    script = json.loads(args.script.read_text(encoding='utf-8'))
    if script.get('session') != records[0]['session']:
        raise SystemExit('Script and keypoint session mismatch.')
    args.output.mkdir(parents=True, exist_ok=True)
    all_path = args.output / 'confirmations.csv'
    if not args.finalize:
        if all_path.exists():
            raise SystemExit('Existing review preserved; choose another output directory.')
        rows = propose(frames, script, records[0]['stance'], records[0]['aspectRatio'])
        for path, selected in [(all_path, rows), (args.output / 'review_sheet.csv', [row for row in rows if row['ambiguous'] == 'true'])]:
            with path.open('w', newline='', encoding='utf-8') as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS); writer.writeheader(); writer.writerows(selected)
        (args.output / 'proposal_manifest.json').write_text(json.dumps({'recordingSha256': hashlib.sha256(args.recording.read_bytes()).hexdigest(), 'scriptSha256': hashlib.sha256(args.script.read_bytes()).hexdigest(), 'proposalRows': [row['id'] for row in rows]}, indent=2), encoding='utf-8')
        print('Proposals only. Independently inspect all confirmations.csv rows, add missed punches, review full negative/free intervals. Nothing is ground truth yet.')
        return
    manifest = json.loads((args.output / 'proposal_manifest.json').read_text(encoding='utf-8'))
    if manifest['recordingSha256'] != hashlib.sha256(args.recording.read_bytes()).hexdigest() or manifest['scriptSha256'] != hashlib.sha256(args.script.read_bytes()).hexdigest():
        raise SystemExit('Recording/script changed since proposals. Re-review required.')
    with all_path.open(newline='', encoding='utf-8') as handle:
        rows = list(csv.DictReader(handle))
    row_ids = [row['id'] for row in rows]
    if len(set(row_ids)) != len(row_ids) or not set(manifest['proposalRows']).issubset(row_ids):
        raise SystemExit('Review rows deleted/duplicated. Keep all proposals; explicitly OMIT false positives.')
    reviewed = finalize(records, rows, args.reviewer)
    output = args.output / f"{records[0]['session']}.jsonl"
    text = '\n'.join(json.dumps(record) for record in reviewed)+'\n'
    output.write_text(text, encoding='utf-8')
    proof = {'v': 1, 'complete': True, 'independent': True, 'reviewer': args.reviewer,
             'synthetic': records[0]['synthetic'], 'recordingSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
             'sourceSha256': manifest['recordingSha256'], 'reviewRows': len(rows),
             'reviewedPunches': sum(r['type'] == 'label' for r in reviewed),
             'negativeIntervals': [{'start': float(row['start_phone_ms']), 'end': float(row['end_phone_ms']), 'kind': row['reviewed_kind']} for row in rows if row['category'] == 'negative'],
             'method': 'Human independently inspected all peaks and full negative/free intervals; script and raw-speed proposals are not truth.'}
    output.with_suffix('.review.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(f'Wrote reviewed recording and sidecar: {output}. Consent to Git sharing must still be checked separately.')


if __name__ == '__main__':
    main()
