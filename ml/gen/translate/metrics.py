"""번역 채점.

  F1   문장마다 글로스 다중집합 겹침 TP = Σ min(예측 수, 정답 수), 전체 합산(micro): 2ΣTP / (Σ|예측| + Σ|정답|)
  WER  Σ 편집 거리 / Σ 정답 길이 (순서까지 본다)
  완전 일치율  예측 열 == 정답 열인 문장 비율
  그릴 수 있는 비율  낸 글로스 중 글로스 표에서 동작 단위를 찾은 비율

정답이 여럿이면 문장마다 F1이 가장 높은 정답 하나로 센다 (같으면 WER이 낮은 쪽).

의미 F1 (11-14 추가, Matcher)
  글로스 a, b를 "맞음"으로 치는 규칙. 아래 중 하나면 같다고 본다.
    1. 이름이 같다
    2. 글로스 표에서 같은 동작 단위로 간다 (resolve 기본값이 같고, 둘 다 None이 아님)
    3. 동의어 표(우리말샘 비슷한말, synonyms_v1.json의 by_gloss)에서 a의 목록에 b가 있거나 b의 목록에 a가 있다.
       한 단계만 본다(a~b, b~c라도 a~c로 치지 않는다). 목록의 낱말은 clean_word로 어깨번호를 뗀 것.
  TP는 이 관계로 예측 · 정답 글로스를 하나씩 짝지은 최대 개수(이분 매칭), WER은 이 관계면 대치 비용 0.
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


class Matcher:
    """의미 F1의 "같은 글로스" 판정 (모듈 설명의 규칙 1~3).
    units: {글로스 이름: 동작 단위}, synonyms: {글로스 이름: [비슷한 말, ...]} (by_gloss)."""

    def __init__(self, units=None, synonyms=None):
        self.units = dict(units or {})
        self.syn = {g: set(ws) for g, ws in (synonyms or {}).items()}

    def same(self, a, b):
        if a == b:
            return True
        ua, ub = self.units.get(a), self.units.get(b)
        if ua is not None and ua == ub:
            return True
        return b in self.syn.get(a, ()) or a in self.syn.get(b, ())


def _same(matcher, a, b):
    return a == b if matcher is None else matcher.same(a, b)


def overlap(pred, ref, matcher=None):
    if matcher is None:
        a, b = collections.Counter(pred), collections.Counter(ref)
        return sum(min(c, b[g]) for g, c in a.items())
    # 이분 매칭 (Kuhn). 문장이 짧아(≤ 10) 충분히 빠르다
    match_r = [-1] * len(ref)

    def try_assign(i, seen):
        for j, r in enumerate(ref):
            if j in seen or not matcher.same(pred[i], r):
                continue
            seen.add(j)
            if match_r[j] < 0 or try_assign(match_r[j], seen):
                match_r[j] = i
                return True
        return False

    return sum(try_assign(i, set()) for i in range(len(pred)))


def edit_distance(a, b, matcher=None):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (not _same(matcher, x, y)))
        prev = cur
    return prev[-1]


def _best_ref(pred, refs, matcher=None):
    best = None
    for r in refs:
        tp = overlap(pred, r, matcher)
        f = 2 * tp / (len(pred) + len(r)) if (len(pred) + len(r)) else 1.0
        key = (f, -edit_distance(pred, r, matcher))
        if best is None or key > best[0]:
            best = (key, r)
    return best[1]


def sentence_stats(pred, refs, matcher=None):
    """한 문장: refs는 정답 열 하나(list[str]) 또는 여럿(list[list[str]]). matcher가 있으면 의미 F1."""
    pred = normalize(pred)
    if refs and isinstance(refs[0], str):
        refs = [refs]
    refs = [normalize(r) for r in refs] or [[]]
    ref = _best_ref(pred, refs, matcher)
    edits = edit_distance(pred, ref, matcher)
    return {"tp": overlap(pred, ref, matcher), "n_pred": len(pred), "n_ref": len(ref),
            "edits": edits, "exact": edits == 0 and len(pred) == len(ref)}


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


def score(preds, refs_list, matcher=None):
    return aggregate([sentence_stats(p, r, matcher) for p, r in zip(preds, refs_list)])


def human_baseline(groups, matcher=None):
    """사람 번역끼리 leave-one-out. groups: [[번역 열, ...]] (같은 한국어 문장의 서로 다른 번역, 2개 이상).
    돌려주는 것: {"single": 남은 번역 각각과 1:1 (기존 F1), "multi": 남은 번역 중 가장 가까운 것 (여러 정답),
                  "semantic": multi + matcher (의미)}."""
    single, multi, sem = [], [], []
    for g in groups:
        g = [list(x) for x in g]
        if len(g) < 2:
            continue
        for k, pred in enumerate(g):
            rest = g[:k] + g[k + 1:]
            single.extend(sentence_stats(pred, r) for r in rest)
            multi.append(sentence_stats(pred, rest))
            if matcher is not None:
                sem.append(sentence_stats(pred, rest, matcher))
    out = {"single": aggregate(single), "multi": aggregate(multi)}
    if matcher is not None:
        out["semantic"] = aggregate(sem)
    out["groups"] = sum(1 for g in groups if len(g) >= 2)
    return out


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
