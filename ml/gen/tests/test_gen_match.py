"""Invented coordinates only: resampling and nearest-word ranking."""
import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("numpy") is not None, "NumPy absent")
class GenMatchTests(unittest.TestCase):
    def test_resample_keeps_endpoints_and_shape(self):
        import numpy as np
        from gen.gen_match import resample
        m = np.arange(5 * 375, dtype=np.float32).reshape(5, 375)
        out = resample(m, 9)
        self.assertEqual(out.shape, (9, 125, 3))
        np.testing.assert_allclose(out[0], m[0].reshape(125, 3))
        np.testing.assert_allclose(out[-1], m[-1].reshape(125, 3))
        np.testing.assert_allclose(out[1], (m[0] + m[1]).reshape(125, 3) / 2)

    def test_ranks_use_nearest_clip_per_word(self):
        import numpy as np
        from gen.gen_match import distances, summarize, word_ranks
        base = lambda v: np.full((4, 125, 3), v, dtype=np.float32)
        refs = np.stack([base(0), base(10), base(20), base(21)])
        ref_words = ["A", "A", "B", "B"]
        queries = np.stack([base(9), base(19), base(1)])
        ranks, per_word, truth = word_ranks(distances(queries, refs, slice(0, 55)), ref_words, ["A", "B", "B"], ["A", "B"])
        self.assertEqual(ranks.tolist(), [1, 1, 2])
        s = summarize(ranks, per_word, truth)
        self.assertAlmostEqual(s["top1"], 2 / 3)
        self.assertAlmostEqual(s["chance_top1"], 0.5)


if __name__ == "__main__":
    unittest.main()
