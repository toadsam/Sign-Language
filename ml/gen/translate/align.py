"""정렬과 구 대응표.

1. IBM 모델 1 (EM): P(목표 낱말 | 원문 낱말), 원문 쪽에 NULL을 둔다. 양방향으로 따로 배운다.
2. 문장마다 각 방향의 최선 정렬 → grow-diag-final-and로 합친다.
3. 합친 정렬과 어긋나지 않는 구 쌍(원문 ≤ max_src, 글로스 ≤ max_tgt)을 센다.
   원문 구가 아무 글로스에도 정렬되지 않으면 "생략"(빈 글로스 열) 후보로 센다.
4. 원문 구마다 많이 나온 후보 top_k개를 남기고 P(글로스|원문), P(원문|글로스)를 상대 빈도로 낸다.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import collections
import math

NULL = None


def train_ibm1(pairs, iters=10):
    """pairs: [(src 낱말 열, tgt 낱말 열)]. 돌려주는 t[(s, g)] = P(g | s), s는 NULL 포함."""
    tgt_vocab = {g for _, tgt in pairs for g in tgt}
    if not tgt_vocab:
        return {}
    uniform = 1.0 / len(tgt_vocab)
    t = collections.defaultdict(lambda: uniform)
    for _ in range(iters):
        count = collections.defaultdict(float)
        total = collections.defaultdict(float)
        for src, tgt in pairs:
            srcn = [NULL] + list(src)
            for g in tgt:
                z = sum(t[(s, g)] for s in srcn)
                for s in srcn:
                    c = t[(s, g)] / z
                    count[(s, g)] += c
                    total[s] += c
        t = collections.defaultdict(float, {k: v / total[k[0]] for k, v in count.items()})
    return dict(t)


def viterbi_align(t, src, tgt):
    """목표 낱말마다 가장 그럴듯한 원문 위치 (NULL이면 빠짐). 돌려주는 것: {(i_src, j_tgt)}."""
    links = set()
    for j, g in enumerate(tgt):
        best, best_i = t.get((NULL, g), 0.0), None
        for i, s in enumerate(src):
            p = t.get((s, g), 0.0)
            if p >= best and p > 0:  # 같으면 NULL보다 낱말
                best, best_i = p, i
        if best_i is not None:
            links.add((best_i, j))
    return links


def grow_diag_final_and(fwd, bwd, n_src, n_tgt):
    """fwd, bwd: {(i, j)} 두 방향 정렬. 교집합에서 시작해 이웃을 붙이고, 남은 것은 양쪽 다 빈 칸만."""
    union = fwd | bwd
    a = set(fwd & bwd)
    neighbors = [(-1, 0), (0, -1), (1, 0), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

    def src_free(i):
        return all(x != i for x, _ in a)

    def tgt_free(j):
        return all(y != j for _, y in a)

    added = True
    while added:
        added = False
        for i, j in sorted(a):
            for di, dj in neighbors:
                p = (i + di, j + dj)
                if p in union and p not in a and (src_free(p[0]) or tgt_free(p[1])):
                    a.add(p)
                    added = True
    for d in (fwd, bwd):
        for i, j in sorted(d):
            if src_free(i) and tgt_free(j):
                a.add((i, j))
    return a


def force_links(links, forced):
    """규칙으로 확실한 링크(forced)를 넣고, 그 원문 · 글로스 위치에 걸린 다른 링크는 뺀다."""
    if not forced:
        return links
    fs = {i for i, _ in forced}
    ft = {j for _, j in forced}
    return {(i, j) for i, j in links if i not in fs and j not in ft} | set(forced)


def symmetric_alignments(pairs, iters=10, anchor=None):
    """anchor(src_word, tgt_word) -> bool: 규칙상 확실히 같은 낱말(예: 글로스 이름 = 원형)이면 True.
    그런 쌍은 EM 결과와 상관없이 정렬에 넣는다. 작은 자료에서 NULL·부호로 쏠리는 것을 막는다."""
    t_fwd = train_ibm1(pairs, iters)                       # P(gloss | src)
    t_bwd = train_ibm1([(g, s) for s, g in pairs], iters)  # P(src | gloss)
    out = []
    for src, tgt in pairs:
        fwd = viterbi_align(t_fwd, src, tgt)
        bwd = {(i, j) for j, i in viterbi_align(t_bwd, tgt, src)}
        links = grow_diag_final_and(fwd, bwd, len(src), len(tgt))
        if anchor is not None:
            forced, used_t = set(), set()
            for i, s in enumerate(src):
                for j, g in enumerate(tgt):
                    if j not in used_t and anchor(s, g):
                        forced.add((i, j))
                        used_t.add(j)
                        break
            links = force_links(links, forced)
        out.append(links)
    return out, t_fwd, t_bwd


def extract_phrases(src, tgt, links, max_src=3, max_tgt=4):
    """정렬과 어긋나지 않는 구 쌍. 원문 구가 전부 정렬 밖이면 생략 () 후보."""
    out = []
    n, m = len(src), len(tgt)
    for i1 in range(n):
        for i2 in range(i1, min(n, i1 + max_src)):
            js = [j for i, j in links if i1 <= i <= i2]
            if not js:
                out.append((tuple(src[i1 : i2 + 1]), ()))
                continue
            j1, j2 = min(js), max(js)
            if j2 - j1 + 1 > max_tgt:
                continue
            if any(not (i1 <= i <= i2) for i, j in links if j1 <= j <= j2):
                continue
            # 정렬 안 된 글로스로 양옆 넓히기
            aligned_t = {j for _, j in links}
            lo = j1
            while True:
                hi = j2
                while True:
                    out.append((tuple(src[i1 : i2 + 1]), tuple(tgt[lo : hi + 1])))
                    hi += 1
                    if hi >= m or hi in aligned_t or hi - lo + 1 > max_tgt:
                        break
                lo -= 1
                if lo < 0 or lo in aligned_t or j2 - lo + 1 > max_tgt:
                    break
    return out


def build_phrase_table(pairs, alignments, max_src=3, max_tgt=4, top_k=8):
    """{원문 구(tuple): [(글로스 구(tuple), log P(g|s), log P(s|g), 횟수), ...]}"""
    c_pair = collections.Counter()
    for (src, tgt), links in zip(pairs, alignments):
        for sp, tp in extract_phrases(src, tgt, links, max_src, max_tgt):
            c_pair[(sp, tp)] += 1
    c_src, c_tgt = collections.Counter(), collections.Counter()
    for (sp, tp), c in c_pair.items():
        c_src[sp] += c
        c_tgt[tp] += c
    table = collections.defaultdict(list)
    for (sp, tp), c in c_pair.items():
        table[sp].append((tp, math.log(c / c_src[sp]), math.log(c / c_tgt[tp]), c))
    for sp in table:
        table[sp].sort(key=lambda x: (-x[3], x[0]))
        del table[sp][top_k:]
    return dict(table)
