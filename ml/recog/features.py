"""읽는 모델 입력 만들기: 움직임 구간 자르기 → 고정 길이로 늘이고 줄이기 → 관절 고르기 → 속도 붙이기.

수어 뜻은 대부분 손과 팔에 있으므로 기본 입력은 상체 13 + 양손 42 = 55점이다.
얼굴(입 모양·눈썹)은 --with-face 로 켠다.
"""
import numpy as np

from common.skeleton import BODY, FACE, LHAND, N_JOINTS, RHAND

MOUTH = slice(FACE.start + 48, FACE.start + 68)  # 입술 20점
BROWS = slice(FACE.start + 17, FACE.start + 27)  # 눈썹 10점


def joint_index(with_face=False):
    idx = list(range(BODY.start, BODY.stop)) + list(range(LHAND.start, RHAND.stop))
    if with_face:
        idx += list(range(MOUTH.start, MOUTH.stop)) + list(range(BROWS.start, BROWS.stop))
    return np.array(idx)


def resample(x, length):
    """시간축 선형 보간으로 길이를 맞춘다. x [T, ...]"""
    T = len(x)
    src = np.linspace(0, T - 1, length)
    lo = np.floor(src).astype(int)
    hi = np.minimum(lo + 1, T - 1)
    w = (src - lo).reshape(-1, *([1] * (x.ndim - 1)))
    return x[lo] * (1 - w) + x[hi] * w


def prepare(x, active, joints, length=64, pad=4):
    """x [T, 375] 정규화 좌표 → [length, J*3*2] (위치 + 프레임 간 속도)."""
    x = x.reshape(-1, N_JOINTS, 3)
    a, b = active
    seg = x[max(a - pad, 0): min(b + pad, len(x) - 1) + 1]
    seg = resample(seg, length)[:, joints]
    vel = np.diff(seg, axis=0, prepend=seg[:1])
    return np.concatenate([seg.reshape(length, -1), vel.reshape(length, -1) * 10.0], axis=1).astype(np.float32)


def augment(x, active, rng):
    """학습용 무작위 변형: 구간 경계 흔들기, 세로축 회전 ±15°, 크기 ±10%, 좌표 잡음."""
    x = x.reshape(-1, N_JOINTS, 3).copy()
    a, b = active
    a = int(np.clip(a + rng.integers(-5, 6), 0, len(x) - 2))
    b = int(np.clip(b + rng.integers(-5, 6), a + 1, len(x) - 1))
    th = np.deg2rad(rng.uniform(-15, 15))
    c, s = np.cos(th), np.sin(th)
    x = x @ np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]).T
    x *= rng.uniform(0.9, 1.1)
    x += rng.normal(0, 0.01, x.shape)
    return x.reshape(len(x), -1), [a, b]
