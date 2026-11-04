import tempfile
from pathlib import Path
import unittest

import numpy as np

from eval.screen_training_clips import exact_summary, global_candidates, inspect, pair_rms, policy_reasons


class ScreeningTest(unittest.TestCase):
    def test_policy_reasons_overlap_and_reject_non_numeric_ratio(self):
        meta = {"clip": "A", "label": "missing", "dur_ratio": True}
        self.assertEqual(policy_reasons(meta, {"A"}),
                         ["common_excluded", "label_not_ok", "invalid_dur_ratio"])
        for ratio in (None, float("nan"), 1.5, 0.84):
            self.assertIn("invalid_dur_ratio", policy_reasons({**meta, "label": "ok", "dur_ratio": ratio}, set()))
        self.assertEqual(policy_reasons({**meta, "label": "ok", "dur_ratio": 0.85}, set()), [])

    def test_exact_groups_distinguish_excluded_and_within_split(self):
        rows = [{"clip": "A", "item": "W", "split": "train", "in_selected_dataset": True},
                {"clip": "B", "item": "W", "split": "train", "in_selected_dataset": True},
                {"clip": "C", "item": "X", "split": "test", "in_selected_dataset": False}]
        _, summary = exact_summary({"hash": [0, 1, 2]}, rows)
        self.assertEqual(summary["cross_split_groups"], 1)
        self.assertEqual(summary["within_split_groups"], 1)
        self.assertEqual(summary["selected_cross_split_groups"], 0)
        self.assertEqual(summary["selected_within_split_groups"], 1)
        self.assertEqual(summary["different_item_groups"], 1)

    def test_projection_retrieval_and_direct_rms_verification(self):
        rng = np.random.default_rng(19)
        positions = rng.normal(size=(32, 4, 3, 3)).astype(np.float32)
        positions[5] = positions[2] + 0.001
        pairs, _ = global_candidates(positions, list(range(32)), list(range(32)), 0.01)
        self.assertIn((2, 5), pairs)
        found = list(pair_rms(positions, [(2, 5), (2, 7)], 0.01))
        self.assertEqual([(i, j) for i, j, _ in found], [(2, 5)])
        self.assertAlmostEqual(found[0][2], 0.001, places=6)

    def test_frozen_motion_is_flagged_even_when_label_policy_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "npy").mkdir()
            np.save(root / "npy/A.npy", np.zeros((20, 375), np.float32))
            meta = {"clip": "A", "item": "W", "signer": "S", "label": "ok", "dur_ratio": 1.,
                    "frames": 20, "active": [1, 18], "norm": {"scale": 0.3}}
            split = {"signers": {"train": ["S"], "val": [], "test": []}, "exclude": {"clips": []}}
            row, positions = inspect(meta, root, split, {"A"})
            self.assertTrue(row["policy_eligible"])
            self.assertIn("frozen_full_clip", row["flags"])
            self.assertIn("zero_coordinates", row["flags"])
            self.assertEqual(positions.shape, (64, 55, 3))
            self.assertNotIn("structural_error", row)


if __name__ == "__main__":
    unittest.main()
