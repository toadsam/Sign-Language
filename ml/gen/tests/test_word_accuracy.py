"""Invented coordinates only: active-segment cropping and hand-shape distance."""
import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("torch") is not None, "Torch absent")
class WordAccuracyTests(unittest.TestCase):
    def test_active_crops_rest_frames(self):
        import numpy as np
        from gen.word_accuracy import active
        m = np.zeros((10, 125, 3), dtype=np.float32)
        m[:, 13, 1] = m[:, 34, 1] = 1.0          # 손을 내린 자세
        m[3:8, 34, 1] = 0.2                      # 3~7프레임만 오른손을 든다
        self.assertEqual(len(active(m.reshape(10, 375))), 5)
        self.assertEqual(len(active(np.zeros((6, 375), dtype=np.float32))), 6)  # 움직임이 없으면 전부

    def test_shape_distance_ignores_wrist_position(self):
        import numpy as np
        from gen.word_accuracy import body_distance, shape_distance
        a = np.random.default_rng(0).normal(size=(4, 125, 3)).astype(np.float32)
        b = a.copy()
        b[:, 13:34] += 0.5                       # 왼손 전체를 옮기기만 함 = 손 모양은 같음
        self.assertAlmostEqual(shape_distance(a, b), 0.0, places=5)
        self.assertGreater(body_distance(a, b), 0.1)


if __name__ == "__main__":
    unittest.main()
