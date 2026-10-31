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

    def test_references_keep_first_clip_per_signer_and_scores_average_signers(self):
        import numpy as np
        from gen.word_accuracy import references, score_words
        rows = [{"item": "W", "signer": "P", "tokens": [1]}, {"item": "W", "signer": "P", "tokens": [9]},
                {"item": "W", "signer": "Q", "tokens": [3]}]
        truth = references(rows, lambda tokens: np.full((4, 125, 3), tokens[0], dtype=np.float32))
        self.assertEqual({p: float(m[0, 0, 0]) for p, m in truth["W"].items()}, {"P": 1.0, "Q": 3.0})
        scored = score_words({"W": np.full((4, 125, 3), 2.0, dtype=np.float32)}, truth)
        self.assertAlmostEqual(scored["W"]["body"], np.sqrt(3), places=5)  # 두 화자 모두 각 축 1 차이
        self.assertAlmostEqual(scored["W"]["shape"], 0.0, places=5)

    def test_medoid_signers_all_sorted_and_rejects_untrained(self):
        from gen.word_accuracy import medoid_signers
        trained = {"REAL05": 1, "REAL01": 0, "REAL02": 2}
        self.assertEqual(medoid_signers(None, trained), [])
        self.assertEqual(medoid_signers(["all"], trained), ["REAL01", "REAL02", "REAL05"])
        self.assertEqual(medoid_signers(["REAL05", "REAL01", "REAL05"], trained), ["REAL05", "REAL01"])
        with self.assertRaises(SystemExit):
            medoid_signers(["REAL03"], trained)

    def test_pooled_medoid_uses_first_k_per_signer_and_picks_center(self):
        import numpy as np
        from gen.word_accuracy import pooled_medoid

        def m(v):
            return np.full((4, 125, 3), v, dtype=np.float32)
        cands = {"P": [m(0.0), m(9.0)], "Q": [m(1.0), m(-9.0)], "R": [m(3.0), m(9.0)]}
        self.assertEqual(float(pooled_medoid(cands, 1)[0, 0, 0]), 1.0)   # 0, 1, 3 중 가운데
        picked = pooled_medoid(cands, 2)                                  # 0, 9, 1, -9, 3, 9 중 가운데
        self.assertIn(float(picked[0, 0, 0]), (1.0, 3.0))
        joints_past_55 = {"P": [m(0.0)], "Q": [m(0.1)], "R": [m(0.2)]}
        joints_past_55["P"][0][:, 55:] = 100.0                            # 얼굴은 대표 고르기에 쓰지 않음
        self.assertAlmostEqual(float(pooled_medoid(joints_past_55, 1)[0, 0, 0]), 0.1, places=5)


if __name__ == "__main__":
    unittest.main()
