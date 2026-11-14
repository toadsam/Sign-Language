"""문장 동작 계산 도구: DTW 거리, 경계 튐(jerk), 기준선 A(단위 대표 동작 이어 붙이기).

설계 참고: sign-motion-gloss (코드 복사 없음)

거리 단위는 gen.word_accuracy와 같다(정규화 좌표 = 어깨너비, 상체 + 양손 55점).
  dtw_distance  두 구간을 DTW로 맞춘 뒤, 맞춘 프레임 쌍마다 55점 평균 관절 거리 → 경로 평균
  boundary_jerk 단어 경계 창(앞 단어 끝 −4 ~ 다음 단어 시작 +4 프레임) 안 두 손목 jerk(3차 차분) 크기의 최대값
기준선 A  단위마다 학습 몫 구간들 중 대표(medoid: 32프레임으로 맞춘 55점 거리 합 최소)를 골라 두고,
          생성 때 이어 붙이며 사이를 직선 보간한다.
"""
from collections import defaultdict

import numpy as np

from gen.gen_match import resample

BODY_HANDS = slice(0, 55)
WRISTS = (13, 34)


def as_points(motion):
    m = np.asarray(motion, dtype=np.float32)
    return m if m.ndim == 3 else m.reshape(len(m), -1, 3)


def dtw_distance(a, b):
    """a [n, J, 3], b [m, J, 3] → DTW 경로 평균 55점 관절 거리. 빈 구간이면 None."""
    a, b = as_points(a)[:, BODY_HANDS], as_points(b)[:, BODY_HANDS]
    n, m = len(a), len(b)
    if not n or not m:
        return None
    cost = np.linalg.norm(a[:, None] - b[None], axis=-1).mean(-1)  # [n, m]
    acc = np.full((n + 1, m + 1), np.inf)
    steps = np.zeros((n + 1, m + 1))
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        ci = cost[i - 1]
        for j in range(1, m + 1):
            d, u, l = acc[i - 1, j - 1], acc[i - 1, j], acc[i, j - 1]
            if d <= u and d <= l:
                acc[i, j], steps[i, j] = d + ci[j - 1], steps[i - 1, j - 1] + 1
            elif u <= l:
                acc[i, j], steps[i, j] = u + ci[j - 1], steps[i - 1, j] + 1
            else:
                acc[i, j], steps[i, j] = l + ci[j - 1], steps[i, j - 1] + 1
    return float(acc[n, m] / steps[n, m])


def wrist_jerk(motion):
    """[T, J, 3] → [T-3] 프레임 k(k..k+3을 씀)의 두 손목 jerk 크기 중 큰 값."""
    p = as_points(motion)[:, list(WRISTS)]
    if len(p) < 4:
        return np.zeros(0, dtype=np.float32)
    j = p[3:] - 3 * p[2:-1] + 3 * p[1:-2] - p[:-3]
    return np.linalg.norm(j, axis=-1).max(-1)


def boundary_jerk(motion, segments, pad=4):
    """segments [(unit, start, end_exclusive)] → 경계마다 창 안 jerk 최대값 목록."""
    jerk = wrist_jerk(motion)
    out = []
    for (_, _, e0), (_, s1, _) in zip(segments, segments[1:]):
        lo, hi = max(0, e0 - pad), min(len(motion), s1 + pad)
        ks = jerk[lo:max(lo, hi - 3)]
        if len(ks):
            out.append(float(ks.max()))
    return out


def connections(segments):
    """단어 구간 목록 → 연결 구간 [(start, end_exclusive)] (앞 단어 끝 ~ 다음 단어 시작)."""
    return [(e0, s1) for (_, _, e0), (_, s1, _) in zip(segments, segments[1:])]


def compare(motion, segs, ref, ref_segs):
    """같은 단위 열의 두 동작 비교 → {"word": [...], "conn": [...]} (구간 길이가 0이면 그 연결은 뺀다)."""
    if [s[0] for s in segs] != [s[0] for s in ref_segs]:
        raise ValueError("segment units differ")
    m, r = as_points(motion), as_points(ref)
    word = [dtw_distance(m[a:b], r[c:d]) for (_, a, b), (_, c, d) in zip(segs, ref_segs)]
    conn = []
    for (a, b), (c, d) in zip(connections(segs), connections(ref_segs)):
        if b > a and d > c:
            conn.append(dtw_distance(m[a:b], r[c:d]))
    return {"word": [w for w in word if w is not None], "conn": [c for c in conn if c is not None]}


def medoid_of(motions, frames=32):
    """후보 동작들 중 대표 위치(32프레임으로 맞춘 55점 평균 거리 합 최소). 정답을 보지 않는다."""
    x = np.stack([resample(as_points(m).reshape(len(m), -1), frames)[:, BODY_HANDS] for m in motions])
    d = np.linalg.norm(x[:, None] - x[None], axis=-1).mean(axis=(2, 3))
    return int(d.sum(1).argmin())


def baseline_occurrences(train_rows, down):
    """단위 → [(clip, 토큰 열, 프레임 시작, 프레임 끝_제외)] (토큰 열 기준 프레임; 문장은 실제 구간 f0~f1)."""
    occ = defaultdict(list)
    for r in train_rows:
        n = len(r["tokens"]) * down
        if r["type"] == "WORD":
            occ[r["spans"][0][0]].append((r["clip"], r["tokens"], 0, n))
            continue
        base = r["frames"][0]
        for unit, f0, f1 in r["segments"]:
            s, e = max(0, f0 - base), min(n, f1 + 1 - base)
            if e > s:
                occ[unit].append((r["clip"], r["tokens"], s, e))
    return occ


def build_baseline(train_rows, down, decode, per_unit=32, seed=17, units=None, log=None):
    """단위마다 학습 몫 구간 최대 per_unit개를 복원해 대표 하나를 고른다.

    decode(tokens) → [T, 375] 또는 [T, 125, 3]. 같은 클립은 한 번만 복원한다(묶음 단위로 캐시).
    → {unit: (55점 동작 [t, 55, 3] float32, {clip, start, end, candidates})}"""
    occ = baseline_occurrences(train_rows, down)
    rng = np.random.default_rng(seed)
    wanted = sorted(occ if units is None else set(units) & set(occ))
    picks = {}
    for u in wanted:
        items = occ[u]
        if len(items) > per_unit:
            items = [items[i] for i in sorted(rng.choice(len(items), per_unit, replace=False))]
        picks[u] = items
    by_clip = defaultdict(list)
    for u, items in picks.items():
        for k, it in enumerate(items):
            by_clip[it[0]].append((u, k))
    motions = {u: [None] * len(items) for u, items in picks.items()}
    for n, (clip, uses) in enumerate(sorted(by_clip.items())):
        u0, k0 = uses[0]
        full = as_points(decode(picks[u0][k0][1]))
        for u, k in uses:
            _, _, s, e = picks[u][k]
            motions[u][k] = full[s:e, BODY_HANDS].copy()
        if log and (n + 1) % 5000 == 0:
            log(f"decoded {n + 1}/{len(by_clip)} clips")
    out = {}
    for u, ms in motions.items():
        i = medoid_of(ms)
        clip, _, s, e = picks[u][i]
        out[u] = (ms[i].astype(np.float32), {"clip": clip, "start": int(s), "end": int(e), "candidates": len(ms)})
    return out


def concat_with_interp(parts, gap):
    """동작 조각들 [t_i, J, 3]을 이어 붙이고 사이에 gap프레임 직선 보간. → (동작, [(start, end_exclusive)])"""
    pieces, spans, t = [], [], 0
    for k, p in enumerate(parts):
        p = as_points(p)
        if k and gap > 0:
            w = np.linspace(0, 1, gap + 2, dtype=np.float32)[1:-1, None, None]
            pieces.append(pieces[-1][-1][None] * (1 - w) + p[0][None] * w)
            t += gap
        pieces.append(p)
        spans.append((t, t + len(p)))
        t += len(p)
    return np.concatenate(pieces, 0).astype(np.float32), spans
