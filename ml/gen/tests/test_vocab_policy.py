"""Compare A/B WORD policy on invented files, without E5 assets or Torch.

Only eligible train membership is shared. Token validation, smoke relaxations,
empty training pools, and rejection counters deliberately have different scope.
"""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from gen.data import DataValidationError, select_data
from gen.tests.test_infer_baseline import make_meta, write_json, write_metas
from gen.vocab import build_vocab, select_train


class WordPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.tokens_path = self.root / "tokens.json"
        self.split_path = self.root / "split.json"
        self.split = {"mode": "signer", "signers": {
            "train": ["TRAIN", "ZTRAIN"], "val": ["VAL"], "test": ["TEST"]},
            "exclude": {"clips": []}}
        self.metas = []
        self.tokens = {"nb_code": 8, "down": 4, "clips": {}}

    def add(self, item=None, signer="TRAIN", **updates):
        item = item or f"WORD{len(self.metas) + 1}"
        meta = make_meta(item, signer, **updates)
        self.metas.append(meta)
        # Invented segment [2,14) matches active [6,10] with pad=4, down=4.
        self.tokens["clips"][meta["clip"]] = {"item": item, "signer": signer, "type": "WORD",
            "frames": [2, 14], "tokens": [0, 1, 7]}
        return meta

    def write(self):
        write_metas(self.root, self.metas)
        write_json(self.tokens_path, self.tokens)
        write_json(self.split_path, self.split)

    def a(self, mode="formal"):
        return select_data(self.tokens_path, self.root / "meta.jsonl", self.split_path, mode=mode)

    def b(self, mode="formal"):
        return select_train(self.root, self.split_path, data_mode=mode)

    def test_formal_quality_split_matrix_matches_explicit_expected_train(self):
        # Eligibility flags are explicit expectations, including inclusive/exclusive boundaries.
        missing = object()
        labels = [("ok", True), (missing, False), ("missing", False), (None, False),
                  ("", False), (True, False), ([], False)]
        ratios = [(0.85, True), (1, True), (1.0, True), (math.nextafter(1.5, 0), True),
                  (math.nextafter(0.85, 0), False), (1.5, False), (0, False), (2, False),
                  (missing, False), (None, False), (float("nan"), False),
                  (float("inf"), False), (float("-inf"), False), (True, False),
                  (False, False), ("1.0", False), ([], False), ({}, False)]
        signers = [("TRAIN", True), ("ZTRAIN", True), ("VAL", False),
                   ("TEST", False), ("UNKNOWN", False)]
        expected = set()
        for label, label_ok in labels:
            for ratio, ratio_ok in ratios:
                for signer, is_train in signers:
                    for excluded in (False, True):
                        meta = self.add(signer=signer)
                        for key, value in (("label", label), ("dur_ratio", ratio)):
                            if value is missing:
                                del meta[key]
                            else:
                                meta[key] = value
                        if excluded:
                            self.split["exclude"]["clips"].append(meta["clip"])
                        if label_ok and ratio_ok and is_train and not excluded:
                            expected.add(meta["clip"])
        self.write()
        # Neither candidate selection API should open even one coordinate array.
        with patch("numpy.load", side_effect=AssertionError("metadata selection must not read npy")):
            a = self.a()
            b, report = self.b()
        self.assertEqual(len(self.metas), 1260)
        self.assertEqual(len(expected), 8)
        self.assertEqual({m["clip"] for m in a.train}, expected)
        self.assertEqual({m["clip"] for m in b}, expected)
        self.assertEqual(report["selected"], len(expected))
        self.assertEqual({m["signer"] for m in b}, {"TRAIN", "ZTRAIN"})
        self.assertEqual(set(a.classes), {m["item"] for m in b})

    def test_selection_is_deterministic_when_metadata_order_changes(self):
        self.add("WORD1", "ZTRAIN")
        self.add("WORD1", "TRAIN")
        self.add("WORD2", "VAL")
        self.add("WORD3", "TEST")
        self.write()
        a_before = [m["clip"] for m in self.a().train]
        b_before = [m["clip"] for m in self.b()[0]]
        self.metas.reverse()
        self.write()
        self.assertEqual([m["clip"] for m in self.a().train], a_before)
        self.assertEqual([m["clip"] for m in self.b()[0]], b_before)
        self.assertEqual(a_before, b_before)
        self.assertEqual(len(b_before), 2)  # Candidates, not a single representative.

    def test_vocab_uses_all_eligible_train_candidates_and_no_heldout_labels(self):
        self.add("WORD1", gloss=["known"])
        self.add("WORD1", "ZTRAIN", gloss=["known"])
        self.add("WORD1", "VAL", gloss=["validation_only"])
        self.add("WORD2", "TEST", gloss=["test_only"])
        self.add("WORD3", "UNKNOWN", gloss=["unknown_signer_only"])
        bad = self.add("WORD4", gloss=["quality_only"])
        self.split["exclude"]["clips"] = [bad["clip"]]
        self.add("WORD5", gloss=["bad_label_only"], label="missing")
        self.add("WORD6", gloss=["bad_duration_only"], dur_ratio=1.5)
        self.add("WORD7", gloss=["ambiguous"])
        self.add("WORD8", gloss=["ambiguous"])
        self.write()
        a = self.a()
        b, _ = self.b()
        words = ["known", "validation_only", "test_only", "unknown_signer_only", "quality_only",
                 "bad_label_only", "bad_duration_only", "ambiguous", "absent"]
        dictionary = [{"word": word} for word in words]
        expected = build_vocab(dictionary, a.train)
        result = build_vocab(dictionary, b)
        self.assertEqual(result, expected)
        self.assertEqual(result["mapping"], {"known": "WORD1"})
        self.assertEqual(result["ambiguous"], {"ambiguous": ["WORD7", "WORD8"]})
        self.assertEqual(set(result["unmapped"]), set(words) - {"known", "ambiguous"})

    def test_smoke_missing_quality_is_relaxed_only_by_a(self):
        self.add("WORD1")
        del self.add("WORD2")["label"]
        del self.add("WORD3")["dur_ratio"]
        both = self.add("WORD4")
        del both["label"], both["dur_ratio"]
        self.write()
        a, (b, report) = self.a("smoke"), self.b("smoke")
        self.assertEqual({m["item"] for m in a.train}, {"WORD1", "WORD2", "WORD3", "WORD4"})
        self.assertEqual([m["item"] for m in b], ["WORD1"])
        self.assertEqual(a.report["policy"]["smoke_missing_fields"], {"label": 2, "dur_ratio": 2})
        self.assertEqual((report["label"], report["duration"]), (2, 1))
        self.assertEqual([m["item"] for m in self.a().train], ["WORD1"])
        self.assertEqual([m["item"] for m in self.b()[0]], ["WORD1"])

    def test_smoke_present_invalid_quality_is_excluded_by_both(self):
        self.add("WORD1")
        self.add("WORD2", label=None)
        self.add("WORD3", dur_ratio=True)
        self.add("WORD4", dur_ratio="1.0")
        self.add("WORD5", dur_ratio=float("inf"))
        self.write()
        self.assertEqual([m["item"] for m in self.a("smoke").train], ["WORD1"])
        self.assertEqual([m["item"] for m in self.b("smoke")[0]], ["WORD1"])

    def test_only_a_smoke_allows_an_absent_split(self):
        self.add()
        self.write()
        a = select_data(self.tokens_path, self.root / "meta.jsonl", mode="smoke")
        self.assertEqual(len(a.train), 1)
        with self.assertRaises(FileNotFoundError):
            select_train(self.root, self.root / "absent_split.json", data_mode="smoke")

    def test_a_counts_every_reason_b_counts_first_reason(self):
        self.add("WORD1")
        bad = self.add("WORD2", label="missing", dur_ratio=3)
        self.split["exclude"]["clips"] = [bad["clip"]]
        self.write()
        a, (b, report) = self.a(), self.b()
        self.assertEqual([m["clip"] for m in a.train], [m["clip"] for m in b])
        self.assertEqual(a.report["excluded_total"], 1)
        self.assertEqual(sum(a.report["exclusion_counts"].values()), 3)
        self.assertEqual(report["quality_excluded"], 1)
        self.assertNotIn("label", report)
        self.assertNotIn("duration", report)

    def test_empty_train_is_an_a_error_b_returns_empty_candidates(self):
        self.add("WORD1", "VAL")
        self.add("WORD2", "TEST")
        self.add("WORD3", "UNKNOWN")
        self.write()
        with self.assertRaises(DataValidationError) as error:
            self.a()
        self.assertEqual(error.exception.code, "empty_train")
        self.assertEqual(self.b()[0], [])

    def test_b_has_no_token_dependency_a_rejects_corrupt_token_or_segment(self):
        meta = self.add()
        self.write()
        original = copy.deepcopy(self.tokens)
        cases = [("tokens", [8, 1, 7], "invalid_tokens"),
                 ("tokens", [True, 1, 7], "invalid_tokens"),
                 ("frames", [2, 10], "invalid_frames"),
                 ("frames", [0, 12], "segment_mismatch"),
                 ("signer", "VAL", "metadata_mismatch")]
        for field, value, code in cases:
            self.tokens = copy.deepcopy(original)
            self.tokens["clips"][meta["clip"]][field] = value
            write_json(self.tokens_path, self.tokens)
            with self.subTest(field=field, code=code):
                with self.assertRaises(DataValidationError) as error:
                    self.a()
                self.assertEqual(error.exception.code, code)
                self.assertEqual([m["clip"] for m in self.b()[0]], [meta["clip"]])
        # A missing token file must not prevent baseline/vocab selection.
        self.tokens_path.rename(self.root / "unused_tokens.json")
        self.assertEqual([m["clip"] for m in self.b()[0]], [meta["clip"]])

    def test_a_rejects_invalid_active_b_defers_it_to_generator(self):
        meta = self.add(active=[])
        self.write()
        with self.assertRaises(DataValidationError) as error:
            self.a()
        self.assertEqual(error.exception.code, "invalid_active")
        self.assertEqual([m["clip"] for m in self.b()[0]], [meta["clip"]])

    def test_b_keeps_full_trimmed_interval_a_requires_down_multiple(self):
        meta = self.add(frames=1, active=[0, 0])
        self.tokens["clips"][meta["clip"]].update(frames=[0, 0], tokens=[])
        self.write()
        with self.assertRaises(DataValidationError) as error:
            self.a()
        self.assertEqual(error.exception.code, "invalid_tokens")
        self.assertEqual([m["clip"] for m in self.b()[0]], [meta["clip"]])

    def test_formal_signer_lists_reject_extra_groups_and_blank_signers(self):
        self.add()
        original = copy.deepcopy(self.split)
        cases = [dict(original["signers"], extra=[]),
                 dict(original["signers"], train=["TRAIN", " "]),
                 dict(original["signers"], train=["TRAIN", "TRAIN"]),
                 dict(original["signers"], val=["VAL", "TRAIN"]), None, []]
        for groups in cases:
            self.split = copy.deepcopy(original)
            self.split["signers"] = groups
            self.write()
            with self.subTest(groups=groups):
                with self.assertRaises(ValueError):
                    self.a()
                with self.assertRaises(ValueError):
                    self.b()

    def test_blank_or_nonstring_exclusion_keys_are_rejected_by_both(self):
        self.add()
        for excluded in ([""], [" "], [False]):
            self.split["exclude"]["clips"] = excluded
            self.write()
            with self.subTest(excluded=excluded):
                with self.assertRaises(ValueError):
                    self.a()
                with self.assertRaises(ValueError):
                    self.b()

    def test_item_smoke_split_names_remain_validated_by_both(self):
        self.add()
        for items in ([""], [" "], [True], "WORD1"):
            self.split = {"mode": "item", "test_items": items}
            self.write()
            with self.subTest(items=items):
                with self.assertRaises(ValueError):
                    self.a("smoke")
                with self.assertRaises(ValueError):
                    self.b("smoke")

    def test_duplicate_metadata_json_field_is_rejected_by_both(self):
        meta = self.add()
        self.write()
        # Without duplicate detection, the final value silently masks bad quality.
        raw = json.dumps(meta).replace('"dur_ratio": 1.0', '"dur_ratio": 3.0, "dur_ratio": 1.0')
        (self.root / "meta.jsonl").write_text(raw + "\n", encoding="utf-8")
        with self.assertRaises(DataValidationError) as error:
            self.a()
        self.assertEqual(error.exception.code, "duplicate_key")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.b()

    def test_duplicate_split_json_field_is_rejected_by_both(self):
        self.add()
        self.write()
        raw = json.dumps(self.split).replace('"train": ["TRAIN", "ZTRAIN"]',
            '"train": ["TRAIN"], "train": ["TRAIN", "ZTRAIN"]')
        self.split_path.write_text(raw, encoding="utf-8")
        with self.assertRaises(DataValidationError) as error:
            self.a()
        self.assertEqual(error.exception.code, "duplicate_key")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.b()


if __name__ == "__main__":
    unittest.main()
