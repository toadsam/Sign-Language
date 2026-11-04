"""실제 모델의 배치 점검 경로를 단건 계약과 대조한다 (합성 좌표만 사용)."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from eval.audit_recognizer import score_features
from recog.features import prepare
from recog.infer import Recognizer
from recog.model import SignRecognizer


class AuditBatchTest(unittest.TestCase):
    def compare(self, n_class, tie=False):
        torch.set_num_threads(1)
        torch.manual_seed(73)
        model = SignRecognizer(330, n_class).eval()
        if tie:
            with torch.no_grad():
                model.head[-1].weight.zero_()
                model.head[-1].bias.zero_()
        with tempfile.TemporaryDirectory() as tmp:
            classes = {f"WORD{i:04d}": i for i in range(n_class)}
            torch.save({"model": model.state_dict(), "in_dim": 330, "classes": classes,
                        "with_face": False, "length": 64}, Path(tmp) / "model.pt")
            recognizer = Recognizer(tmp)
            rng = np.random.default_rng(17)
            motions = [rng.normal(size=(length, 375)).astype(np.float32) for length in (9, 23, 31)]
            features = [prepare(x, (1, len(x)-2), recognizer.joints, 64) for x in motions]
            batched = score_features(recognizer, features)
            for x, probs in zip(motions, batched):
                reference = recognizer.score(x, (1, len(x)-2))
                np.testing.assert_allclose(probs, reference["probs"], atol=1e-7, rtol=1e-5)
                order = np.argsort(-probs, kind="stable")[:5]
                self.assertEqual([recognizer.items[i] for i in order],
                                 [word for word, _ in reference["top5"]])
                if tie:
                    self.assertEqual(order.tolist(), list(range(5)))

    def test_3000_class_batch_matches_single_motion_contract(self):
        self.compare(3000)

    def test_tied_probabilities_keep_stable_class_order(self):
        self.compare(7, tie=True)


if __name__ == "__main__":
    unittest.main()
