"""Synthetic unit fixtures for independent review safeguards, never accuracy evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from align_recording import finalize, FIELDS
from eval_motion import require_independent_review


class IndependentReviewTests(unittest.TestCase):
    def records(self):
        return [{'type': 'session', 'labelsExpected': True, 'synthetic': True},
                {'type': 'keypoints', 't': 100}, {'type': 'keypoints', 't': 500}]

    def row(self, **values):
        return {**dict.fromkeys(FIELDS, ''), 'id': 'cue-1', 'category': 'punch',
                'decision': 'CONFIRM', 'reviewed_peak_ms': '200', 'reviewed_kind': 'jab',
                'reviewed_hand': 'left', 'review_notes': 'Independent unit-test decision.', **values}

    def test_expected_proposals_never_automatically_truth(self):
        with self.assertRaises(ValueError):
            finalize(self.records(), [self.row(decision='PENDING')], 'reviewer')
        with self.assertRaises(ValueError):
            finalize(self.records(), [self.row(review_notes='')], 'reviewer')
        with self.assertRaises(ValueError):
            finalize(self.records(), [self.row(reviewed_peak_ms='')], 'reviewer')
        result = finalize(self.records(), [self.row()], 'reviewer')
        self.assertFalse(result[0]['labelsExpected'])
        self.assertEqual(result[-1]['t'], 200)

    def test_negative_intervals_require_full_inspection(self):
        with self.assertRaises(ValueError):
            finalize(self.records(), [self.row(category='negative', decision='OMIT')], 'reviewer')
        result = finalize(self.records(), [self.row(category='negative', decision='INTERVAL_REVIEWED', reviewed_kind='idle')], 'reviewer')
        self.assertFalse(any(r['type'] == 'label' for r in result))

    def test_eval_rejects_missing_stale_synthetic_and_expected_review(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'unit.jsonl'; path.write_text('unit fixture only', encoding='utf-8')
            with self.assertRaises(ValueError):
                require_independent_review(path, {'synthetic': False})
            proof = {'complete': True, 'independent': True, 'synthetic': False,
                     'reviewer': 'reviewer', 'recordingSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            path.with_suffix('.review.json').write_text(json.dumps(proof), encoding='utf-8')
            require_independent_review(path, {'synthetic': False, 'labelsExpected': False})
            with self.assertRaises(ValueError):
                require_independent_review(path, {'synthetic': False, 'trainingOnly': True})
            with self.assertRaises(ValueError):
                require_independent_review(path, {'synthetic': False, 'labelsExpected': True})
            with self.assertRaises(ValueError):
                require_independent_review(path, {'synthetic': True})
            path.write_text('modified fixture', encoding='utf-8')
            with self.assertRaises(ValueError):
                require_independent_review(path, {'synthetic': False})


if __name__ == '__main__':
    unittest.main()
