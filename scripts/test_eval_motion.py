"""Synthetic unit tests for evaluator matching; never accuracy evidence."""
import unittest
from pathlib import Path
from eval_motion import score


class MatchingTests(unittest.TestCase):
    def session(self, labels):
        return {'path': Path('fixture.jsonl'), 'labels': labels,
                'frames': [{'t': 0}, {'t': 60000}]}

    def test_one_to_one_matching_and_type_error(self):
        session = self.session([{'t': 100, 'kind': 'jab'}, {'t': 200, 'kind': 'cross'}])
        predictions = {'fixture.jsonl': {'events': [{'t_peak': 105, 'kind': 'cross'},
                                                   {'t_peak': 110, 'kind': 'jab'},
                                                   {'t_peak': 800, 'kind': 'jab'}]}}
        result = score([session], predictions, 30)
        self.assertEqual((result['tp'], result['fp'], result['fn']), (1, 2, 1))
        self.assertEqual(result['type_accuracy'], 0)
        self.assertEqual(result['timing_mae_ms'], 5)

    def test_idle_and_no_measured_guard_claim(self):
        result = score([self.session([])], {'fixture.jsonl': {'events': [{'t_peak': 500, 'kind': 'jab'}]}}, 30)
        self.assertEqual(result['idle_false_alarms_per_min'], 1)
        self.assertEqual(result['guard_recovery_precision'], '')
        self.assertEqual(result['timing_mae_ms'], '')

    def test_reviewed_negative_intervals_exclude_true_punch_neighborhoods(self):
        session = self.session([{'t': 10000, 'kind': 'jab'}])
        session['negativeIntervals'] = [{'start': 0, 'end': 60000, 'kind': 'idle'}]
        predictions = {'fixture.jsonl': {'events': [{'t_peak': 10000, 'kind': 'jab'},
                                                   {'t_peak': 10005, 'kind': 'jab'},
                                                   {'t_peak': 40000, 'kind': 'jab'}]}}
        result = score([session], predictions, 100)
        self.assertEqual(result['tp'], 1)
        self.assertAlmostEqual(result['idle_false_alarms_per_min'], 60 / 59.8)
        self.assertEqual(result['negative_false_alarms_per_min'], result['idle_false_alarms_per_min'])


if __name__ == '__main__':
    unittest.main()
