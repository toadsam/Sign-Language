"""라벨 조건 경계, 학습 어휘 선택, 원본 보존을 검증한다."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from recog.prepare_data import apply_duplicate_groups, prepare_dataset, select_records


class PrepareDataTest(unittest.TestCase):
    def setUp(self):
        self.split = {"mode": "signer", "signers": {"train": ["A"], "val": ["B"], "test": ["C"]}}
        self.rows = [{"clip": f"WORD0001_{s}", "signer": s, "item": "WORD0001", "type": "WORD",
                      "label": "ok", "dur_ratio": 1.0} for s in "ABC"]

    def test_quality_boundaries_and_exclusions(self):
        rows = list(self.rows)
        for i, ratio in enumerate((0.85, 1.4999, 0.8499, 1.5, None, float("nan"), True)):
            rows.append({**self.rows[0], "clip": f"ratio{i}", "dur_ratio": ratio})
        rows += [{**self.rows[0], "clip": "bad_label", "label": "missing"},
                 {**self.rows[0], "clip": "excluded"}]
        self.split["exclude"] = {"clips": ["excluded"]}
        selected, _, report = select_records(rows, self.split)
        self.assertEqual({m["clip"] for m in selected} - {m["clip"] for m in self.rows}, {"ratio0", "ratio1"})
        self.assertEqual(report["dropped_by_first_reason"]["invalid_dur_ratio"], 5)
        self.assertEqual(sum(report["dropped_by_first_reason"].values()) + len(selected), len(rows))

    def test_vocabulary_uses_only_training_people(self):
        rows = self.rows + [{**self.rows[2], "clip": "unseen", "item": "WORD0000"}]
        selected, classes, _ = select_records(rows, self.split, max_classes=1)
        self.assertEqual(classes, {"WORD0001": 0})
        self.assertEqual(len(selected), 3)

    def test_refuses_overlap_unknown_people_and_duplicates(self):
        for rows in (self.rows + [self.rows[0]], self.rows + [{**self.rows[0], "clip": "unknown", "signer": "D"}]):
            with self.assertRaises(ValueError):
                select_records(rows, self.split)
        self.split["signers"]["test"] = ["A"]
        with self.assertRaises(ValueError):
            select_records(self.rows, self.split)

    def test_output_preserves_source_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, out = Path(tmp) / "original/full", Path(tmp) / "prepared/full"
            (source / "npy").mkdir(parents=True)
            original = "".join(json.dumps(m) + "\n" for m in self.rows)
            (source / "meta.jsonl").write_text(original)
            for m in self.rows:
                (source / "npy" / f"{m['clip']}.npy").write_bytes(b"unchanged")
            report = prepare_dataset(source, out, self.split)
            self.assertEqual(report["counts"], {"train": 1, "val": 1, "test": 1})
            self.assertEqual((source / "meta.jsonl").read_text(), original)
            link = out / "npy/WORD0001_A.npy"
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.read_bytes(), b"unchanged")
            self.assertEqual(json.loads((out / "split_snapshot.json").read_text()), self.split)
            with self.assertRaises(ValueError):
                prepare_dataset(source, out, self.split)

    def test_exact_duplicates_remove_training_only_and_preserve_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, out = Path(tmp) / "original/full", Path(tmp) / "prepared/full"
            (source / "npy").mkdir(parents=True)
            # 같은 단어의 독립 학습 표본을 남겨 어휘를 유지한다.
            rows = [{**m, "frames": 16, "active": [0, 15]} for m in self.rows]
            rows.append({**rows[0], "clip": "independent_train"})
            original = "".join(json.dumps(m) + "\n" for m in rows)
            (source / "meta.jsonl").write_text(original)
            for m in rows:
                x = np.zeros((16, 375), np.float32)
                if m["clip"] == "independent_train":
                    x[:, 39] = 0.1
                np.save(source / "npy" / f"{m['clip']}.npy", x)
            groups = [{"clips": ["WORD0001_A", "WORD0001_B"]}]
            split_before = json.dumps(self.split, sort_keys=True)
            report = prepare_dataset(source, out, self.split, duplicate_groups=groups)
            self.assertEqual(report["counts"], {"train": 1, "val": 1, "test": 1})
            self.assertEqual(report["deduplication"]["removed_clips"], ["WORD0001_A"])
            self.assertFalse((out / "npy/WORD0001_A.npy").exists())
            self.assertTrue((source / "npy/WORD0001_A.npy").exists())
            self.assertEqual((source / "meta.jsonl").read_text(), original)
            self.assertEqual(json.dumps(self.split, sort_keys=True), split_before)
            self.assertTrue((out / "npy/WORD0001_B.npy").is_symlink())
            # 손이 조금이라도 다르면 확정 중복으로 제외하지 않는다.
            with self.assertRaisesRegex(ValueError, "정확히 같은"):
                apply_duplicate_groups(rows, source, self.split,
                                       [{"clips": ["independent_train", "WORD0001_B"]}])
            # 평가 표본끼리의 중복은 이 정책이 임의로 변경할 수 없다.
            with self.assertRaisesRegex(ValueError, "검증·평가"):
                apply_duplicate_groups(rows, source, self.split,
                                       [{"clips": ["WORD0001_B", "WORD0001_C"]}])


if __name__ == "__main__":
    unittest.main()
