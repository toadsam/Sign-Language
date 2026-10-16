"""비교 기준선 ①: 단어 클립 이어붙이기 (지금 서비스 방식).

hard_cut  클립 전체(앞뒤 대기 자세 포함)를 그대로 잇는다 — 1학기 영상 재생과 같은 결과
trimmed   움직임 구간만 잘라 잇고, 사이를 blend 프레임 동안 직선으로 옮겨 간다 — 폴백(B0)
"""
import numpy as np

PAD = 4


def hard_cut(clips):
    return np.concatenate([m["x"] for m in clips])


def trimmed(clips, blend=8):
    segs = []
    for m in clips:
        a, b = m["active"]
        segs.append(m["x"][max(a - PAD, 0): min(b + PAD + 1, len(m["x"]))])
    out = [segs[0]]
    for s in segs[1:]:
        p, q = out[-1][-1], s[0]
        w = np.linspace(0, 1, blend + 2)[1:-1, None]
        out.append(p * (1 - w) + q * w)
        out.append(s)
    return np.concatenate(out)
