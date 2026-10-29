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

    def test_loader_reads_quick_fit_and_formal_checkpoints(self):
        import tempfile
        from pathlib import Path
        import torch
        from gen.model import MotionGPT
        from gen.word_test_eval import load_quick_fit
        model = MotionGPT(3, 8, d=8, layers=1, max_len=5, n_signer=2, cond_every=True, null_cond=True)
        common = {"model": model.state_dict(), "classes": {"W0": 0, "W1": 1, "W2": 2}, "signers": {"S0": 0, "S1": 1},
                  "nb_code": 8, "max_len": 5, "generation_signer": "S0"}
        quick = {**common, "arch": {"d": 8, "layers": 1, "dropout": 0.1, "cond_every": True, "null_cond": True}}
        formal = {**common, "checkpoint_schema_version": 1, "checkpoint_type": "inference", "kind": "gpt",
                  "config": {"d": 8, "layers": 1, "cond_every": True, "cond_drop": 0.1}}
        with tempfile.TemporaryDirectory() as root:
            for name, ck in (("quick", quick), ("formal", formal)):
                torch.save(ck, Path(root) / f"{name}.pt")
                loaded, meta = load_quick_fit(Path(root) / f"{name}.pt", "cpu")
                with self.subTest(name=name):
                    self.assertEqual((loaded.null, loaded.cond_every, meta["generation_signer"]), (3, True, "S0"))
                    self.assertFalse(loaded.training)


if __name__ == "__main__":
    unittest.main()
