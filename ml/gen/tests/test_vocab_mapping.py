from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from gen.tests.test_infer_baseline import make_meta, make_run, write_json, write_metas
from gen.vocab import build_vocab, main, select_train


class VocabTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_exact_unmapped_and_ambiguous_are_separate(self):
        metas = [make_meta(gloss=["가"]), make_meta(signer="ZTRAIN", gloss=["가"]),
                 make_meta("WORD2", gloss=["모호"]), make_meta("WORD3", gloss=["모호"]),
                 make_meta("WORD4", gloss=["여러", "형태소"])]
        dictionary = [{"word": s} for s in ("가", "모호", "미등록", "여러", "가")]
        result = build_vocab(dictionary, metas)
        self.assertEqual(result["mapping"], {"가": "WORD1"})
        self.assertEqual(result["ambiguous"], {"모호": ["WORD2", "WORD3"]})
        self.assertEqual(set(result["unmapped"]), {"미등록", "여러"})

    def test_no_stemming_fuzzy_or_whitespace_substitution(self):
        result = build_vocab([{"word": "가다"}, {"word": " 가 "}], [make_meta()])
        self.assertEqual(result["mapping"], {})
        self.assertEqual(set(result["unmapped"]), {"가다", " 가 "})

    def test_label_duration_quality_split_and_type_filters(self):
        metas = [make_meta("WORD1", dur_ratio=0.85), make_meta("WORD2", dur_ratio=1.499),
                 make_meta("WORD3", dur_ratio=0.849), make_meta("WORD4", dur_ratio=1.5),
                 make_meta("WORD5", dur_ratio=float("nan")), make_meta("WORD6", dur_ratio=True),
                 make_meta("WORD7", dur_ratio="1.0"), make_meta("WORD8", label="missing"),
                 make_meta("WORD9"), make_meta("WORD10", signer="VAL"),
                 make_meta("WORD11", signer="TEST"), make_meta("WORD12", signer="UNKNOWN"),
                 make_meta("SEN1", type="SEN"), make_meta("WORD13"), make_meta("WORD14")]
        metas[-2].pop("dur_ratio")
        metas[-1].pop("label")
        _, data = make_run(self.root, metas)
        split_path = self.root / "split.json"
        split = json.loads(split_path.read_text())
        split["exclude"]["clips"] = ["WORD9_TRAIN"]
        write_json(split_path, split)
        selected, counts = select_train(data, split_path)
        self.assertEqual([m["item"] for m in selected], ["WORD1", "WORD2"])
        self.assertEqual(counts, {"selected": 2, "total": 15, "duration": 6,
                                  "label": 2, "quality_excluded": 1, "not_train": 3, "not_word": 1})

    def test_no_mapping_from_validation_test_or_excluded_labels(self):
        metas = [make_meta(gloss=["훈련"]), make_meta("WORD2", signer="VAL", gloss=["검증"]),
                 make_meta("WORD3", signer="TEST", gloss=["평가"])]
        _, data = make_run(self.root, metas)
        selected, _ = select_train(data, self.root / "split.json")
        result = build_vocab([{"word": s} for s in ("훈련", "검증", "평가")], selected)
        self.assertEqual(result["mapping"], {"훈련": "WORD1"})
        self.assertEqual(set(result["unmapped"]), {"검증", "평가"})

    def test_duplicate_metadata_and_identity_mismatch_fail(self):
        _, data = make_run(self.root)
        for metas in ([make_meta(), make_meta()], [make_meta(clip="WORD2_TRAIN")]):
            write_metas(data, metas)
            with self.subTest(metas=metas), self.assertRaises(ValueError):
                select_train(data, self.root / "split.json")

    def test_overlapping_signers_fail(self):
        _, data = make_run(self.root)
        write_json(self.root / "split.json", {"mode": "signer", "signers": {
            "train": ["TRAIN"], "val": ["TRAIN"], "test": ["TEST"]}})
        with self.assertRaisesRegex(ValueError, "overlap"):
            select_train(data, self.root / "split.json")

    def test_item_split_requires_explicit_smoke_and_still_filters(self):
        _, data = make_run(self.root)
        write_json(self.root / "split.json", {"mode": "item", "test_items": ["WORD2"]})
        with self.assertRaisesRegex(ValueError, "formal"):
            select_train(data, self.root / "split.json")
        selected, _ = select_train(data, self.root / "split.json", data_mode="smoke")
        self.assertEqual([m["item"] for m in selected], ["WORD1"])

    def test_dictionary_requires_word_entries(self):
        for dictionary in ({}, ["가"], [{"word": ""}], [{"word": 1}]):
            with self.subTest(dictionary=dictionary), self.assertRaises(ValueError):
                build_vocab(dictionary, [])

    def test_cli_uses_dictionary_word_field_and_never_overwrites_existing_map(self):
        _, data = make_run(self.root)
        dictionary = self.root / "dictionary.json"
        write_json(dictionary, [{"id": 123, "word": "가", "file": "fake.placeholder"},
                                {"id": 456, "word": "미등록", "file": "fake.placeholder"}])
        output = self.root / "new_map.json"
        argv = ["vocab", "--dictionary", str(dictionary), "--data", str(data),
                "--split", str(self.root / "split.json"), "--out", str(output)]
        printed = io.StringIO()
        with patch("sys.argv", argv), redirect_stdout(printed):
            main()
        result = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(result["mapping"], {"가": "WORD1"})
        self.assertEqual(result["unmapped"], ["미등록"])
        summary = json.loads(printed.getvalue())
        self.assertEqual(summary["exact"], 1)
        self.assertEqual(summary["unmapped"], 1)
        before = output.read_bytes()
        with patch("sys.argv", argv), self.assertRaises(FileExistsError):
            main()
        self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
