"""MotionGPT condition options on tiny invented weights."""
import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("torch") is not None, "Torch absent")
class ConditionOptionTests(unittest.TestCase):
    def setUp(self):
        import torch
        self.torch = torch
        torch.manual_seed(0)

    def test_defaults_keep_legacy_parameters(self):
        from gen.model import MotionGPT
        old = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, n_signer=2)
        new = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, n_signer=2, cond_every=True)
        self.assertEqual({k: v.shape for k, v in old.state_dict().items()},
                         {k: v.shape for k, v in new.state_dict().items()})
        self.assertEqual(MotionGPT(5, 8, d=16, layers=1, heads=2, null_cond=True).cond.num_embeddings, 6)

    def test_cond_every_reaches_later_positions_only_through_condition(self):
        from gen.model import MotionGPT
        torch = self.torch
        m = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, dropout=0.0, cond_every=True).eval()
        legacy = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, dropout=0.0).eval()
        legacy.load_state_dict(m.state_dict())
        tokens = torch.tensor([[1, 2, 3]])
        a, b = m(torch.tensor([0]), tokens), legacy(torch.tensor([0]), tokens)
        self.assertTrue(torch.allclose(a[:, 0], b[:, 0], atol=1e-6))
        self.assertFalse(torch.allclose(a[:, 1:], b[:, 1:]))

    def test_guidance_needs_null_condition(self):
        from gen.model import MotionGPT
        torch = self.torch
        with self.assertRaises(ValueError):
            MotionGPT(5, 8, d=16, layers=1, heads=2).eval().generate(torch.tensor([0]), guidance=2.0)
        m = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, null_cond=True).eval()
        out = m.generate(torch.tensor([0, 1]), guidance=2.0)
        self.assertEqual(len(out), 2)
        self.assertTrue(all(0 <= t < 8 for row in out for t in row))


if __name__ == "__main__":
    unittest.main()
