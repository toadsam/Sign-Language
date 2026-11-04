"""계약 ④: 정규화된 실제/복원/생성 동작을 같은 전처리로 채점한다."""
from pathlib import Path

import numpy as np
import torch

from recog.features import joint_index, prepare
from recog.model import load_recognizer


def validate_motion(motion, active=None):
    x = np.asarray(motion, dtype=np.float32)
    if x.ndim not in (2, 3) or x.shape[1:] not in ((375,), (125, 3)):
        raise ValueError("motion은 [T, 375] 또는 [T, 125, 3]이어야 합니다.")
    if len(x) == 0 or not np.isfinite(x).all():
        raise ValueError("motion은 비어 있지 않은 유한 좌표여야 합니다.")
    if active is None:
        active = (0, len(x) - 1)
    if (len(active) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, np.integer)) for v in active)
            or not 0 <= active[0] <= active[1] < len(x)):
        raise ValueError("active는 0 <= 시작 <= 끝 < T인 프레임 번호입니다 (끝 포함).")
    return x.reshape(len(x), 375), tuple(active)


class Recognizer:
    def __init__(self, run_dir: str, device: str = "cpu"):
        self.device = torch.device(device)
        self.model, self.checkpoint = load_recognizer(Path(run_dir) / "model.pt")
        self.model.to(self.device).eval()
        self.classes = self.checkpoint["classes"]
        if sorted(self.classes.values()) != list(range(len(self.classes))) or not self.classes:
            raise ValueError("체크포인트 classes는 0부터 이어지는 단어 인덱스여야 합니다.")
        self.items = sorted(self.classes, key=self.classes.get)
        self.joints = joint_index(self.checkpoint["with_face"])
        self.length = self.checkpoint["length"]

    @torch.inference_mode()
    def score(self, motion: np.ndarray, active: tuple[int, int] | None = None) -> dict:
        x, active = validate_motion(motion, active)
        features = prepare(x, active, self.joints, self.length)
        probs = torch.softmax(self.model(torch.from_numpy(features)[None].to(self.device)), -1)[0]
        probs = probs.cpu().numpy()
        order = np.argsort(-probs, kind="stable")[:5]
        return {"top5": [(self.items[i], float(probs[i])) for i in order], "probs": probs}
