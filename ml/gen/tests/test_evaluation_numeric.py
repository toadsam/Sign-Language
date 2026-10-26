"""Real NumPy/Torch calculations on invented arrays; skip when absent locally."""
import importlib.util
import random
import unittest

from gen.evaluate import _no_grad, dtw, isolated_rng


HAS_NUMPY = importlib.util.find_spec("numpy") is not None
HAS_TORCH = importlib.util.find_spec("torch") is not None


@unittest.skipUnless(HAS_NUMPY, "NumPy absent: ndarray DTW path unverified")
class NumpyDtwTests(unittest.TestCase):
    def test_ndarray_dtw_uses_55_joints_shoulder_units_and_path_length(self):
        import numpy as np

        a = np.zeros((4, 125, 3), dtype=np.float32)
        b = np.zeros((6, 125, 3), dtype=np.float32)
        b[:, :55, 0] = 2.0
        b[:, 55:, 0] = 1000.0  # face is outside the metric
        self.assertAlmostEqual(dtw(a, b), 2.0)
        self.assertEqual(dtw(a, a), 0.0)
        b[0, 0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "motion_nonfinite"):
            dtw(a, b)


@unittest.skipUnless(HAS_TORCH, "Torch absent: fork_rng/no_grad path unverified")
class TorchRngTests(unittest.TestCase):
    def test_cpu_rng_restored_and_no_grad(self):
        import torch

        python_state = random.getstate()
        torch_state = torch.get_rng_state().clone()
        with isolated_rng(17, "cpu"), _no_grad():
            self.assertFalse(torch.is_grad_enabled())
            random.random()
            torch.rand(5)
        self.assertEqual(random.getstate(), python_state)
        self.assertTrue(torch.equal(torch.get_rng_state(), torch_state))


if __name__ == "__main__":
    unittest.main()
