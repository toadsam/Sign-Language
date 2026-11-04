import json
from pathlib import Path
import tempfile
import unittest

from eval.evaluate_selected_token_test import MODES, summarize, validate_selection
from eval.evaluate_backtranslation import digest


class SelectedTest(unittest.TestCase):
    def test_paired_changes_and_signers(self):
        rows = []
        for i, (old, new, signer) in enumerate(((True, True, 'A'), (False, True, 'A'), (True, False, 'B'))):
            row = {'clip': str(i), 'signer': signer}
            for mode in MODES:
                hit = new if mode == 'selected' else old
                row[mode] = {'top1_correct': hit, 'top5_correct': True}
            rows.append(row)
        r = summarize(rows)
        self.assertEqual((r['newly_correct'], r['newly_wrong']), (1, 1))
        self.assertEqual(r['delta_top1_pp'], 0)
        self.assertEqual(r['metrics']['selected']['top5'], 1)
        self.assertEqual(r['by_signer']['A']['selected']['correct_top1'], 2)
        with self.assertRaises(ValueError):
            summarize(rows + [rows[0]])

    def test_selection_binds_val_evidence_and_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidates = {}
            for name, hits in (('zero', 4234), ('d01', 4282), ('d005', 4260)):
                folder = Path(tmp) / name; folder.mkdir()
                file = folder / 'summary.json'
                file.write_text(json.dumps({'partition': 'val', 'clips': 5453, 'protected_hashes_unchanged': True,
                    'metrics': {'candidate_roundtrip': {'correct_top1': hits}}}))
                (folder / 'manifest.json').write_text(json.dumps({'model_sha256': name}))
                candidates[name] = {'summary_path': str(file), 'summary_sha256': digest(file), 'model_sha256': name}
            selection = {'selection_partition': 'val', 'selection_metric': 'top1', 'selected_id': 'd01',
                         'control_id': 'zero', 'val_candidates': candidates}
            self.assertEqual(validate_selection(selection)['selected']['model_sha256'], 'd01')
            selection['selected_id'] = 'd005'
            with self.assertRaises(ValueError): validate_selection(selection)
            selection['selected_id'] = 'd01'
            Path(candidates['d01']['summary_path']).write_text('{}')
            with self.assertRaises(ValueError): validate_selection(selection)


if __name__ == '__main__':
    unittest.main()
