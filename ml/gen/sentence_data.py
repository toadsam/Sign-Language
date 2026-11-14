"""문장 GPT(P3) 학습 데이터: 토큰마다 조건(지금 단위 / 연결 + 앞뒤 단위 / 휴지)을 붙인다.

설계 참고: sign-motion-gloss (코드 복사 없음)

토큰 i는 프레임 [s + down*i, s + down*(i+1))을 덮는다(s = 토큰 파일의 frames[0]).
문장 클립의 구간(meta segments의 f0, f1, 끝 포함)과 비교해 가장 많이 겹치는 쪽의 조건을 받는다.

  단어 구간    cur = S:<이름>                 prev/next = <none>
  단어 사이    cur = <conn>                  prev/next = 앞 · 뒤 단위
  앞 휴지      cur = <pause>                 next = 첫 단위
  뒤 휴지      cur = <pause>                 prev = 마지막 단위
  단어 클립    cur = W:<WORD ID> (토큰 전부)   prev/next = <none>

phase = (그 구역 안에서 몇 번째 토큰인가, 구역 끝까지 남은 토큰 수). 생성 때는 일정표에서 같은 값을 만든다.

나누기 (SENTENCE_AGENTS_20261114 규칙)
  학습  = 학습 화자 + (SEN이면) heldout 문장 · sen_val_v1 문장이 아닌 것
  검증  = 학습 화자 + sen_val_v1 문장 (모델 고르기)
  시험  = 학습 화자 + heldout 문장 (평가 A),  test_signer = 시험 화자 + heldout 문장 (참고)
`check_no_leak`가 학습 몫에 시험·검증 문장이 섞였는지 검사한다.

torch 없이 import 된다.
"""
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics

NULL, NONE, CONN, PAUSE = "<null>", "<none>", "<conn>", "<pause>"
SPECIAL = (NULL, NONE, CONN, PAUSE)
MAX_PHASE = 32


class SentenceDataError(ValueError):
    pass


def sen_unit(name):
    return f"S:{name}"


def word_unit(item):
    return f"W:{item}"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def read_jsonl(path):
    with open(path, encoding="utf-8-sig") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def sha256_path(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0))


def regions_of(segments, total):
    """문장 구간 → 구역 목록 [(kind, unit, prev, next, f0, f1_exclusive)] (시간 순서).

    segments: [(unit, f0, f1_inclusive)]. 연결 구역은 길이가 0 이하이면 만들지 않는다."""
    out = []
    if not segments:
        return out
    first, last = segments[0], segments[-1]
    if first[1] > 0:
        out.append(("pause", PAUSE, NONE, first[0], 0, first[1]))
    for k, (unit, f0, f1) in enumerate(segments):
        out.append(("word", unit, NONE, NONE, f0, f1 + 1))
        if k + 1 < len(segments):
            nxt = segments[k + 1]
            if nxt[1] > f1 + 1:
                out.append(("conn", CONN, unit, nxt[0], f1 + 1, nxt[1]))
    if last[2] + 1 < total:
        out.append(("pause", PAUSE, last[0], NONE, last[2] + 1, total))
    return out


def label_tokens(n_tokens, start, down, regions):
    """토큰마다 구역 번호. 가장 많이 겹치는 구역, 같으면 단어 구역, 그다음 앞 구역.
    토큰을 하나도 못 받은 단어 구역에는 가장 많이 겹치는 토큰을 준다(단어가 사라지지 않게)."""
    if not regions:
        raise SentenceDataError("no_regions")
    labels = []
    for i in range(n_tokens):
        t0, t1 = start + down * i, start + down * (i + 1)
        best, key = None, None
        for r, reg in enumerate(regions):
            ov = _overlap(t0, t1, reg[4], reg[5])
            k = (ov, reg[0] == "word", -r)
            if key is None or k > key:
                best, key = r, k
        if key[0] == 0:  # 어느 구역과도 안 겹침(토큰 열이 클립보다 길 때): 가장 가까운 구역
            best = min(range(len(regions)), key=lambda r: min(abs(t0 - regions[r][5]), abs(t1 - regions[r][4])))
        labels.append(best)
    for r, reg in enumerate(regions):
        if reg[0] != "word" or r in labels:
            continue
        overlaps = [_overlap(start + down * i, start + down * (i + 1), reg[4], reg[5]) for i in range(n_tokens)]
        i = max(range(n_tokens), key=lambda j: overlaps[j])
        if overlaps[i] > 0:
            labels[i] = r
    return labels


def phases(labels):
    """같은 구역이 이어지는 묶음 안에서 (앞에서 몇 번째, 끝까지 남은 수), MAX_PHASE-1로 자른다."""
    out, n = [], len(labels)
    i = 0
    while i < n:
        j = i
        while j < n and labels[j] == labels[i]:
            j += 1
        for k in range(i, j):
            out.append((min(k - i, MAX_PHASE - 1), min(j - 1 - k, MAX_PHASE - 1)))
        i = j
    return out


def condition_rows(n_tokens, start, down, regions):
    """→ cond [(cur, prev, next)], phase [(a, b)], spans [(unit, t0, t1)] (단어 구역만, 토큰 번호, 끝 제외)."""
    labels = label_tokens(n_tokens, start, down, regions)
    cond = [regions[r][1:4] for r in labels]
    spans = []
    i = 0
    while i < n_tokens:
        j = i
        while j < n_tokens and labels[j] == labels[i]:
            j += 1
        if regions[labels[i]][0] == "word":
            spans.append((regions[labels[i]][1], i, j))
        i = j
    return cond, phases(labels), spans


def word_row(clip, token):
    n = len(token["tokens"])
    unit = word_unit(token["item"])
    return {"clip": clip, "type": "WORD", "item": token["item"], "signer": token["signer"],
            "tokens": list(token["tokens"]), "frames": list(token["frames"]),
            "cond": [(unit, NONE, NONE)] * n, "phase": phases([0] * n), "spans": [(unit, 0, n)],
            "segments": []}


def sentence_row(clip, token, meta, down):
    segs = [(sen_unit(s["name"]), int(s["f0"]), int(s["f1"])) for s in meta["segments"]]
    total = int(meta["frames"])
    regions = regions_of(segs, total)
    cond, phase, spans = condition_rows(len(token["tokens"]), token["frames"][0], down, regions)
    return {"clip": clip, "type": "SEN", "item": token["item"], "signer": token["signer"],
            "tokens": list(token["tokens"]), "frames": list(token["frames"]), "cond": cond,
            "phase": phase, "spans": spans, "segments": segs, "total_frames": total,
            "gloss": [s["name"] for s in meta["segments"]]}


def heldout_sets(split, sen_val):
    h = split.get("heldout_sentences", {})
    test_items = set(h.get("items", [])) | set(h.get("question_items", []))
    test_seqs = {tuple(s) for s in h.get("sequences", [])}
    val_items = set(sen_val.get("items", []))
    if test_items & val_items:
        raise SentenceDataError("sen_val overlaps heldout items")
    return test_items, test_seqs, val_items


def _quality_ok(meta, excluded):
    ratio = meta.get("dur_ratio")
    return (meta.get("label") == "ok" and meta["clip"] not in excluded
            and type(ratio) in (int, float) and math.isfinite(ratio) and 0.85 <= ratio < 1.5)


def select(tokens, metas, split, sen_val, *, use_words=True):
    """tokens: 토큰 파일 dict, metas: {clip: meta}, split: full_sen.json dict, sen_val: sen_val_v1 dict.

    → {"train": [...], "val": [...], "test": [...], "test_signer": [...], "counts": {...}, "dropped": {...}}"""
    down = int(tokens["down"])
    signers = split["signers"]
    train_signers, test_signers = set(signers["train"]), set(signers["test"])
    excluded = set(split.get("exclude", {}).get("clips", []))
    test_items, test_seqs, val_items = heldout_sets(split, sen_val)
    # sen_val 문장과 글로스 열이 같은 문장도 학습에서 뺀다(같은 문장의 다른 번호).
    val_seqs = set()
    for clip, meta in metas.items():
        if meta.get("type") == "SEN" and meta.get("item") in val_items and meta.get("segments"):
            val_seqs.add(tuple(s["name"] for s in meta["segments"]))
    out = {"train": [], "val": [], "test": [], "test_signer": []}
    dropped = Counter()
    for clip in sorted(tokens["clips"]):
        token = tokens["clips"][clip]
        meta = metas.get(clip)
        if meta is None:
            dropped["no_meta"] += 1
            continue
        if not _quality_ok(meta, excluded):
            dropped["quality"] += 1
            continue
        if len(token["tokens"]) * down != token["frames"][1] - token["frames"][0]:
            raise SentenceDataError(f"token/frame mismatch: {clip}")
        signer = token["signer"]
        if token["type"] == "WORD":
            if use_words and signer in train_signers:
                out["train"].append(word_row(clip, token))
            continue
        if not meta.get("segments"):
            dropped["no_segments"] += 1
            continue
        seq = tuple(s["name"] for s in meta["segments"])
        is_test = token["item"] in test_items or seq in test_seqs
        is_val = token["item"] in val_items or seq in val_seqs
        if is_test and is_val:
            raise SentenceDataError(f"clip in both heldout and sen_val: {clip}")
        if signer in train_signers:
            bucket = "test" if is_test else "val" if is_val else "train"
        elif signer in test_signers and is_test:
            bucket = "test_signer"
        else:
            continue
        out[bucket].append(sentence_row(clip, token, meta, down))
    check_no_leak(out["train"], split, sen_val, val_seqs=val_seqs)
    counts = {k: {"clips": len(v), "SEN": sum(r["type"] == "SEN" for r in v),
                  "WORD": sum(r["type"] == "WORD" for r in v),
                  "signers": len({r["signer"] for r in v})} for k, v in out.items()}
    return {**out, "counts": counts, "dropped": dict(dropped), "down": down,
            "nb_code": int(tokens["nb_code"]), "train_signers": sorted(train_signers)}


def check_no_leak(train_rows, split, sen_val, val_seqs=()):
    """학습 몫에 heldout · sen_val 문장이나 학습 화자 밖의 클립이 있으면 SentenceDataError."""
    test_items, test_seqs, val_items = heldout_sets(split, sen_val)
    train_signers = set(split["signers"]["train"])
    val_seqs = set(val_seqs)
    for r in train_rows:
        if r["signer"] not in train_signers:
            raise SentenceDataError(f"leak: non-train signer {r['clip']}")
        if r["type"] != "SEN":
            continue
        seq = tuple(r["gloss"])
        if r["item"] in test_items or seq in test_seqs:
            raise SentenceDataError(f"leak: heldout sentence {r['clip']}")
        if r["item"] in val_items or seq in val_seqs:
            raise SentenceDataError(f"leak: sen_val sentence {r['clip']}")
    return True


def build_vocab(train_rows, signers):
    """단위 사전(특수 4개 + 학습 몫 단위 이름순), 화자 사전, 연결 앞뒤로 쓰인 단위 목록."""
    units = sorted({c[0] for r in train_rows for c in r["cond"]} - set(SPECIAL))
    vocab = {s: i for i, s in enumerate(SPECIAL)}
    vocab.update({u: i + len(SPECIAL) for i, u in enumerate(units)})
    context = sorted({u for r in train_rows for c in r["cond"] for u in c[1:]} - set(SPECIAL))
    return vocab, {s: i for i, s in enumerate(sorted(signers))}, context


def schedule_stats(train_rows):
    """일정표용 중앙값(토큰 수): 단위별 길이, 연결, 앞 · 뒤 휴지."""
    unit_lengths = defaultdict(list)
    conn, lead, tail, gaps = [], [], [], []
    for r in train_rows:
        for unit, t0, t1 in r["spans"]:
            unit_lengths[unit].append(t1 - t0)
        if r["type"] != "SEN":
            continue
        spans = r["spans"]
        lead.append(spans[0][1])
        tail.append(len(r["tokens"]) - spans[-1][2])
        for a, b in zip(spans, spans[1:]):
            conn.append(b[1] - a[2])
        segs = r["segments"]
        for a, b in zip(segs, segs[1:]):
            gaps.append(b[1] - a[2] - 1)
    med = lambda xs: int(round(statistics.median(xs))) if xs else 0
    return {"unit_tokens": {u: max(1, med(v)) for u, v in sorted(unit_lengths.items())},
            "unit_count": {u: len(v) for u, v in sorted(unit_lengths.items())},
            "conn_tokens": med(conn), "lead_tokens": med(lead), "tail_tokens": med(tail),
            "conn_frames": med(gaps), "sentences": sum(r["type"] == "SEN" for r in train_rows)}


def make_schedule(units, stats, *, unit_tokens=None, pauses=True):
    """단위 열 → (cond [(cur, prev, next)], phase, spans [(unit, t0, t1)]) 생성용 일정표.

    unit_tokens: {unit: 길이}로 중앙값 대신 쓸 길이(평가에서 실제 길이를 줄 때). 연결 길이가 0이면 연결 없음."""
    if not units:
        raise SentenceDataError("empty units")
    lengths = unit_tokens or {}
    labels, regions = [], []

    def add(kind, cur, prev, nxt, n):
        if n <= 0:
            return
        regions.append((kind, cur, prev, nxt))
        labels.extend([len(regions) - 1] * n)

    if pauses:
        add("pause", PAUSE, NONE, units[0], stats["lead_tokens"])
    for k, unit in enumerate(units):
        n = lengths.get(unit) or stats["unit_tokens"].get(unit)
        if not n:
            raise SentenceDataError(f"unit without length: {unit}")
        add("word", unit, NONE, NONE, n)
        if k + 1 < len(units):
            add("conn", CONN, unit, units[k + 1], stats["conn_tokens"])
    if pauses:
        add("pause", PAUSE, units[-1], NONE, stats["tail_tokens"])
    cond = [regions[r][1:4] for r in labels]
    spans, i = [], 0
    while i < len(labels):
        j = i
        while j < len(labels) and labels[j] == labels[i]:
            j += 1
        if regions[labels[i]][0] == "word":
            spans.append((regions[labels[i]][1], i, j))
        i = j
    return cond, phases(labels), spans


def encode_condition(cond, vocab, context=None):
    """조건 문자열 → id 셋. 연결 앞뒤로 학습된 적 없는 단위는 <none>으로 바꾼다."""
    ctx = set(context) if context is not None else None
    none = vocab[NONE]

    def side(u):
        if u in SPECIAL:
            return vocab[u]
        if ctx is not None and u not in ctx:
            return none
        return vocab.get(u, none)

    cur = [vocab[c[0]] for c in cond]
    return cur, [side(c[1]) for c in cond], [side(c[2]) for c in cond]


def load_inputs(tokens_path, meta_path, split_path, sen_val_path):
    tokens = read_json(tokens_path)
    metas = {m["clip"]: m for m in read_jsonl(meta_path)}
    split, sen_val = read_json(split_path), read_json(sen_val_path)
    sources = {"tokens_sha256": sha256_path(tokens_path), "meta_sha256": sha256_path(meta_path),
               "split_sha256": sha256_path(split_path), "sen_val_sha256": sha256_path(sen_val_path)}
    return tokens, metas, split, sen_val, sources
