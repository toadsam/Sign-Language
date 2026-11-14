"""번역 채점.

  F1   문장마다 글로스 다중집합 겹침 TP = Σ min(예측 수, 정답 수), 전체 합산(micro): 2ΣTP / (Σ|예측| + Σ|정답|)
  WER  Σ 편집 거리 / Σ 정답 길이 (순서까지 본다)
  완전 일치율  예측 열 == 정답 열인 문장 비율
  그릴 수 있는 비율  낸 글로스 중 글로스 표에서 동작 단위를 찾은 비율

정답이 여럿이면 문장마다 F1이 가장 높은 정답 하나로 센다 (같으면 WER이 낮은 쪽).
설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import collections
import random


def normalize(seq):
    """'#' 뒤 변이 표시를 떼고 빈 글로스를 버린다."""
    out = []
    for g in seq:
        g = str(g).split("#", 1)[0].strip()
        if g:
            out.append(g)
    return out


def overlap(pred, ref):
    a, b = collections.Counter(pred), collections.Counter(ref)
    return sum(min(c, b[g]) for g, c in a.items())


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def _best_ref(pred, refs):
    best = None
    for r in refs:
        tp = overlap(pred, r)
        f = 2 * tp / (len(pred) + len(r)) if (len(pred) + len(r)) else 1.0
        key = (f, -edit_distance(pred, r))
        if best is None or key > best[0]:
            best = (key, r)
    return best[1]


def sentence_stats(pred, refs):
    """한 문장: refs는 정답 열 하나(list[str]) 또는 여럿(list[list[str]])."""
    pred = normalize(pred)
    if refs and isinstance(refs[0], str):
        refs = [refs]
    refs = [normalize(r) for r in refs] or [[]]
    ref = _best_ref(pred, refs)
    return {"tp": overlap(pred, ref), "n_pred": len(pred), "n_ref": len(ref),
            "edits": edit_distance(pred, ref), "exact": pred == ref}


def aggregate(stats):
    tp = sum(s["tp"] for s in stats)
    npred = sum(s["n_pred"] for s in stats)
    nref = sum(s["n_ref"] for s in stats)
    p = tp / npred if npred else 0.0
    r = tp / nref if nref else 0.0
    f1 = 2 * tp / (npred + nref) if (npred + nref) else 1.0
    return {"n": len(stats), "precision": p, "recall": r, "f1": f1,
            "wer": sum(s["edits"] for s in stats) / nref if nref else 0.0,
            "exact": sum(s["exact"] for s in stats) / len(stats) if stats else 0.0}


def score(preds, refs_list):
    return aggregate([sentence_stats(p, r) for p, r in zip(preds, refs_list)])


def bootstrap_f1(stats, n_boot=1000, seed=0):
    """문장을 복원 추출해 F1의 95% 구간."""
    if not stats:
        return (0.0, 0.0)
    rng = random.Random(seed)
    vals = []
    for _ in range(n_boot):
        sample = [stats[rng.randrange(len(stats))] for _ in stats]
        vals.append(aggregate(sample)["f1"])
    vals.sort()
    return vals[int(0.025 * n_boot)], vals[min(n_boot - 1, int(0.975 * n_boot))]


def drawable_ratio(unit_lists):
    """translate()의 units 열들: None이 아닌 비율."""
    total = sum(len(u) for u in unit_lists)
    ok = sum(1 for us in unit_lists for u in us if u is not None)
    return ok / total if total else 0.0
