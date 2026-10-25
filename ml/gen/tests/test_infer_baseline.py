"""Entirely synthetic arrays/labels; no AI Hub fixtures or network access."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from gen.infer import Generator
from gen.vocab import select_train


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def make_meta(item="WORD1", signer="TRAIN", **updates):
    meta = {"clip": f"{item}_{signer}", "item": item, "signer": signer, "type": "WORD",
            "label": "ok", "dur_ratio": 1.0, "frames": 20, "active": [6, 10], "gloss": ["가"]}
    meta.update(updates)
    return meta


def make_run(root, metas=None, blend=0):
    """Create a local, disposable run and conspicuously artificial coordinates."""
    root = Path(root)
    data, run = root / "data", root / "run"
    (data / "npy").mkdir(parents=True)
    run.mkdir()
    if metas is None:
        metas = [make_meta(), make_meta("WORD2", gloss=["나"])]
    write_metas(data, metas)
    for i, meta in enumerate(metas):
        array = np.full((meta["frames"], 125, 3), i + 1, dtype=np.float32)
        np.save(data / "npy" / f"{meta['clip']}.npy", array)
    write_json(root / "split.json", {"mode": "signer", "signers": {
        "train": ["TRAIN", "ZTRAIN"], "val": ["VAL"], "test": ["TEST"]}, "exclude": {"clips": []}})
    write_json(run / "vocab_map.json", {"schema_version": 1, "mapping": {"가": "WORD1", "나": "WORD2"},
                                        "unmapped": [], "ambiguous": {}})
    write_json(run / "generator.json", {"schema_version": 1, "kind": "baseline",
        "vocab_map": "vocab_map.json", "baseline_data": "../data", "baseline_split": "../split.json",
        "blend": blend})
    return run, data


def write_metas(data, metas):
    (Path(data) / "meta.jsonl").write_text("".join(json.dumps(m) + "\n" for m in metas), encoding="utf-8")


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_order_repetition_unknown_and_contract(self):
        run, _ = make_run(self.root)
        generator = Generator(str(run))
        result = generator.generate(["나", "미등록", "가", "나", "미등록"])
        self.assertEqual(set(result), {"fps", "motion", "tokens", "unknown", "source"})
        self.assertEqual(result["fps"], 30)
        self.assertEqual(result["source"], "baseline")
        self.assertEqual(result["tokens"], [])
        self.assertEqual(result["unknown"], ["미등록", "미등록"])
        self.assertEqual(result["motion"].dtype, np.float32)
        # active [6,10] is inclusive; four frames of padding gives [2:15].
        expected = np.repeat([2, 1, 2], 13)
        np.testing.assert_array_equal(result["motion"][:, 0, 0], expected)
        self.assertEqual(result["motion"].shape, (39, 125, 3))
        self.assertTrue(np.isfinite(result["motion"]).all())

    def test_unknown_only_is_empty_float32(self):
        run, _ = make_run(self.root)
        result = Generator(run).generate(["다", "다"])
        self.assertEqual(result["motion"].shape, (0, 125, 3))
        self.assertEqual(result["motion"].dtype, np.float32)
        self.assertEqual(result["unknown"], ["다", "다"])
        self.assertEqual(result["tokens"], [])

    def test_invalid_requests_rejected(self):
        run, _ = make_run(self.root)
        generator = Generator(run)
        for gloss in ([], (), "가", [""], [" "], [3], None):
            with self.subTest(gloss=gloss), self.assertRaises(ValueError):
                generator.generate(gloss)
        with self.assertRaises(ValueError):
            generator.generate(["가"], nonmanual="의문")
        with self.assertRaises(ValueError):
            generator.generate(["가"], seed=True)

    def test_seed_and_nonmanual_do_not_change_baseline_or_global_rng(self):
        run, _ = make_run(self.root, blend=3)
        generator = Generator(run)
        before = np.random.get_state()
        plain = generator.generate(["가", "나"], seed=1)
        tagged = generator.generate(["가", "나"], nonmanual=["의문"], seed=2)
        after = np.random.get_state()
        np.testing.assert_array_equal(plain["motion"], tagged["motion"])
        np.testing.assert_array_equal(before[1], after[1])
        self.assertEqual(before[2:], after[2:])
        self.assertEqual(plain["motion"].shape, (29, 125, 3))
        np.testing.assert_allclose(plain["motion"][13:16, 0, 0], [1.25, 1.5, 1.75])

    def test_selects_eligible_train_sorted_by_clip_not_metadata_order(self):
        metas = [make_meta(signer="VAL"), make_meta(signer="TEST"),
                 make_meta(signer="ZTRAIN"), make_meta()]
        run, data = make_run(self.root, metas)
        candidates, _ = select_train(data, self.root / "split.json")
        self.assertEqual({m["clip"] for m in candidates}, {"WORD1_TRAIN", "WORD1_ZTRAIN"})
        generator = Generator(run)
        self.assertEqual(generator.selected_clips, {"WORD1": "WORD1_TRAIN"})
        np.testing.assert_array_equal(generator.generate(["가"])["motion"], 4)
        # Held-out coordinate files need not exist or be readable.
        (data / "npy" / "WORD1_VAL.npy").write_bytes(b"not an array")
        (data / "npy" / "WORD1_TEST.npy").write_bytes(b"not an array")
        write_metas(data, list(reversed(metas)))
        second = Generator(run)
        self.assertEqual(second.selected_clips, generator.selected_clips)

    def test_unusable_train_candidates_do_not_fall_back_to_heldout_exemplars(self):
        run, _ = make_run(self.root, [make_meta(active=[]), make_meta(signer="VAL"),
            make_meta(signer="TEST"), make_meta("WORD2", signer="VAL", gloss=["나"])])
        with patch("numpy.load", side_effect=AssertionError("heldout arrays must not be opened")):
            generator = Generator(run)
        self.assertEqual(generator.selected_clips, {})
        self.assertEqual(generator.selection_report["empty_or_invalid_active"], 1)
        result = generator.generate(["가", "나", "가"])
        self.assertEqual(result["unknown"], ["가", "나", "가"])
        self.assertEqual(result["motion"].shape, (0, 125, 3))
        self.assertEqual(result["tokens"], [])

    def test_invalid_active_skipped_and_next_exemplar_selected(self):
        run, _ = make_run(self.root, [make_meta(active=[10, 6]), make_meta(signer="ZTRAIN")])
        generator = Generator(run)
        self.assertEqual(generator.selected_clips["WORD1"], "WORD1_ZTRAIN")
        self.assertEqual(generator.selection_report["empty_or_invalid_active"], 1)

    def test_no_eligible_clips_is_unknown_without_trimmed_crash(self):
        run, _ = make_run(self.root, [make_meta(active=[]), make_meta("WORD2", frames=0, active=[0, -1])])
        result = Generator(run).generate(["가", "나"])
        self.assertEqual(result["motion"].shape, (0, 125, 3))
        self.assertEqual(result["unknown"], ["가", "나"])

    def test_single_frame_inclusive_active_is_valid(self):
        run, _ = make_run(self.root, [make_meta(frames=1, active=[0, 0])])
        self.assertEqual(Generator(run).generate(["가"])["motion"].shape, (1, 125, 3))

    def test_load_from_other_working_directory(self):
        run, _ = make_run(self.root)
        previous = os.getcwd()
        try:
            os.chdir(self.root / "data")
            result = Generator(run).generate(["가"])
        finally:
            os.chdir(previous)
        self.assertEqual(result["motion"].shape, (13, 125, 3))

    def test_required_config_fields_fail_at_startup(self):
        run, _ = make_run(self.root)
        original = json.loads((run / "generator.json").read_text())
        for field in ("schema_version", "kind", "vocab_map", "baseline_data", "baseline_split"):
            changed = {k: v for k, v in original.items() if k != field}
            write_json(run / "generator.json", changed)
            with self.subTest(field=field), self.assertRaises(ValueError):
                Generator(run)

    def test_model_kind_does_not_fall_back_to_baseline(self):
        run, _ = make_run(self.root)
        config = json.loads((run / "generator.json").read_text())
        config["kind"] = "sentence"
        write_json(run / "generator.json", config)
        with self.assertRaisesRegex(ValueError, "sentence"):
            Generator(run)

    def test_invalid_coordinates_fail_at_startup(self):
        run, data = make_run(self.root)
        arrays = [np.zeros((20, 124, 3), dtype=np.float32),
                  np.full((20, 125, 3), np.nan, dtype=np.float32),
                  np.full((20, 125, 3), np.inf, dtype=np.float32),
                  np.full((20, 125, 3), 1e100, dtype=np.float64),
                  np.zeros((20, 125, 3), dtype=np.int32)]
        for array in arrays:
            np.save(data / "npy" / "WORD1_TRAIN.npy", array)
            with self.subTest(dtype=array.dtype, shape=array.shape), self.assertRaises(ValueError):
                Generator(run)

    def test_missing_coordinates_fail_at_startup(self):
        run, data = make_run(self.root)
        (data / "npy" / "WORD1_TRAIN.npy").rename(data / "npy" / "held.npy")
        with self.assertRaises(FileNotFoundError):
            Generator(run)

    def test_flat_coordinates_cast_to_float32_and_no_shared_mutation(self):
        run, data = make_run(self.root)
        np.save(data / "npy" / "WORD1_TRAIN.npy", np.full((20, 375), 1.5, dtype=np.float64))
        generator = Generator(run)
        first = generator.generate(["가"])
        first["motion"][:] = 99
        next_result = generator.generate(["가"])
        self.assertEqual(next_result["motion"].dtype, np.float32)
        np.testing.assert_array_equal(next_result["motion"], 1.5)

    def test_unresolved_mapping_cannot_silently_override_ambiguity(self):
        run, _ = make_run(self.root)
        write_json(run / "vocab_map.json", {"schema_version": 1, "mapping": {"가": "WORD1"},
                                            "unmapped": [], "ambiguous": {"가": ["WORD1", "WORD2"]}})
        with self.assertRaisesRegex(ValueError, "disjoint"):
            Generator(run)

    def test_ambiguous_and_unmapped_words_remain_unknown(self):
        run, _ = make_run(self.root)
        write_json(run / "vocab_map.json", {"schema_version": 1, "mapping": {},
            "unmapped": ["나"], "ambiguous": {"가": ["WORD1", "WORD2"]}})
        result = Generator(run).generate(["가", "나", "사전밖"])
        self.assertEqual(result["unknown"], ["가", "나", "사전밖"])
        self.assertEqual(result["motion"].shape, (0, 125, 3))


if __name__ == "__main__":
    unittest.main()
