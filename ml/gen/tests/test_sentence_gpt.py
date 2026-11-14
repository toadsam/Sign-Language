"""문장 GPT: 모델 · 학습 · 추론 · 기준선 · 지표 (지어낸 작은 자료, CPU)."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from gen.sentence_data import select
from gen.sentence_eval import run_eval
from gen.sentence_generator import load_sentence_generator, save_baseline
from gen.sentence_gpt import SentenceGPT
from gen.sentence_motion import (boundary_jerk, build_baseline, compare, concat_with_interp, dtw_distance,
                                 medoid_of, wrist_jerk)
from gen.tests.test_sentence_data import SEN_VAL, SPLIT, sen_meta, word_meta
from gen.train_sentence_gpt import Config, train
from vq.model import MotionVQVAE


def tiny_inputs(n_tok=10):
    metas = []
    for signer in ("A", "B"):
        metas += [sen_meta(f"S1_{signer}", "SEN1", signer, [("가", 4, 12), ("나", 16, 30)]),
                  sen_meta(f"S2_{signer}", "SEN2", signer, [("나", 4, 12), ("가", 18, 30)]),
                  sen_meta(f"S9_{signer}", "SEN9", signer, [("가", 4, 12), ("나", 18, 30)]),
                  sen_meta(f"S7_{signer}", "SEN7", signer, [("나", 4, 14), ("가", 18, 30)]),
                  word_meta(f"W1_{signer}", "WORD1", signer)]
    metas.append(sen_meta("S9_T", "SEN9", "T", [("가", 4, 12), ("나", 18, 30)]))
    metas.append(sen_meta("S7x_A", "SEN7", "A", [("나", 4, 14), ("모름", 18, 30)]))  # 검증 문장에만 있는 단위
    tokens = {"nb_code": 8, "down": 4, "clips": {}}
    for m in metas:
        n = n_tok if m["type"] == "SEN" else 5
        seq = [(i * 3 + (m["item"] == "SEN2")) % 8 for i in range(n)]  # 배울 수 있는 고정 열
        tokens["clips"][m["clip"]] = {"item": m["item"], "signer": m["signer"], "type": m["type"],
                                      "frames": [0, 4 * n], "tokens": seq}
    return tokens, {m["clip"]: m for m in metas}


class ModelTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(0)
        self.model = SentenceGPT(n_units=7, nb_code=8, d=16, layers=1, heads=2, max_len=6, n_signer=2).eval()

    def conds(self, B, L):
        g = torch.Generator().manual_seed(1)
        return [torch.randint(0, 7, (B, L), generator=g) for _ in range(3)] + \
               [torch.randint(0, 4, (B, L), generator=g) for _ in range(2)]

    def test_forward_is_causal(self):
        c = self.conds(2, 6)
        sig = torch.tensor([0, 1])
        tok = torch.randint(0, 8, (2, 6))
        out = self.model(*c, sig, tok)
        self.assertEqual(tuple(out.shape), (2, 6, 8))
        tok2 = tok.clone()
        tok2[:, 3] = (tok2[:, 3] + 1) % 8
        out2 = self.model(*c, sig, tok2)
        self.assertTrue(torch.allclose(out[:, :4], out2[:, :4], atol=1e-5))  # 토큰 3은 위치 4부터 영향
        self.assertFalse(torch.allclose(out[:, 4:], out2[:, 4:], atol=1e-5))

    def test_generate_lengths_guidance_window(self):
        c = self.conds(3, 5)
        sig = torch.tensor([0, 1, 0])
        out = self.model.generate(*c, sig, guidance=2.0)
        self.assertEqual(tuple(out.shape), (3, 5))
        self.assertTrue(((out >= 0) & (out < 8)).all())
        long = self.model.generate(*self.conds(1, 9), torch.tensor([1]))  # max_len 6보다 긴 일정표
        self.assertEqual(tuple(long.shape), (1, 9))
        with self.assertRaises(ValueError):
            self.model(*self.conds(1, 7), torch.tensor([0]), torch.zeros(1, 7, dtype=torch.long))


class MotionToolTests(unittest.TestCase):
    def test_dtw(self):
        rng = np.random.default_rng(0)
        a = rng.normal(size=(10, 125, 3)).astype(np.float32)
        self.assertAlmostEqual(dtw_distance(a, a), 0.0, places=6)
        stretched = np.repeat(a, 2, 0)  # 같은 동작을 느리게
        self.assertAlmostEqual(dtw_distance(a, stretched), 0.0, places=6)
        self.assertGreater(dtw_distance(a, a + 0.5), 0.4)
        self.assertIsNone(dtw_distance(a[:0], a))

    def test_jerk_and_concat(self):
        t = np.arange(20, dtype=np.float32)[:, None, None]
        linear = np.repeat(t * 0.1, 125, 1).repeat(3, 2)
        self.assertAlmostEqual(float(wrist_jerk(linear).max()), 0.0, places=5)
        a, b = np.zeros((5, 55, 3), np.float32), np.ones((4, 55, 3), np.float32)
        motion, spans = concat_with_interp([a, b], 3)
        self.assertEqual(spans, [(0, 5), (8, 12)])
        self.assertTrue(np.allclose(motion[5:8, 0, 0], [0.25, 0.5, 0.75]))
        jumps = boundary_jerk(np.concatenate([a, b]), [("x", 0, 5), ("y", 5, 9)])
        self.assertEqual(len(jumps), 1)
        self.assertGreater(jumps[0], 0.9)
        c = compare(motion, [("x", 0, 5), ("y", 8, 12)], motion, [("x", 0, 5), ("y", 8, 12)])
        self.assertEqual(c["word"], [0.0, 0.0])
        self.assertEqual(len(c["conn"]), 1)
        with self.assertRaises(ValueError):
            compare(motion, [("x", 0, 5)], motion, [("y", 0, 5)])

    def test_medoid(self):
        base = np.zeros((8, 55, 3), np.float32)
        ms = [base + 0.1, base, base - 0.1, base + 5]
        self.assertEqual(medoid_of(ms), 1)


class TrainInferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        root = Path(cls.tmp.name)
        torch.manual_seed(0)
        decoder = MotionVQVAE(width=8, code_dim=4, nb_code=8, depth=1, parts="body_hand")
        with torch.no_grad():
            decoder.quantizer.codebook.normal_()
        cls.vq_path = root / "vq.pt"
        torch.save({"config": {"width": 8, "code_dim": 4, "nb_code": 8, "depth": 1, "parts": "body_hand"},
                    "model": decoder.state_dict()}, cls.vq_path)
        tokens, metas = tiny_inputs()
        cls.sel = select(tokens, metas, SPLIT, SEN_VAL)
        cls.run_dir = root / "run"
        cls.cfg = Config(iters=150, batch=8, lr=3e-3, warmup=10, d=32, layers=1, heads=2, max_len=16,
                         eval_every=50, amp=False, corrupt=0.0)
        cls.result = train(cls.sel, cls.run_dir, cls.cfg, "cpu", vq_path=cls.vq_path, log_every=10)

    def test_run_files_and_loss(self):
        for name in ("model.pt", "latest.pt", "vocab.json", "schedule.json", "selection.json", "generator.json"):
            self.assertTrue((self.run_dir / name).exists(), name)
        log = [json.loads(l) for l in (self.run_dir / "log.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertLess(log[-1]["train_loss"], log[0]["train_loss"])
        sel = json.loads((self.run_dir / "selection.json").read_text(encoding="utf-8"))
        self.assertEqual(sel["leak_check"], "passed")
        self.assertFalse(set(sel["clips"]["train"]) & (set(sel["clips"]["test"]) | set(sel["clips"]["val"])))
        self.assertEqual(self.result["train_sen"], 2)
        self.assertEqual(self.result["val_skipped_unknown_unit"], 1)  # SEN1 × 2명 (SEN2는 SEN7과 같은 글로스 열이라 아님)

    def test_resume_continues(self):
        cfg = Config(**{**self.cfg.__dict__, "iters": 160})
        out = train(self.sel, self.run_dir, cfg, "cpu", vq_path=self.vq_path, resume=True)
        self.assertEqual(out["step"], 160)

    def test_generator_model_and_baseline(self):
        gen = load_sentence_generator(self.run_dir, "cpu")
        out = gen.generate(["S:가", "S:나", "S:없는것"], signer="A", seed=3)
        self.assertEqual(out["source"], "model")
        self.assertEqual(out["unknown_units"], ["S:없는것"])
        self.assertEqual(out["motion"].shape[1:], (125, 3))
        self.assertEqual(out["motion"].dtype, np.float32)
        self.assertEqual(len(out["motion"]), 4 * len(out["tokens"]))
        self.assertEqual([s["unit"] for s in out["segments"]], ["S:가", "S:나"])
        self.assertLess(out["segments"][0]["end"], out["segments"][1]["start"] + 1)
        again = gen.generate(["S:가", "S:나"], signer="A", seed=3)
        self.assertEqual(again["tokens"], out["tokens"])
        pooled = gen.generate(["W:WORD1", "S:가"], seed=1)
        self.assertEqual(len(pooled["segments"]), 2)
        self.assertEqual(gen.generate(["S:없는것"])["segments"], [])
        with self.assertRaises(ValueError):
            gen.generate(["S:가"], signer="T")

        _, decode = __import__("gen.sentence_eval", fromlist=["make_decoder"]).make_decoder(self.vq_path, "cpu")
        table = build_baseline(self.sel["train"], 4, decode)
        self.assertEqual(set(table), {"S:가", "S:나", "W:WORD1"})
        save_baseline(self.run_dir / "baseline.npz", table, np.zeros((125, 3)), 2)
        base = load_sentence_generator(self.run_dir, "cpu", mode="baseline")
        b = base.generate(["S:가", "S:나"])
        self.assertEqual(b["source"], "baseline")
        self.assertEqual(b["segments"][1]["start"] - b["segments"][0]["end"], 2)

        gen = load_sentence_generator(self.run_dir, "cpu")
        report = run_eval(gen, self.sel["test"], "test", gen.decode, log=lambda *_: None)
        self.assertEqual(report["evaluated"], 2)
        self.assertEqual(set(report["methods"]), {"model", "baseline", "human"})
        self.assertEqual(report["methods"]["model"]["word_n"], 4)
        ts = run_eval(gen, self.sel["test_signer"], "test_signer", gen.decode, log=lambda *_: None)
        self.assertEqual(ts["evaluated"], 1)

    def test_vq_hash_checked(self):
        other = Path(self.tmp.name) / "other_vq.pt"
        torch.save({"config": {"width": 8, "code_dim": 4, "nb_code": 8, "depth": 1, "parts": "body_hand"},
                    "model": MotionVQVAE(width=8, code_dim=4, nb_code=8, depth=1, parts="body_hand").state_dict()},
                   other)
        with self.assertRaises(ValueError):
            load_sentence_generator(self.run_dir, "cpu", vq_path=other)


if __name__ == "__main__":
    unittest.main()
