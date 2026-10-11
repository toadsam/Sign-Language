"""고정 분할표 만들기: 수행자를 train / val / test로 한 번 나눠 ml/splits/<데이터 폴더 이름>.json 에 저장한다.

자모표 · 받아쓰기 · 읽는 모델이 모두 이 파일을 읽어 같은 test 수행자로 평가한다. 그래야 비교표의 숫자가 서로 맞는다.
만든 파일은 git에 커밋한다 (수행자 번호와 단어 번호만 들어 있고 동작 데이터는 없다).

  python -m prep.make_split --data data/full --val-signers 4 --test-signers 4
  python -m prep.make_split --data data/sample            # 수행자 1명 → 단어 단위(마지막 4단어가 test)

이미 있는 분할표는 덮어쓰지 않는다. 실험을 시작한 뒤 분할이 바뀌면 이전 결과와 비교할 수 없기 때문이다.
정말 다시 나눠야 하면 --force 를 붙이고 팀에 알린다.
"""
import argparse
import datetime
import json
import os

import numpy as np

from common.data import SPLIT_DIR, apply_split, split_path


def read_meta(data_dir):
    return [json.loads(l) for l in open(os.path.join(data_dir, "meta.jsonl"), encoding="utf-8")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--val-signers", type=int, default=4)
    ap.add_argument("--test-signers", type=int, default=4)
    ap.add_argument("--holdout", type=int, default=4, help="수행자가 부족할 때 test로 뺄 단어 수")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--force", action="store_true", help="이미 있는 분할표를 덮어쓴다")
    args = ap.parse_args()

    out = split_path(args.data)
    if os.path.exists(out) and not args.force:
        raise SystemExit(f"{out} 가 이미 있습니다. 실험 중에 분할을 바꾸면 이전 결과와 비교할 수 없습니다. "
                         f"정말 다시 나누려면 --force 를 붙이고 팀에 알리세요.")

    metas = read_meta(args.data)  # 동작 배열은 필요 없으니 meta만 읽는다
    signers = sorted({m["signer"] for m in metas})
    sp = {"name": os.path.basename(os.path.normpath(args.data)), "created": datetime.date.today().isoformat(),
          "seed": args.seed, "clips": len(metas)}
    if len(signers) > args.val_signers + args.test_signers:
        perm = np.random.default_rng(args.seed).permutation(signers).tolist()
        test, val = sorted(perm[:args.test_signers]), sorted(perm[args.test_signers:args.test_signers + args.val_signers])
        train = sorted(set(signers) - set(test) - set(val))
        sp.update(mode="signer", signers={"train": train, "val": val, "test": test})
    else:
        items = sorted({m["item"] for m in metas})
        print(f"수행자가 {len(signers)}명뿐이라 수행자 분할을 할 수 없어 단어 단위로 나눕니다 (마지막 {args.holdout}단어가 test).")
        sp.update(mode="item", signers={"train": signers, "val": [], "test": []}, test_items=items[-args.holdout:])

    train, val, test = apply_split([{**m} for m in metas], sp)
    sp["counts"] = {"train": len(train), "val": len(val), "test": len(test)}
    # 단어 인식 · 생성은 test 단어가 학습에도 나와야 평가할 수 있다. 수행자 분할에서 학습에 없는 test 단어를 센다
    train_items = {m["item"] for m in train}
    sp["test_items_unseen"] = sorted({m["item"] for m in test} - train_items) if sp["mode"] == "signer" else sp["test_items"]

    os.makedirs(SPLIT_DIR, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(sp, fh, ensure_ascii=False, indent=2)
    print(f"분할표: {out}")
    print(f"  방식 {sp['mode']} · 수행자 학습 {len(sp['signers']['train'])} / 검증 {len(sp['signers']['val'])} / 평가 {len(sp['signers']['test'])}명")
    print(f"  클립 학습 {len(train)} · 검증 {len(val)} · 평가 {len(test)}")
    if sp["mode"] == "signer":
        print(f"  평가 수행자: {', '.join(sp['signers']['test'])}")
        print(f"  학습에 없는 평가 단어: {len(sp['test_items_unseen'])}개")


if __name__ == "__main__":
    main()
