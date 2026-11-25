"""Entirely synthetic arrays/labels; no AI Hub fixtures or network access."""
from pathlib import Path
import tempfile
import unittest

import numpy as np

from gen import word_eval_clips as W

SPLIT = {"mode": "signer", "signers": {"train": ["A", "B"], "val": ["V"], "test": ["T1", "T2"]}}


def meta(item, signer, frames=20, active=(6, 10)):
    return {"clip": f"{item}_{signer}", "item": item, "signer": signer, "type": "WORD",
            "frames": frames, "active": list(active)}


class WordEvalClipsTest(unittest.TestCase):
    def test_test_clips_only_test_signers_and_known_words(self):
        metas = [meta("WORD1", s) for s in ("A", "V", "T1", "T2")] + [meta("WORD9", "T1"),
                 {**meta("SEN1", "T1"), "type": "SEN"}]
        clips = W.test_clips(metas, SPLIT, {"WORD1"})
        self.assertEqual([m["clip"] for m in clips], ["WORD1_T1", "WORD1_T2"])
        with self.assertRaises(ValueError):
            W.test_clips(metas, {"mode": "item", "test_items": []}, {"WORD1"})

    def test_b1_candidates_capped_and_medoid_of_decoded(self):
        rows = [{"clip": f"WORD1_S{k:02d}", "item": "WORD1", "signer": f"S{k:02d}", "tokens": [k]}
                for k in range(40)] + [{"clip": "WORD2_A", "item": "WORD2", "signer": "A", "tokens": [0]},
                                       {"clip": "WORD3_A", "item": "WORD3", "signer": "A", "tokens": [0]}]
        cands = W.b1_candidates(rows, {"WORD1", "WORD2"}, per_word=32, seed=17)
        self.assertEqual(sorted(cands), ["WORD1", "WORD2"])
        self.assertEqual(len(cands["WORD1"]), 32)
        self.assertEqual(cands, W.b1_candidates(rows, {"WORD1", "WORD2"}, per_word=32, seed=17))
        # 값 = 토큰 하나: 0, 1, 5 중 가운데(1)가 대표
        decode = lambda t: np.full((8, 125, 3), float(t[0]), np.float32)
        three = [{"clip": c, "tokens": [v]} for c, v in (("a", 0), ("b", 1), ("c", 5))]
        x, clip = W.b1_medoid(three, decode)
        self.assertEqual(clip, "b")
        self.assertEqual(x.shape, (8, 375))
        self.assertEqual(x.dtype, np.float32)

    def test_pick_signers_excludes_null_and_forbidden(self):
        trained = {"A": 0, "B": 1, "C": 2, "T1": 3, "NO_SIGNER": 4}
        got = W.pick_signers(trained, {"T1"}, 3, seed=0)
        self.assertEqual(got, ["A", "B", "C"])
        self.assertEqual(W.pick_signers(trained, {"T1"}, 2, 0), W.pick_signers(trained, {"T1"}, 2, 0))
        with self.assertRaises(ValueError):
            W.pick_signers(trained, {"T1"}, 4, 0)

    def test_manifest_drops_words_missing_a_condition_and_checks(self):
        clips = [meta("WORD1", "T1"), meta("WORD1", "T2"), meta("WORD2", "T1")]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "b1").mkdir()
            (out / "oursh").mkdir()
            np.save(out / "b1/WORD1.npy", np.zeros((9, 375), np.float32))
            np.save(out / "b1/WORD2.npy", np.zeros((9, 375), np.float32))
            names = []
            for k in range(2):
                np.save(out / f"oursh/WORD1_{k}.npy", np.zeros((16, 375), np.float32))
                names.append(f"oursh/WORD1_{k}.npy")
            records, dropped = W.build_manifest(clips, {"WORD1": "b1/WORD1.npy", "WORD2": "b1/WORD2.npy"},
                                                {"WORD1": names})
            self.assertEqual(dropped, ["WORD2_T1"])
            self.assertEqual({r["clip"] for r in records}, {"WORD1_T1", "WORD1_T2"})
            self.assertEqual(records[0]["conditions"]["Ours-H"]["motions"], records[1]["conditions"]["Ours-H"]["motions"])
            allowed = {m["clip"] for m in clips}
            W.check_manifest(out, records, allowed, 2)
            with self.assertRaises(ValueError):
                W.check_manifest(out, records, allowed, 5)
            with self.assertRaises(ValueError):
                W.check_manifest(out, records, {"WORD1_T1"}, 2)
            np.save(out / "oursh/WORD1_1.npy", np.zeros((16, 125, 3), np.float32))
            with self.assertRaises(ValueError):
                W.check_manifest(out, records, allowed, 2)


if __name__ == "__main__":
    unittest.main()
