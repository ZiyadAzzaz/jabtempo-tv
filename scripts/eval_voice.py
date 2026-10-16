"""Evaluate recorded command outcomes; synthetic speech never establishes human accuracy.

This program does not synthesize recognizer results or access any microphone.
"""
import argparse
from collections import Counter
import csv
import json
import math
from pathlib import Path
import re

COMMANDS = ('start', 'pause', 'resume', 'harder', 'easier', 'next round', 'two players')
FIELDS = ('utterance_id', 'source', 'speaker', 'condition', 'expected', 'recognized',
          'confidence', 'consent', 'on_device', 'recognition_status')


def canonical(value):
    """Exact command allowlist. Never fuzzy-match a longer phrase into an action."""
    word = value.strip().lower()
    return word if word in COMMANDS else 'unknown'


def boolean(value):
    if value not in ('true', 'false'):
        raise ValueError('boolean fields require true/false')
    return value == 'true'


def validate_rows(rows):
    validated, seen = [], set()
    for row in rows:
        if set(row) != set(FIELDS) or any(not isinstance(v, str) for v in row.values()):
            raise ValueError('voice CSV requires exactly the documented columns')
        source = row['source']
        if source not in ('human', 'synthetic'):
            raise ValueError('source must distinguish human/synthetic')
        expected, recognized = row['expected'], row['recognized']
        if expected not in (*COMMANDS, 'unknown') or recognized not in (*COMMANDS, 'unknown'):
            raise ValueError('expected/recognized require canonical commands or unknown; raw transcripts forbidden')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', row['utterance_id']):
            raise ValueError('utterance_id must be an opaque local identifier')
        if (source, row['utterance_id']) in seen:
            raise ValueError('duplicate utterance_id within source')
        seen.add((source, row['utterance_id']))
        pattern = r'S\d{3}' if source == 'human' else r'TTS\d{3}'
        if not re.fullmatch(pattern, row['speaker']):
            raise ValueError('use anonymous speaker codes S001 or TTS001; never names')
        consent, on_device = boolean(row['consent']), boolean(row['on_device'])
        if source == 'human' and not consent:
            raise ValueError('human voice evaluation requires explicit consent')
        if source == 'human' and not on_device:
            raise ValueError('human command evaluation requires verified on-device recognition')
        conditions = ('quiet', 'beat') if source == 'human' else ('quiet', 'beat-low', 'beat-medium', 'beat-high')
        if row['condition'] not in conditions:
            raise ValueError('unsupported condition for source')
        status = row['recognition_status']
        if status not in ('ok', 'error', 'skipped'):
            raise ValueError('recognition_status must be ok/error/skipped')
        confidence = None
        if row['confidence']:
            try:
                confidence = float(row['confidence'])
            except ValueError as error:
                raise ValueError('invalid recognizer confidence') from error
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise ValueError('confidence must be finite and in 0..1')
        if status == 'ok' and confidence is None:
            raise ValueError('successful recognizer attempt requires its observed confidence')
        if status != 'ok' and recognized != 'unknown':
            raise ValueError('failed/skipped attempts cannot claim a recognized command')
        validated.append({**row, 'confidence': confidence})
    if not validated:
        raise ValueError('no recorded rows; no metrics generated')
    return validated


def evaluate(rows, confidence_threshold=0.75):
    if not math.isfinite(confidence_threshold) or not 0 <= confidence_threshold <= 1:
        raise ValueError('invalid action confidence threshold')
    rows = validate_rows(rows)
    result = {'confidenceThreshold': confidence_threshold, 'gatePass': False,
              'note': 'Recorded human evidence and synthetic speech regression are separate; no usability or G3 gate is inferred.',
              'human': None, 'syntheticSpeechRegression': None}
    for source, label in [('human', 'human'), ('synthetic', 'syntheticSpeechRegression')]:
        group = [r for r in rows if r['source'] == source]
        if not group:
            continue
        attempted = [r for r in group if r['recognition_status'] != 'skipped']
        coverage = Counter((r['speaker'], r['condition'], r['expected']) for r in attempted if r['expected'] in COMMANDS)
        speakers = sorted({r['speaker'] for r in group})
        qualified = [speaker for speaker in speakers if all(coverage[(speaker, condition, command)] >= 20
                     for condition in ('quiet', 'beat') for command in COMMANDS)] if source == 'human' else []
        by_condition = {}
        for condition in sorted({r['condition'] for r in group}):
            cases = [r for r in group if r['condition'] == condition]
            correct = wrong_action = rejected = errors = skipped = 0
            for row in cases:
                if row['recognition_status'] == 'skipped':
                    skipped += 1
                    continue
                if row['recognition_status'] == 'error':
                    errors += 1
                    continue
                action = row['recognized'] if row['confidence'] >= confidence_threshold else 'unknown'
                correct += action == row['expected']
                wrong_action += action != 'unknown' and action != row['expected']
                rejected += action == 'unknown' and row['expected'] != 'unknown'
            command_attempts = [r for r in cases if r['expected'] in COMMANDS and r['recognition_status'] != 'skipped']
            command_correct = sum(r['recognition_status'] == 'ok' and r['confidence'] >= confidence_threshold
                                  and r['recognized'] == r['expected'] for r in command_attempts)
            per_command = []
            for command in COMMANDS:
                command_rows = [r for r in cases if r['expected'] == command]
                attempts = [r for r in command_rows if r['recognition_status'] != 'skipped']
                matches = sum(r['recognition_status'] == 'ok' and r['confidence'] >= confidence_threshold
                              and r['recognized'] == command for r in attempts)
                per_command.append({'command': command, 'attempts': len(attempts), 'matches': matches,
                                    'errors': sum(r['recognition_status'] == 'error' for r in command_rows),
                                    'skipped': len(command_rows)-len(attempts),
                                    'successFraction': matches/len(attempts) if attempts else None})
            by_condition[condition] = {'plannedRows': len(cases), 'attemptedRows': len(cases)-skipped,
                                       'correctOutcomes': correct, 'wrongActions': wrong_action, 'rejectedCommands': rejected,
                                       'recognizerErrors': errors, 'skipped': skipped,
                                       'commandAttempts': len(command_attempts), 'commandMatches': command_correct,
                                       'commandSuccessFraction': command_correct/len(command_attempts) if command_attempts else None,
                                       'perCommand': per_command}
        result[label] = {'label': 'human recorded on-device outcomes' if source == 'human' else 'synthetic speech regression — never human recognition accuracy',
                         'rows': len(group), 'speakerCount': len(speakers), 'conditions': by_condition,
                         'evidenceReady': source == 'human' and len(qualified) >= 3,
                         'qualifiedHumanSpeakerCount': len(qualified) if source == 'human' else 0}
    return result


def load_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if tuple(reader.fieldnames or ()) != FIELDS:
            raise ValueError('CSV header differs from documented schema')
        return list(reader)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--confidence-threshold', type=float, default=0.75)
    args = parser.parse_args()
    try:
        summary = evaluate(load_csv(args.input), args.confidence_threshold)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    text = json.dumps(summary, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding='utf-8')
    else:
        print(text, end='')


if __name__ == '__main__':
    main()
