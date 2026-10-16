import csv
import json
from pathlib import Path
import pytest
from eval_voice import COMMANDS, FIELDS, canonical, evaluate, load_csv
from generate_voice_regression import mix_samples, private_output


def row(**changes):
    return {'utterance_id': 'case_001', 'source': 'human', 'speaker': 'S001', 'condition': 'quiet',
            'expected': 'start', 'recognized': 'start', 'confidence': '0.9', 'consent': 'true',
            'on_device': 'true', 'recognition_status': 'ok', **changes}


def test_exact_allowlist_is_fail_safe():
    assert canonical(' Start ') == 'start'
    assert canonical('next round') == 'next round'
    assert canonical('please start') == 'unknown'
    assert canonical('next rounds') == 'unknown'
    assert canonical('pause; harder') == 'unknown'


def test_mismatch_unknown_low_confidence_and_errors_are_not_successes():
    rows = [row(), row(utterance_id='c2', recognized='pause'), row(utterance_id='c3', recognized='unknown'),
            row(utterance_id='c4', confidence='0.74'), row(utterance_id='c5', recognized='unknown', confidence='', recognition_status='error'),
            row(utterance_id='c6', recognized='unknown', confidence='', recognition_status='skipped')]
    result = evaluate(rows)['human']['conditions']['quiet']
    assert result['commandMatches'] == 1
    assert result['commandAttempts'] == 5
    assert result['commandSuccessFraction'] == 0.2
    assert result['wrongActions'] == 1
    assert result['rejectedCommands'] == 2
    assert result['recognizerErrors'] == 1
    assert result['skipped'] == 1
    assert result['perCommand'][0]['attempts'] == 5
    assert result['perCommand'][0]['matches'] == 1
    assert all(c['successFraction'] is None for c in result['perCommand'][1:])


def test_unknown_negatives_do_not_inflate_command_success():
    result = evaluate([row(expected='unknown', recognized='unknown'), row(utterance_id='c2', expected='unknown')])
    condition = result['human']['conditions']['quiet']
    assert condition['correctOutcomes'] == 1
    assert condition['wrongActions'] == 1
    assert condition['commandAttempts'] == 0
    assert condition['commandSuccessFraction'] is None


@pytest.mark.parametrize('changes', [
    {'consent': 'false'}, {'consent': ''}, {'on_device': 'false'}, {'confidence': 'nan'}, {'confidence': '1.01'},
    {'confidence': '-0.1'}, {'confidence': ''}, {'speaker': 'Real Name'}, {'speaker': 'Baher'},
    {'recognized': 'please start'}, {'recognized': 'START'}, {'expected': 'quit'}, {'recognition_status': 'made_up'},
    {'recognition_status': 'skipped'}, {'source': 'unit'}, {'condition': 'beat-low'}, {'audio_path': 'private.wav'}])
def test_rejects_unconsented_unverified_private_or_invalid_results(changes):
    with pytest.raises(ValueError):
        evaluate([row(**changes)])


def test_synthetic_is_separate_and_never_human_evidence():
    synthetic = row(utterance_id='tts_1', source='synthetic', speaker='TTS001', consent='false', on_device='false', condition='beat-low')
    result = evaluate([row(), synthetic])
    assert result['human']['rows'] == 1
    assert result['syntheticSpeechRegression']['rows'] == 1
    assert result['syntheticSpeechRegression']['evidenceReady'] is False
    assert result['human']['evidenceReady'] is False
    assert result['gatePass'] is False
    assert 'S001' not in json.dumps(result)
    assert 'TTS001' not in json.dumps(result)


def test_missing_recognizer_is_skipped_not_perfect():
    result = evaluate([row(source='synthetic', speaker='TTS001', consent='false', on_device='false',
                           recognized='unknown', confidence='', recognition_status='skipped')])
    condition = result['syntheticSpeechRegression']['conditions']['quiet']
    assert condition['commandAttempts'] == 0
    assert condition['commandSuccessFraction'] is None
    assert result['human'] is None


def complete_rows():
    return [row(utterance_id=f'{speaker}_{condition}_{command.replace(" ","_")}_{repeat}', speaker=speaker,
                condition=condition, expected=command, recognized=command)
            for speaker in ['S001', 'S002', 'S003'] for condition in ['quiet', 'beat'] for command in COMMANDS for repeat in range(20)]


def test_human_readiness_requires_same_three_speakers_all_seven_commands_twenty_each_condition():
    rows = complete_rows()
    result = evaluate(rows)
    assert result['human']['evidenceReady'] is True
    assert result['human']['qualifiedHumanSpeakerCount'] == 3
    assert result['gatePass'] is False
    assert evaluate(rows[:-1])['human']['evidenceReady'] is False
    missing = rows[-1].copy();missing.update(recognition_status='skipped', recognized='unknown', confidence='')
    assert evaluate(rows[:-1]+[missing])['human']['evidenceReady'] is False
    # Synthetic cases cannot fill a missing real person's test cell.
    synthetic = row(source='synthetic', speaker='TTS001', consent='false', on_device='false')
    assert evaluate(rows[:-1]+[synthetic])['human']['evidenceReady'] is False


def test_duplicate_utterances_and_empty_inputs_fail():
    with pytest.raises(ValueError):evaluate([])
    with pytest.raises(ValueError):evaluate([row(), row()])
    with pytest.raises(ValueError):evaluate([row()], confidence_threshold=float('nan'))


def test_csv_schema_forbids_extra_sensitive_columns(tmp_path):
    path = tmp_path/'outcomes.csv'
    with path.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS);writer.writeheader();writer.writerow(row())
    assert evaluate(load_csv(path))['human']['rows'] == 1
    path.write_text('speaker,audio_path\nS001,secret.wav\n')
    with pytest.raises(ValueError):load_csv(path)


def test_mixing_is_deterministic_has_padding_and_noise_and_rejects_silence():
    speech = [1000, -1000, 500, -500]*100
    quiet = mix_samples(speech, 0)
    noisy = mix_samples(speech, 0.3)
    assert noisy == mix_samples(speech, 0.3)
    assert len(noisy) == len(speech)+16000
    assert quiet != noisy
    assert max(abs(v) for v in noisy) < 32767
    assert all(v == 0 for v in quiet[:8000])
    with pytest.raises(ValueError):mix_samples([0]*50, 0)
    with pytest.raises(ValueError):mix_samples(speech, 0.9)


def test_voice_output_cannot_leave_local_private(tmp_path):
    with pytest.raises(ValueError):private_output(tmp_path/'voices')
