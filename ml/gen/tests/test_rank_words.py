"""Tiny invented model/tokens: ranking and baseline logic only."""
import importlib.util
import unittest


HAS_DEPS = all(importlib.util.find_spec(name) is not None for name in ("numpy", "torch"))


@unittest.skipUnless(HAS_DEPS, "NumPy/Torch absent")
class RankWordsTests(unittest.TestCase):
    def setUp(self):
        import torch
        from gen.model import MotionGPT
        torch.manual_seed(0)
        self.torch = torch
        self.words = {"A": [1, 1, 2, 2], "B": [3, 4, 3, 4], "C": [5, 6, 7], "D": [0, 7, 0, 7, 0]}
        self.classes = {w: i for i, w in enumerate(sorted(self.words))}
        self.rows = [{"item": w, "tokens": t, "signer": "S"} for w, t in self.words.items()]
        self.model = MotionGPT(len(self.classes), 8, d=32, layers=1, heads=2, max_len=8, n_signer=1, dropout=0.0)

    def memorize(self):
        torch, model = self.torch, self.model
        opt = torch.optim.Adam(model.parameters(), lr=1e-2)
        for _ in range(150):
            for row in self.rows:
                x = torch.tensor([row["tokens"]])
                y = torch.tensor([row["tokens"] + [model.end]])
                logits = model(torch.tensor([self.classes[row["item"]]]), x, torch.tensor([0]))
                loss = torch.nn.functional.cross_entropy(logits[0], y[0])
                opt.zero_grad()
                loss.backward()
                opt.step()
        model.eval()

    def test_memorized_model_ranks_correct_word_first(self):
        from gen.rank_words import evaluate_model
        self.memorize()
        metrics, ranks = evaluate_model(self.model, self.rows, self.classes, lambda r: 0, chunk=3)
        self.assertEqual(ranks, [1, 1, 1, 1])
        self.assertEqual(metrics["top1"], 1.0)
        self.assertAlmostEqual(metrics["chance_top1"], 0.25)
        self.assertGreater(metrics["condition_gain_by_position"][0], 0)
        self.assertIsNone(metrics["condition_gain_by_position"][-1])

    def test_chunking_does_not_change_scores(self):
        import numpy as np
        from gen.rank_words import score_clip
        self.model.eval()
        a, pa = score_clip(self.model, [1, 2, 3], 0, 4, chunk=1)
        b, pb = score_clip(self.model, [1, 2, 3], 0, 4, chunk=4)
        np.testing.assert_allclose(a, b, rtol=1e-5)
        self.assertEqual(pa.shape, (4, 4))
        np.testing.assert_allclose(a, pb.sum(1), rtol=1e-5)

    def test_bow_baseline_finds_distinct_words(self):
        from gen.rank_words import bow_baseline
        result = bow_baseline(self.rows, self.rows, self.classes, 8)
        self.assertEqual(result["nn1"]["top1"], 1.0)
        self.assertEqual(result["centroid"]["top1"], 1.0)


if __name__ == "__main__":
    unittest.main()
