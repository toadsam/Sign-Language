"""동작 비교 지표. 입력은 정규화 좌표 [T, 125, 3] (단위: 어깨너비), scale을 곱하면 미터."""
import numpy as np

from common.skeleton import L_HAND_ROOT, N_JOINTS, R_HAND_ROOT

WRISTS = [L_HAND_ROOT, R_HAND_ROOT]


def as_joints(x):
    return np.asarray(x).reshape(len(x), N_JOINTS, 3)


def dtw_mje(a, b, scale=1.0):
    """속도 차이를 DTW로 맞춘 뒤 관절 평균 거리 (scale 곱하면 m, ×1000 → mm)."""
    a, b = as_joints(a), as_joints(b)
    cost = np.linalg.norm(a[:, None] - b[None], axis=-1).mean(-1)  # [Ta, Tb]
    Ta, Tb = cost.shape
    D = np.full((Ta + 1, Tb + 1), np.inf)
    D[0, 0] = 0.0
    L = np.zeros((Ta + 1, Tb + 1))
    for i in range(1, Ta + 1):
        for j in range(1, Tb + 1):
            k = np.argmin((D[i - 1, j - 1], D[i - 1, j], D[i, j - 1]))
            pi, pj = ((i - 1, j - 1), (i - 1, j), (i, j - 1))[k]
            D[i, j] = cost[i - 1, j - 1] + D[pi, pj]
            L[i, j] = L[pi, pj] + 1
    return float(D[Ta, Tb] / L[Ta, Tb] * scale)


def wrist_path(x):
    """양 손목이 움직인 거리의 합. 동작이 평균으로 뭉개지면 작아진다."""
    w = as_joints(x)[:, WRISTS]
    return float(np.linalg.norm(np.diff(w, axis=0), axis=-1).sum())


def jerk(x, fps=30):
    """손목 가속도 변화량 평균. 동작이 튈수록 크다."""
    w = as_joints(x)[:, WRISTS]
    if len(w) < 4:
        return 0.0
    return float(np.linalg.norm(np.diff(w, n=3, axis=0), axis=-1).mean() * fps ** 3)


def rest_dips(x, thresh=0.25, n_rest=5):
    """동작 중간에 손이 대기 자세 근처로 내려간 구간 수 (처음·끝 제외)."""
    w = as_joints(x)[:, WRISTS]
    d = np.linalg.norm(w - w[:n_rest].mean(0), axis=-1).max(-1)
    low = d < thresh
    idx = np.flatnonzero(~low)
    if idx.size == 0:
        return 0
    inner = low[idx[0]: idx[-1] + 1]
    return int(np.sum(inner[1:] & ~inner[:-1]))


def diversity(samples):
    """같은 입력으로 여러 번 만든 동작끼리의 평균 DTW 거리. 0이면 한 클립만 복사하는 것."""
    if len(samples) < 2:
        return 0.0
    d = [dtw_mje(samples[i], samples[j]) for i in range(len(samples)) for j in range(i + 1, len(samples))]
    return float(np.mean(d))
