"""Invented coordinates only: GPU-free distance parity and medoid choice."""
import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("torch") is not None, "Torch absent")
class WordTestEvalTests(unittest.TestCase):
    def test_torch_distances_match_numpy(self):
        import numpy as np
        from gen.gen_match import distances
        from gen.word_test_eval import torch_distances
        rng = np.random.default_rng(0)
        q, r = rng.normal(size=(5, 4, 125, 3)).astype(np.float32), rng.normal(size=(7, 4, 125, 3)).astype(np.float32)
        np.testing.assert_allclose(torch_distances(q, r, slice(0, 55), "cpu", chunk=2),
                                   distances(q, r, slice(0, 55)), rtol=1e-5)

    def test_medoid_picks_central_sample(self):
        import numpy as np
        from gen.word_test_eval import medoid
        base = lambda v: np.full((4, 125, 3), v, dtype=np.float32)
        self.assertEqual(medoid([base(0), base(1), base(10)], slice(0, 55)), 1)


if __name__ == "__main__":
    unittest.main()
