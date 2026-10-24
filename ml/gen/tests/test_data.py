"""Invented fixtures only; no real E5 assets, network, GPU or Torch needed."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from gen.data import DataValidationError, select_data, validate_partitions
from gen.train_sentence import build_pairs, encode_src
from gen.train_word import load_setup


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.tokens = {"nb_code": 8, "down": 2, "vq": "unused/path/hint", "clips": {}}
        self.metas, self.sentences = [], []
        self.split = {"mode": "signer", "signers": {"train": ["T"], "val": ["V"], "test": ["E"]},
                      "exclude": {"clips": []}, "heldout_sentences": {"sequences": [], "items": [], "question_items": []}}

    def add(self, item, signer="T", kind="WORD", gloss=None, tags=None):
        clip = f"{item}_{signer}"
        meta = {"clip": clip, "item": item, "signer": signer, "type": kind,
                "frames": 12, "active": [4, 7], "label": "ok", "dur_ratio": 1.0,
                "gloss": gloss or [item]}
        self.metas.append(meta)
        self.tokens["clips"][clip] = {"item": item, "signer": signer, "type": kind,
                                      "frames": [0, 12], "tokens": [0, 1, 2, 3, 4, 7]}
        if kind == "SEN":
            self.sentences.append({"clip": clip, "gloss": meta["gloss"], "nonmanual": tags or []})
        return meta

    def write(self):
        for name, value in (("tokens.json", self.tokens), ("split.json", self.split)):
            (self.root / name).write_text(json.dumps(value), encoding="utf-8")
        for name, values in (("meta.jsonl", self.metas), ("sentences.jsonl", self.sentences)):
            (self.root / name).write_text("".join(json.dumps(v) + "\n" for v in values), encoding="utf-8")

    def select(self, kind="WORD", **kwargs):
        self.write()
        return select_data(self.root / "tokens.json", self.root / "meta.jsonl", self.root / "split.json",
                           kind=kind, sentences_path=self.root / "sentences.jsonl" if kind == "SEN" else None, **kwargs)

    def assert_code(self, code, action):
        with self.assertRaises(DataValidationError) as ctx:
            action()
        self.assertEqual(ctx.exception.code, code)


class SelectionTests(Fixture):
    def test_train_only_classes_signers_and_gpt_b2_identical(self):
        self.add("WORD_A")
        self.add("WORD_A", "V")
        self.add("WORD_EVAL_ONLY", "E")
        self.write()
        (self.root / "npy").mkdir()
        np.save(self.root / "npy/WORD_A_T.npy", np.zeros((12, 125, 3), dtype=np.float32))
        with patch("numpy.load", side_effect=AssertionError("GPT must not read npy")):
            gpt = load_setup(self.root / "tokens.json", self.root, split_path=self.root / "split.json")
        b2 = load_setup(self.root / "tokens.json", self.root, split_path=self.root / "split.json", include_motion=True)
        self.assertEqual([c["clip"] for c in gpt[1]], [c["clip"] for c in b2[1]])
        self.assertEqual(gpt[2], {"WORD_A": 0})
        self.assertEqual(gpt[3], {"T": 0})
        self.assertEqual(b2[1][0]["motion"].shape, (12, 375))
        selection = self.select()
        self.assertEqual(selection.report["coverage"]["test"]["oov_items"], {"WORD_EVAL_ONLY": 1})

    def test_selection_never_reads_coordinates(self):
        self.add("WORD_A")
        with patch("numpy.load", side_effect=AssertionError("no npy reads")):
            self.assertEqual(len(self.select().train), 1)

    def test_quality_boundaries_missing_nan_inf_and_wrong_types(self):
        self.add("WORD_OK")
        cases = [("LOW", 0.85, True), ("BELOW", 0.8499, False), ("HIGH", 1.5, False),
                 ("UNDER", 1.4999, True), ("NAN", float("nan"), False),
                 ("INF", float("inf"), False), ("BOOL", True, False), ("STRING", "1", False)]
        for name, ratio, _ in cases:
            self.add(f"WORD_{name}")["dur_ratio"] = ratio
        del self.add("WORD_MISSING_DURATION")["dur_ratio"]
        del self.add("WORD_MISSING_LABEL")["label"]
        self.add("WORD_BAD_LABEL")["label"] = "missing"
        quality = self.add("WORD_QUALITY")
        self.split["exclude"]["clips"] = [quality["clip"]]
        result = self.select()
        self.assertEqual(set(result.classes), {"WORD_OK", "WORD_LOW", "WORD_UNDER"})
        counts = result.report["exclusion_counts"]
        self.assertEqual(counts["invalid_dur_ratio"], 6)
        self.assertEqual(counts["missing_dur_ratio"], 1)
        self.assertEqual(counts["missing_label"], 1)
        self.assertEqual(counts["invalid_label"], 1)
        self.assertEqual(counts["quality_excluded"], 1)

    def test_exclusion_counts_are_per_reason_not_unique(self):
        self.add("WORD_OK")
        bad = self.add("WORD_BAD")
        bad["label"], bad["dur_ratio"] = "missing", 3
        self.split["exclude"]["clips"] = [bad["clip"]]
        result = self.select()
        self.assertEqual(result.report["excluded_total"], 1)
        self.assertEqual(sum(result.report["exclusion_counts"].values()), 3)

    def test_unknown_signer_is_excluded(self):
        self.add("WORD_OK")
        self.add("WORD_UNKNOWN", "UNKNOWN")
        result = self.select()
        self.assertEqual(result.report["exclusion_counts"], {"unknown_signer": 1})

    def test_split_signer_overlap_even_without_clips(self):
        self.add("WORD_OK")
        self.split["signers"]["test"].append("V")
        self.assert_code("signer_overlap", self.select)

    def test_partition_clip_overlap_and_signer_overlap(self):
        row = {"clip": "A", "signer": "T"}
        self.assert_code("clip_overlap", lambda: validate_partitions({"train": [row], "test": [row]}))
        self.assert_code("signer_overlap", lambda: validate_partitions(
            {"train": [row], "val": [{"clip": "B", "signer": "T"}]}))

    def test_formal_split_required_and_item_split_disallowed(self):
        self.add("WORD_A")
        self.write()
        self.assert_code("split_required", lambda: select_data(self.root / "tokens.json", self.root / "meta.jsonl"))
        self.split = {"mode": "item", "test_items": []}
        self.assert_code("split_mode", self.select)

    def test_explicit_smoke_relaxations_are_recorded(self):
        m = self.add("WORD_A")
        del m["label"], m["dur_ratio"]
        self.write()
        result = select_data(self.root / "tokens.json", self.root / "meta.jsonl", mode="smoke")
        self.assertEqual(result.report["data_mode"], "smoke")
        self.assertEqual(result.report["policy"]["smoke_missing_fields"], {"label": 1, "dur_ratio": 1})

    def test_explicit_smoke_still_rejects_bad_quality(self):
        self.add("WORD_GOOD")
        self.add("WORD_BAD")["dur_ratio"] = 3
        self.assertEqual(len(self.select(mode="smoke").train), 1)

    def test_meta_duplicate(self):
        m = self.add("WORD_A")
        self.metas.append(dict(m))
        self.assert_code("duplicate_clip", self.select)

    def test_duplicate_token_json_key_is_not_silently_overwritten(self):
        self.add("WORD_A")
        self.write()
        text = (self.root / "tokens.json").read_text(encoding="utf-8")
        (self.root / "tokens.json").write_text(text.replace('"nb_code": 8', '"nb_code": 8, "nb_code": 8'), encoding="utf-8")
        self.assert_code("duplicate_key", lambda: select_data(
            self.root / "tokens.json", self.root / "meta.jsonl", self.root / "split.json"))

    def test_duplicate_clip_key_in_token_file(self):
        m = self.add("WORD_A")
        self.write()
        record = json.dumps(self.tokens["clips"][m["clip"]])
        header = {k: v for k, v in self.tokens.items() if k != "clips"}
        raw = json.dumps(header)[:-1] + ', "clips": {"WORD_A_T": ' + record + ', "WORD_A_T": ' + record + '}}'
        (self.root / "tokens.json").write_text(raw, encoding="utf-8")
        self.assert_code("duplicate_key", lambda: select_data(
            self.root / "tokens.json", self.root / "meta.jsonl", self.root / "split.json"))

    def test_token_meta_identity_mismatch(self):
        for field in ("item", "signer", "type"):
            with self.subTest(field=field):
                self.metas, self.tokens["clips"] = [], {}
                m = self.add("WORD_A")
                self.tokens["clips"][m["clip"]][field] = "WRONG"
                expected = "invalid_token_record" if field == "type" else "metadata_mismatch"
                self.assert_code(expected, self.select)

    def test_missing_token_or_metadata_is_an_error(self):
        self.add("WORD_A")
        self.tokens["clips"] = {}
        self.assert_code("clip_set_mismatch", self.select)

    def test_tokens_integer_range_and_frames(self):
        m = self.add("WORD_A")
        token = self.tokens["clips"][m["clip"]]
        original = copy.deepcopy(token)
        cases = [("tokens", [-1], "invalid_tokens"), ("tokens", [8], "invalid_tokens"),
                 ("tokens", [1.0], "invalid_tokens"), ("tokens", [True], "invalid_tokens"),
                 ("tokens", [], "invalid_tokens"), ("tokens", [1], "invalid_frames"),
                 ("frames", [0, 14], "invalid_frames"), ("frames", [0.0, 12], "invalid_frames"),
                 ("frames", [2, 14], "invalid_frames")]
        for field, value, code in cases:
            with self.subTest(field=field, value=value):
                token.clear()
                token.update(copy.deepcopy(original))
                token[field] = value
                self.assert_code(code, self.select)

    def test_metadata_segment_validation(self):
        m = self.add("WORD_A")
        m["active"] = [9, 10]
        self.assert_code("segment_mismatch", self.select)

    def test_invalid_meta_total_and_active(self):
        m = self.add("WORD_A")
        m["frames"] = 0
        self.assert_code("invalid_integer", self.select)
        m["frames"], m["active"] = 12, [10, 20]
        self.assert_code("invalid_active", self.select)

    def test_empty_training_does_not_fall_back(self):
        self.add("WORD_A", "V")
        self.assert_code("empty_train", self.select)

    def test_combined_tokens_allow_only_requested_meta(self):
        self.add("WORD_A")
        self.add("SEN_A", kind="SEN")
        self.metas = [m for m in self.metas if m["type"] == "WORD"]
        self.assertEqual(len(self.select().train), 1)

    def test_run_selection_deterministic_and_no_overwrite(self):
        self.add("WORD_A")
        result = self.select()
        path = self.root / "run/selection.json"
        digest = result.write(path)
        self.assertEqual(len(digest), 64)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), result.report)
        with self.assertRaises(FileExistsError):
            result.write(path)


class SentenceTests(Fixture):
    def test_formal_sentence_cannot_use_split_without_holdout_policy(self):
        self.add("SEN_A", kind="SEN")
        del self.split["heldout_sentences"]
        self.assert_code("holdout_required", lambda: self.select("SEN"))

    def test_holdout_conditions_independent_and_eval_vocab_not_trained(self):
        self.add("SEN_KEEP", kind="SEN", gloss=["known"], tags=["train_tag"])
        self.add("SEN_SEQUENCE", kind="SEN", gloss=["heldout_sequence"])
        self.add("SEN_ITEM", kind="SEN", gloss=["unique_item"])
        self.add("SEN_QUESTION", kind="SEN", gloss=["unique_question"])
        self.add("SEN_VAL", "V", kind="SEN", gloss=["val_only"], tags=["val_tag"])
        self.add("SEN_ITEM", "V", kind="SEN", gloss=["unique_item"])
        self.add("SEN_SEQUENCE", "E", kind="SEN", gloss=["heldout_sequence"])
        self.add("SEN_TEST", "E", kind="SEN", gloss=["eval_only"])
        self.split["heldout_sentences"] = {"sequences": [["heldout_sequence"]],
                                            "items": ["SEN_ITEM"], "question_items": ["SEN_QUESTION"]}
        result = self.select("SEN")
        self.assertEqual(result.report["counts"], {"train": 1, "val": 1, "test": 1,
                                                 "holdout_train": 3, "holdout_val": 1, "holdout_test": 1})
        self.assertEqual(result.vocab, {"<pad>": 0, "<train_tag>": 1, "known": 2})
        self.assertEqual(result.signers, {"T": 0})
        self.assertEqual(result.report["coverage"]["val"]["oov_gloss"], {"val_only": 1})
        self.assertEqual(result.report["coverage"]["val"]["oov_tags"], {"val_tag": 1})
        self.assertEqual(result.report["coverage"]["test"]["covered_clips"], 0)
        nb, pairs, vocab = build_pairs(self.root / "tokens.json", self.root / "sentences.jsonl", False,
                                       np.random.default_rng(0), data_dir=self.root, split_path=self.root / "split.json")
        self.assertEqual([p["clip"] for p in pairs], [p["clip"] for p in result.train])
        self.assertEqual(vocab, result.vocab)
        self.assertEqual(nb, 8)

    def test_missing_sentence_and_gloss_mismatch(self):
        self.add("SEN_A", kind="SEN")
        self.sentences[0]["gloss"] = ["different"]
        self.assert_code("sentence_mismatch", lambda: self.select("SEN"))
        self.sentences.clear()
        self.assert_code("sentence_missing", lambda: self.select("SEN"))

    def test_duplicate_sentence(self):
        self.add("SEN_A", kind="SEN")
        self.sentences.append(dict(self.sentences[0]))
        self.assert_code("duplicate_clip", lambda: self.select("SEN"))

    def test_sentence_requires_metadata(self):
        self.assert_code("metadata_required", lambda: build_pairs("unused", "unused", False, None))

    def test_encoder_never_maps_oov_to_padding_or_truncates_silently(self):
        vocab = {"<pad>": 0, "known": 1}
        self.assert_code("source_oov", lambda: encode_src({"gloss": ["unknown"]}, vocab, 8))
        self.assert_code("source_oov", lambda: encode_src({"gloss": ["known"], "nonmanual": ["unknown"]}, vocab, 8))
        self.assert_code("source_too_long", lambda: encode_src({"gloss": ["known", "known"]}, vocab, 1))
        self.assertEqual(encode_src({"gloss": ["known"]}, vocab, 8), [1])

    def test_synthetic_explicit_smoke_and_small_word_pool(self):
        self.add("WORD_A")
        self.add("WORD_B")
        self.write()
        nb, pairs, vocab, selection = build_pairs(self.root / "tokens.json", None, True,
                                                 np.random.default_rng(0), n_synth=3, return_selection=True)
        self.assertEqual(nb, 8)
        self.assertEqual(len(pairs), 3)
        self.assertEqual(selection.report["data_mode"], "smoke")
        self.assertEqual(selection.report["source_word_clips"], ["WORD_A_T", "WORD_B_T"])
        self.assertIn("WORD_A", vocab)
        self.assert_code("synthetic_mode", lambda: build_pairs(self.root / "tokens.json", None, True, None, mode="formal"))


if __name__ == "__main__":
    unittest.main()
