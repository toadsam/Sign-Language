"""비터비 격자 디코딩 (왼쪽 → 오른쪽, 단조).

원문 단위 열의 [i, j) 구간마다 후보를 낸다.
  phrase  구 대응표의 글로스 구 (생략 () 포함)
  rule    대응표에 없을 수도 있는 한 단위를 글로스 표에서 찾은 것 (B0 규칙)
  drop    한 단위를 버림 (내용어면 벌점)
  oov     대응표에도 표에도 없는 내용어 → 버리고 unknown으로 알린다

점수 = Σ w·(ln P(g|s), ln P(s|g), LM, 글로스 수, 구 수, 규칙 후보, 버림)
상태 = (위치, 직전 글로스 2개). 같은 상태는 최고 점수만, 위치마다 beam개.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import heapq

from gen.translate.lm import BOS, EOS
from gen.translate.units import is_marker

FEATURES = ("fwd", "bwd", "lm", "glosses", "phrases", "rule", "drop")
DEFAULT_WEIGHTS = {"fwd": 1.0, "bwd": 0.5, "lm": 0.5, "glosses": 1.0, "phrases": 0.0, "rule": -1.0, "drop": -2.0}


def span_candidates(units, i, j, phrase_table, lookup):
    """[i, j) 구간의 후보: [(글로스 tuple, kind, {특징: 값})]."""
    src = tuple(units[i:j])
    out = []
    for tgt, lf, lb, _c in phrase_table.get(src, ()):
        out.append((tuple(tgt), "phrase", {"fwd": lf, "bwd": lb}))
    if j - i == 1:
        u = units[i]
        have = {c[0] for c in out}
        if is_marker(u):
            if () not in have:
                out.append(((), "drop", {}))
        else:
            hit = lookup(u) if lookup else None
            if hit is not None and (hit,) not in have:
                out.append(((hit,), "rule", {"rule": 1.0}))
            if not out:
                out.append(((), "oov", {"drop": 1.0}))
            elif () not in have:
                out.append(((), "drop", {"drop": 1.0}))
    return out


def decode(units, phrase_table, lm, weights=None, lookup=None, max_src=3, beam=32, use_lm=True):
    """돌려주는 것: (글로스 열, 경로 [(i, j, 글로스 tuple, kind)])."""
    w = dict(DEFAULT_WEIGHTS)
    w.update(weights or {})
    n = len(units)
    # hyps[pos][(h1, h2)] = (점수, 이전 pos, 이전 상태, 간선)
    hyps = [dict() for _ in range(n + 1)]
    hyps[0][(BOS, BOS)] = (0.0, None, None, None)
    cand_cache = {}
    for i in range(n):
        if not hyps[i]:
            continue
        if len(hyps[i]) > beam:
            keep = heapq.nlargest(beam, hyps[i].items(), key=lambda kv: kv[1][0])
            hyps[i] = dict(keep)
        for j in range(i + 1, min(n, i + max_src) + 1):
            key = (i, j)
            if key not in cand_cache:
                cand_cache[key] = span_candidates(units, i, j, phrase_table, lookup)
            for tgt, kind, feats in cand_cache[key]:
                base = (w["fwd"] * feats.get("fwd", 0.0) + w["bwd"] * feats.get("bwd", 0.0)
                        + w["glosses"] * len(tgt) + w["phrases"] + w["rule"] * feats.get("rule", 0.0)
                        + w["drop"] * feats.get("drop", 0.0))
                for state, (score, *_rest) in hyps[i].items():
                    h1, h2 = state
                    s = score + base
                    if use_lm:
                        for g in tgt:
                            s += w["lm"] * lm.logprob(h1, h2, g)
                            h1, h2 = h2, g
                    elif tgt:
                        h1, h2 = (tgt[-2] if len(tgt) >= 2 else h2), tgt[-1]
                    nxt = (h1, h2)
                    old = hyps[j].get(nxt)
                    if old is None or s > old[0]:
                        hyps[j][nxt] = (s, i, state, (i, j, tgt, kind))
    best_state, best_score = None, None
    for state, (score, *_r) in hyps[n].items():
        s = score + (w["lm"] * lm.logprob(state[0], state[1], EOS) if use_lm else 0.0)
        if best_score is None or s > best_score:
            best_state, best_score = state, s
    if best_state is None:
        return [], []
    path = []
    pos, state = n, best_state
    while pos:
        _s, prev_pos, prev_state, edge = hyps[pos][state]
        path.append(edge)
        pos, state = prev_pos, prev_state
    path.reverse()
    glosses = [g for _i, _j, tgt, _k in path for g in tgt]
    return glosses, path
