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

    def test_fused_guidance_matches_two_separate_passes(self):
        """조건 있는/없는 예측을 한 묶음으로 계산해도 따로 두 번 계산한 것과 같은 토큰이 나온다."""
        from gen.model import MotionGPT, sample_next
        torch = self.torch
        m = MotionGPT(5, 8, d=16, layers=1, heads=2, max_len=6, n_signer=2, null_cond=True, cond_every=True).eval()
        cond, sig = torch.tensor([0, 1, 2, 3]), torch.tensor([0, 1, 0, 1])

        @torch.no_grad()
        def separate(guidance=2.0, min_len=2):
            seq = torch.empty(4, 0, dtype=torch.long)
            done = torch.zeros(4, dtype=torch.bool)
            for t in range(m.max_len):
                logits = m(cond, seq, sig)[:, -1]
                free = m(torch.full_like(cond, m.null), seq, sig)[:, -1]
                logits = free + guidance * (logits - free)
                if t < min_len:
                    logits[:, m.end] = float("-inf")
                nxt = sample_next(logits, 3, 1.0)
                nxt = torch.where(done, torch.full_like(nxt, m.pad), nxt)
                done |= nxt == m.end
                seq = torch.cat([seq, nxt[:, None]], 1)
                if done.all():
                    break
            return [[t for t in row if t < m.nb_code] for row in seq.tolist()]

        for seed in range(5):
            torch.manual_seed(seed)
            expected = separate()
            torch.manual_seed(seed)
            self.assertEqual(m.generate(cond, sig, top_k=3, guidance=2.0), expected)


if __name__ == "__main__":
    unittest.main()
