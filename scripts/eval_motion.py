"""Leave-one-person-out evaluation using real, consented JSONL keypoints only.

Run after conda activate amazon-tv:
python scripts/eval_motion.py recordings --output results/motion_eval.csv
Candidate thresholds are selected on training people per fold. Synthetic data is rejected.
"""
import argparse
import csv
import json
import hashlib
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def require_independent_review(path, header):
    if header.get('trainingOnly') is True or header.get('participant') == 'm1-training-person':
        raise ValueError('M1 self-test person is training-only and must never be evaluated.')
    if header.get('synthetic') is not False or header.get('labelsExpected') is True:
        raise ValueError('Expected scripted actions and synthetic recordings are not ground truth.')
    proof_path = path.with_suffix('.review.json')
    if not proof_path.exists():
        raise ValueError('Independent review sidecar required for every real evaluation session.')
    proof = json.loads(proof_path.read_text(encoding='utf-8'))
    if proof.get('complete') is not True or proof.get('independent') is not True or proof.get('synthetic') is not False or not proof.get('reviewer') or proof.get('recordingSha256') != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError('Incomplete, synthetic, or stale independent review manifest.')
    previous_end = -1
    for interval in sorted(proof.get('negativeIntervals', []), key=lambda value: value.get('start', -1)):
        if any(not isinstance(interval.get(k), (int, float)) or not math.isfinite(interval[k]) for k in ('start', 'end')) or interval['start'] < 0 or interval['end'] <= interval['start'] or interval['start'] < previous_end or interval.get('kind') not in ('idle', 'dance', 'talk'):
            raise ValueError('Invalid or overlapping independently reviewed negative intervals.')
        previous_end = interval['end']
    return proof


def score(sessions, predictions, window):
    """One-to-one timestamp matching, independent of predicted class."""
    tp = fp = fn = correct = 0
    errors = []
    idle_seconds = 0.0
    idle_fp = 0
    negative_seconds = 0.0
    negative_fp = 0
    for session in sessions:
        labels = session['labels']
        events = predictions[str(session['path'])]['events']
        matched_labels = set()
        matched_events = set()
        pairs = sorted((abs(e['t_peak'] - label['t']), i, j)
                       for i, e in enumerate(events) for j, label in enumerate(labels)
                       if abs(e['t_peak'] - label['t']) <= window)
        for delta, i, j in pairs:
            if i in matched_events or j in matched_labels:
                continue
            matched_events.add(i)
            matched_labels.add(j)
            correct += events[i]['kind'] == labels[j]['kind']
            errors.append(delta)
        tp += len(matched_events)
        fp += len(events) - len(matched_events)
        fn += len(labels) - len(matched_labels)
        # Explicit label-free sessions are negative samples, not inferred idle spans.
        if not labels and not session.get('negativeIntervals'):
            frames = session['frames']
            idle_seconds += (frames[-1]['t'] - frames[0]['t']) / 1000
            idle_fp += len(events)
        for interval in session.get('negativeIntervals', []):
            begin, end = max(interval['start'], session['frames'][0]['t']), min(interval['end'], session['frames'][-1]['t'])
            if not begin < end:
                continue
            # Remove independently labelled actual-punch neighborhoods from negative exposure.
            excluded = sorted((max(begin, label['t']-window), min(end, label['t']+window)) for label in labels if begin-window <= label['t'] <= end+window)
            merged = []
            for lo, hi in excluded:
                if lo >= hi:
                    continue
                if merged and lo <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
                else:
                    merged.append((lo, hi))
            seconds = max(0, end-begin-sum(hi-lo for lo, hi in merged))/1000
            false_events = sum(i not in matched_events and begin <= e['t_peak'] <= end and not any(lo <= e['t_peak'] <= hi for lo, hi in merged) for i, e in enumerate(events))
            negative_seconds += seconds
            negative_fp += false_events
            if interval['kind'] == 'idle':
                idle_seconds += seconds
                idle_fp += false_events
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    return {'tp': tp, 'fp': fp, 'fn': fn,
            'precision': precision, 'recall': recall,
            'f1': 2 * precision * recall / (precision + recall) if precision + recall else 0,
            'type_accuracy': correct / tp if tp else '',
            'timing_mae_ms': statistics.mean(errors) if errors else '',
            'timing_sd_ms': statistics.pstdev(errors) if errors else '',
            'idle_false_alarms_per_min': idle_fp * 60 / idle_seconds if idle_seconds else '',
            'negative_false_alarms_per_min': negative_fp * 60 / negative_seconds if negative_seconds else '',
            'guard_recovery_precision': '', 'guard_recovery_recall': ''}


def predict(sessions, config):
    result = subprocess.run([shutil.which('node'), '--import', 'tsx',
                             str(ROOT / 'scripts/replay_motion.ts'), json.dumps(config),
                             *[str(s['path']) for s in sessions]],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    return {row['file']: row for row in map(json.loads, result.stdout.splitlines())}


def main():
    if os.environ.get('CONDA_DEFAULT_ENV') != 'amazon-tv':
        raise SystemExit('Activate amazon-tv before running evaluation.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recordings', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'results/motion_eval.csv')
    parser.add_argument('--window-ms', type=float, default=150)
    args = parser.parse_args()
    if not 0 < args.window_ms <= 500:
        raise SystemExit('Matching window must be in (0, 500] milliseconds.')
    sessions = []
    for path in sorted(args.recordings.glob('*.jsonl')):
        records = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
        if not records:
            raise SystemExit(f'Empty recording: {path}')
        header = records[0]
        if header.get('consent') is not True or header.get('synthetic') is not False:
            raise SystemExit(f'Real evaluation requires explicit consent and synthetic:false: {path}')
        try:
            review = require_independent_review(path, header)
        except ValueError as error:
            raise SystemExit(f'No evaluation produced for {path}: {error}') from error
        frames = [r for r in records if r.get('type') == 'keypoints']
        if len(frames) < 2:
            raise SystemExit(f'Recording needs at least two frames: {path}')
        sessions.append({'path': path.resolve(), 'header': header, 'frames': frames,
                         'negativeIntervals': review.get('negativeIntervals', []),
                         'labels': [r for r in records if r.get('type') == 'label']})
    people = sorted({s['header']['participant'] for s in sessions})
    if len(people) < 3:
        raise SystemExit('No evaluation produced: need real recordings from at least three consented people.')
    if len({(s['header']['participant'], s['header']['session']) for s in sessions}) != len(sessions):
        raise SystemExit('Duplicate participant/session identifiers; merge or rename sessions.')
    candidates = [{'speedOn': v, 'minExtension': e} for v in (1.0, 1.5, 2.0) for e in (0.65, 0.72, 0.8)]
    rows = []
    for held_out in people:
        train = [s for s in sessions if s['header']['participant'] != held_out]
        test = [s for s in sessions if s['header']['participant'] == held_out]
        candidates_scored = [(score(train, predict(train, cfg), args.window_ms)['f1'], cfg) for cfg in candidates]
        _, fitted = max(candidates_scored, key=lambda item: item[0])
        metrics = score(test, predict(test, fitted), args.window_ms)
        rows.append({'held_out_participant': held_out, 'training_people': len(people)-1,
                     'test_sessions': len(test), 'test_punches': sum(len(s['labels']) for s in test),
                     'speed_on': fitted['speedOn'], 'min_extension': fitted['minExtension'],
                     'matching_window_ms': args.window_ms, **metrics})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f'Wrote {len(rows)} held-out folds to {args.output}. Guard P/R is blank: independent guard labels are not implemented.')
    if sum(len(s['labels']) for s in sessions) < 300 or any(sum(s['header']['participant'] == p for s in sessions) < 2 for p in people):
        print('Dataset below G2 minimum (300 punches and two sessions per person); this report cannot establish G2 PASS.')


if __name__ == '__main__':
    main()
