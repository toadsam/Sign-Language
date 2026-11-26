"""데이터 다운로드 없이 검증: 실제 체크포인트 입출력, 누수 차단, 지표 단위."""
import json
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch

from eval.compare import evaluate, manifest_conditions, transition_jerk
from recog.features import joint_index
from recog.infer import Recognizer, validate_motion
from recog.model import SignRecognizer
from recog.splits import partition


class ContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        cls.tmp = tempfile.TemporaryDirectory()
        torch.manual_seed(7)
        model = SignRecognizer(330, 3)
        torch.save({"model": model.state_dict(), "in_dim": 330,
                    "classes": {"WORD0003": 2, "WORD0001": 0, "WORD0002": 1},
                    "with_face": False, "length": 64}, Path(cls.tmp.name) / "model.pt")
        cls.recognizer = Recognizer(cls.tmp.name)
        cls.motion = np.random.default_rng(7).normal(size=(12, 125, 3)).astype(np.float32)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_shapes_probabilities_and_class_order(self):
        a = self.recognizer.score(self.motion)
        b = self.recognizer.score(self.motion.reshape(12, 375), (0, 11))
        np.testing.assert_allclose(a["probs"], b["probs"])
        self.assertAlmostEqual(float(a["probs"].sum()), 1, places=6)
        self.assertEqual(len(a["top5"]), 3)
        for word, probability in a["top5"]:
            self.assertAlmostEqual(probability, float(a["probs"][self.recognizer.classes[word]]))
        self.assertFalse(self.recognizer.model.training)
        self.assertEqual(self.recognizer.score(self.motion[:1])["probs"].shape, (3,))

    def test_invalid_motion_and_active(self):
        for x in (np.zeros((0, 375)), np.zeros((5, 21, 3)), np.full((5, 375), np.nan)):
            with self.assertRaises(ValueError):
                validate_motion(x)
        for active in ((-1, 3), (3, 2), (0, 12), (0.5, 2), (False, 2)):
            with self.assertRaises(ValueError):
                validate_motion(self.motion, active)

    def test_fixed_split_and_no_overlap(self):
        metas = [{"clip": s, "signer": s, "item": "WORD0001"} for s in "ABC"]
        sp = {"mode": "signer", "signers": {"train": ["A"], "val": ["B"], "test": ["C"]}}
        with patch("recog.splits.load_split", return_value=sp):
            train, val, test, _ = partition(metas, "unused")
            self.assertEqual([m["signer"] for m in train + val + test], list("ABC"))
        sp["signers"]["test"] = ["A"]
        with patch("recog.splits.load_split", return_value=sp), self.assertRaises(ValueError):
            partition(metas, "unused")

    def test_insufficient_signers_requires_explicit_smoke(self):
        metas = [{"signer": "A", "item": "WORD0001"}]
        with patch("recog.splits.load_split", return_value=None):
            with self.assertRaises(ValueError):
                partition(metas, "unused")
            train, val, test, sp = partition(metas, "unused", smoke=True)
            self.assertEqual(sp["mode"], "smoke")
            self.assertEqual((val, test), ([], []))

    def test_metrics_units_and_missing_values(self):
        x = np.zeros((8, 375), dtype=np.float32)
        y = np.ones((8, 375), dtype=np.float32)
        result = evaluate(x, [y], "WORD0001", self.recognizer, 0.3)
        self.assertAlmostEqual(result["dtw_mm"], np.sqrt(3) * 300, places=3)
        self.assertIsNone(result["size_ratio"])
        self.assertIsNone(result["diversity_mm"])
        self.assertIsNone(result["transition_jerk"])
        self.assertEqual(transition_jerk(x, [4]), 0)
        with self.assertRaises(ValueError):
            transition_jerk(x, [8])
        same = evaluate(self.motion, [self.motion, self.motion], "WORD0001", self.recognizer, 0.3)
        self.assertEqual(same["dtw_mm"], 0)
        self.assertEqual(same["diversity_mm"], 0)
        self.assertAlmostEqual(same["size_ratio"], 1)

    def test_manifest_conditions_allow_shared_subset(self):
        def record(clip, *names):
            return {"clip": clip, "conditions": {n: {"motions": []} for n in names}}
        # 일부 조건만 있어도 되고, 순서는 CONDITIONS를 따른다.
        self.assertEqual(manifest_conditions([record("a", "Ours-H", "B1"), record("b", "B1", "Ours-H")]),
                         ("B1", "Ours-H"))
        self.assertEqual(manifest_conditions([record("a", "B1", "B2", "Ours-H", "Ours-HF")]),
                         ("B1", "B2", "Ours-H", "Ours-HF"))
        with self.assertRaisesRegex(ValueError, "조건 구성이 같아야"):
            manifest_conditions([record("a", "B1", "Ours-H"), record("b", "B1")])
        with self.assertRaisesRegex(ValueError, "알 수 없는 조건"):
            manifest_conditions([record("a", "B1", "B3")])
        with self.assertRaisesRegex(ValueError, "하나 이상"):
            manifest_conditions([record("a")])

    def test_training_and_four_condition_cli(self):
        root = Path(self.tmp.name) / "pipeline"
        data = root / "data"
        (data / "npy").mkdir(parents=True)
        metas = []
        for signer in ("A", "B", "C"):
            for item in ("WORD0001", "WORD0002"):
                clip = f"{item}_{signer}"
                np.save(data / "npy" / f"{clip}.npy", self.motion)
                metas.append({"clip": clip, "item": item, "signer": signer, "type": "WORD",
                              "active": [0, 11], "norm": {"scale": 0.3}})
        (data / "meta.jsonl").write_text("\n".join(json.dumps(m) for m in metas))
        cwd = Path(__file__).resolve().parents[1]
        run = root / "run"
        result = subprocess.run([sys.executable, "-m", "recog.train", "--data", str(data),
                                 "--run", str(run), "--test-signers", "1", "--iters", "3",
                                 "--batch", "2", "--eval-every", "1", "--length", "16"],
                                cwd=cwd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        summary = json.loads((run / "summary.json").read_text())
        self.assertTrue(summary["evaluated_on_unseen_signers"])
        self.assertEqual(summary["selection"], "val_top1")
        self.assertTrue(all("test_top1" not in json.loads(line) for line in (run / "log.jsonl").read_text().splitlines()))
        test_signer = summary["split"]["signers"]["test"][0]
        records = [{"clip": m["clip"], "conditions": {
            c: {"motions": [f"data/npy/{m['clip']}.npy"]} for c in ("B1", "B2", "Ours-H", "Ours-HF")}}
            for m in metas if m["signer"] == test_signer]
        manifest = root / "generated.json"
        manifest.write_text(json.dumps({"records": records}))
        result = subprocess.run([sys.executable, "-m", "eval.compare", "--data", str(data),
                                 "--recog", str(run), "--manifest", str(manifest), "--out", str(root / "out")],
                                cwd=cwd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        table = json.loads((root / "out" / "summary.json").read_text())
        self.assertEqual(table["clips"], 2)
        self.assertEqual(len(table["rows"]), 10)
        self.assertEqual(table["table"]["B1"]["dtw_mm"], 0)
        self.assertEqual(table["conditions"], ["B1", "B2", "Ours-H", "Ours-HF"])
        self.assertTrue((root / "out" / "rows.csv").exists())
        # B1과 Ours-H 두 조건만 있어도 돌아가고, 표에는 있는 조건만 나온다.
        two = [{"clip": r["clip"], "conditions": {c: r["conditions"][c] for c in ("B1", "Ours-H")}} for r in records]
        manifest.write_text(json.dumps({"records": two}))
        result = subprocess.run([sys.executable, "-m", "eval.compare", "--data", str(data),
                                 "--recog", str(run), "--manifest", str(manifest), "--out", str(root / "two")],
                                cwd=cwd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        table = json.loads((root / "two" / "summary.json").read_text())
        self.assertEqual(table["conditions"], ["B1", "Ours-H"])
        self.assertEqual(list(table["table"]), ["Original", "B1", "Ours-H"])
        self.assertEqual(len(table["rows"]), 6)
        self.assertNotIn("B2", (root / "two" / "table.md").read_text(encoding="utf-8"))
        # record마다 조건 구성이 다르면 실패해야 한다.
        two[1]["conditions"].pop("Ours-H")
        manifest.write_text(json.dumps({"records": two}))
        result = subprocess.run([sys.executable, "-m", "eval.compare", "--data", str(data),
                                 "--recog", str(run), "--manifest", str(manifest), "--out", str(root / "mixed")],
                                cwd=cwd, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("조건 구성이 같아야", result.stderr)
        manifest.write_text(json.dumps({"records": records}))
        # train 클립을 정식 평가에 넣으면 실행이 실패해야 한다.
        records[0]["clip"] = next(m["clip"] for m in metas if m["signer"] != test_signer)
        manifest.write_text(json.dumps({"records": records}))
        result = subprocess.run([sys.executable, "-m", "eval.compare", "--data", str(data),
                                 "--recog", str(run), "--manifest", str(manifest), "--out", str(root / "bad")],
                                cwd=cwd, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
