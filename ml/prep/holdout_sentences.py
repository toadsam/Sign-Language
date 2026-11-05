"""문장 받아쓰기 평가용 "새 조합" 문장을 떼어 분할표에 적는다 (실행 계획 WS5b 평가 문장 50개).

  python -m prep.holdout_sentences --data C:/aihub/full_sen --n 50 --also full_all

두 종류를 뗀다.
① 새 단어 열 (n개): 들어 있는 단어(형태소)는 모두 학습에 나오지만, 그 단어 열(순서)은 학습에 한 번도 없는 문장
  - SEN 2,000문장은 한국어가 달라도 수어 단어 열이 같은 경우가 많다(1,101종). 그래서 문장 번호가 아니라 단어 열로 뗀다
  - 같은 단어 묶음을 순서만 바꾼 열도 학습에 남지 않는 것만 고른다
  - 단어 1개짜리는 "조합"이 아니므로 2~6개만. 고른 뒤에도 각 단어가 남은 학습 단어 열에 2번 이상 나와야 한다
② 새 "단어 + 의문" 조합 (questions개): 의문문은 대부분 단어 1개("왼쪽?")라 ①에 들지 않는다.
  같은 단어 열의 평서문("왼쪽")은 학습에 남기고 의문문 문장만 뗀다 → 의문 표정(비수지)을 처음 보는 단어에 붙이는지 평가

분할표(splits/<data>.json)에 "heldout_sentences"로 적는다. apply_split은 이 목록을 쓰지 않는다.
문장 받아쓰기는 학습할 때 아래 중 하나라도 맞는 클립을 빼고, 평가는 test 사람(REAL03 · REAL12)의 그 클립으로 한다.
  gloss가 sequences에 있다 / item이 items에 있다 / item이 question_items에 있다
(같은 문장인데 수행자에 따라 라벨이 조금 다른 클립이 있어서 단어 열과 문장 번호를 둘 다 본다)
"""
import argparse
import collections
import datetime
import json
import os

import numpy as np

from common.data import load_split, split_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--questions", type=int, default=5)
    ap.add_argument("--min-len", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=6)
    ap.add_argument("--min-left", type=int, default=2, help="고른 뒤 남은 학습 단어 열에 각 단어가 나와야 하는 최소 횟수")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--also", nargs="*", default=[], help="같은 목록을 함께 적을 다른 분할표 이름 (예: full_all)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    sp = load_split(args.data)
    if sp is None:
        raise SystemExit("분할표가 없습니다. prep.make_split 먼저")
    if "heldout_sentences" in sp and not args.force:
        raise SystemExit("이미 heldout_sentences가 있습니다. 바꾸려면 --force (팀에 먼저 알릴 것)")
    excluded = set(sp.get("exclude", {}).get("clips", []))
    metas = [json.loads(l) for l in open(os.path.join(args.data, "meta.jsonl"), encoding="utf-8")]
    metas = [m for m in metas if m["type"] == "SEN" and m.get("label") == "ok" and m["clip"] not in excluded]

    # 문장 번호마다 다수결 단어 열 · 의문문 여부 (수행자마다 라벨이 조금 다른 문장이 있다)
    by_item = collections.defaultdict(list)
    for m in metas:
        by_item[m["item"]].append(m)
    seq_of = {it: collections.Counter(tuple(m["gloss"]) for m in ms).most_common(1)[0][0] for it, ms in by_item.items()}
    is_q = {it: sum(m["question"] for m in ms) > len(ms) / 2 for it, ms in by_item.items()}
    seqs = sorted({tuple(m["gloss"]) for m in metas})
    bag = lambda s: tuple(sorted(s))
    bags = collections.Counter(bag(s) for s in seqs)
    gloss_count = collections.Counter(g for s in seqs for g in s)  # 단어 열 종류 기준 등장 수
    rng = np.random.default_rng(args.seed)

    # ① 새 단어 열
    cands = [s for s in seqs if args.min_len <= len(s) <= args.max_len and bags[bag(s)] == 1]
    chosen = []
    for i in rng.permutation(len(cands)):
        if len(chosen) >= args.n:
            break
        s = cands[i]
        left = gloss_count.copy()
        for t in chosen + [s]:
            left.subtract(set(t))
        if all(left[g] >= args.min_left for t in chosen + [s] for g in t):
            chosen.append(s)
    if len(chosen) < args.n:
        print(f"조건을 만족하는 단어 열이 {len(chosen)}개뿐입니다")
    chosen_set = set(chosen)
    items = sorted(it for it, s in seq_of.items() if s in chosen_set)

    # ② 새 "단어 + 의문" 조합: 같은 단어 열의 평서문이 학습에 남는 의문문, 그 단어 열의 의문문이 하나뿐인 것
    q_by_seq = collections.Counter(seq_of[it] for it in seq_of if is_q[it])
    stmt_seqs = {seq_of[it] for it in seq_of if not is_q[it] and seq_of[it] not in chosen_set}
    q_cands = sorted(it for it in seq_of if is_q[it] and seq_of[it] in stmt_seqs and q_by_seq[seq_of[it]] == 1)
    q_items = sorted(q_cands[i] for i in rng.permutation(len(q_cands))[: args.questions])

    held = set(items) | set(q_items)
    held_clips = [m for m in metas if tuple(m["gloss"]) in chosen_set or m["item"] in held]
    sig = sp.get("signers", {})
    train_signers, test_signers = set(sig.get("train", [])), set(sig.get("test", []))
    train_bigrams = {b for s in seqs if s not in chosen_set for b in zip(s, s[1:])}
    new_bigrams = [sum(b not in train_bigrams for b in zip(s, s[1:])) / (len(s) - 1) for s in chosen]
    count = lambda ms, ss: sum(m["signer"] in ss for m in ms)
    q_clips = [m for m in held_clips if m["item"] in set(q_items)]
    out = {
        "created": datetime.date.today().isoformat(), "seed": args.seed,
        "note": (f"새 조합 평가 문장: ① 새 단어 열 {len(chosen)}개(sequences, 문장 번호 items) — 단어는 모두 학습에 "
                 f"{args.min_left}번 이상 나오고 같은 단어 묶음의 다른 순서도 학습에 없음. ② 새 '단어 + 의문' 조합 "
                 f"{len(q_items)}개(question_items) — 같은 단어 열의 평서문은 학습에 남김. 문장 받아쓰기는 gloss가 sequences에 "
                 "있거나 item이 items · question_items에 있는 클립을 학습에서 빼고, test 사람의 그 클립으로 평가한다. "
                 "자모표(VQ)는 동작만 배우므로 그대로 써도 된다."),
        "sequences": [list(s) for s in chosen],
        "items": items,
        "question_items": q_items,
        "clips": {"total": len(held_clips), "train_signers_removed": count(held_clips, train_signers),
                  "test_signers": count(held_clips, test_signers), "question_test": count(q_clips, test_signers)},
    }
    for name in [os.path.basename(os.path.normpath(args.data))] + args.also:
        p = os.path.join(os.path.dirname(split_path(args.data)), name + ".json")
        d = json.load(open(p, encoding="utf-8"))
        if "heldout_sentences" in d and not args.force:
            raise SystemExit(f"{p} 에 이미 있습니다 (--force)")
        d["heldout_sentences"] = out
        json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"저장: {p}")

    lens = collections.Counter(len(s) for s in chosen)
    print(f"① 새 단어 열 {len(chosen)}개 (후보 {len(cands)}개 중) · 문장 번호 {len(items)}개 · "
          f"단어 수 {sorted(lens.items())} · 처음 보는 단어 쌍 비율 평균 {np.mean(new_bigrams):.0%}")
    print(f"② 새 '단어 + 의문' {len(q_items)}개 (후보 {len(q_cands)}개 중): {q_items}")
    c = out["clips"]
    print(f"클립 {c['total']}개 → 학습 사람에서 빠짐 {c['train_signers_removed']} · 평가(test 사람) {c['test_signers']}"
          f" (그중 의문 {c['question_test']})")


if __name__ == "__main__":
    main()
