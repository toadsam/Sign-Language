"""읽는 모델(단어 인식) 학습.

정식 데이터 (수행자 단위 분할, 처음 보는 사람으로 평가):
  python -m recog.train --data data/full --run runs/recog --types WORD --test-signers 2

샘플 (수행자 1명이라 분할 불가 → 코드 동작 확인용):
  python -m recog.train --data data/sample --run runs/recog_sample --iters 800
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from common.data import load_data, split_by_signer
from recog.features import augment, joint_index, prepare
from recog.model import SignRecognizer


def build(clips, joints, length, classes, rng=None):
    xs, ys = [], []
    for m in clips:
        if m["item"] not in classes:
            continue
        x, act = (augment(m["x"], m["active"], rng) if rng is not None else (m["x"], m["active"]))
        xs.append(prepare(x, act, joints, length))
        ys.append(classes[m["item"]])
    return torch.from_numpy(np.stack(xs)), torch.tensor(ys)


@torch.no_grad()
def accuracy(model, x, y, k=5):
    model.eval()
    _, idx = model.topk(x, k)
    model.train()
    return float((idx[:, 0] == y).float().mean()), float((idx == y[:, None]).any(1).float().mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--types", default="WORD", help="쉼표로 구분 (예: WORD,SEN)")
    ap.add_argument("--test-signers", type=int, default=2)
    ap.add_argument("--min-signers", type=int, default=1, help="학습 수행자가 이 수 미만인 단어는 제외")
    ap.add_argument("--max-classes", type=int, default=0, help="0이면 전체. 처음엔 100으로 시작 권장")
    ap.add_argument("--length", type=int, default=64)
    ap.add_argument("--with-face", action="store_true")
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--eval-every", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)

    metas = load_data(args.data, set(args.types.split(",")))
    split = split_by_signer(metas, args.test_signers, args.seed)
    if split is None:
        train, test = metas, []
        print("수행자가 부족해 처음 보는 사람 평가를 할 수 없습니다. 학습 데이터와 그 변형본으로만 확인합니다 (코드 동작 확인용).")
    else:
        train, test = split

    # 단어별 학습 수행자 수로 거르고, 수행자가 많은 단어부터 max-classes개
    count = {}
    for m in train:
        count.setdefault(m["item"], set()).add(m["signer"])
    items = sorted((it for it, s in count.items() if len(s) >= args.min_signers), key=lambda it: (-len(count[it]), it))
    if args.max_classes:
        items = items[: args.max_classes]
    classes = {it: i for i, it in enumerate(sorted(items))}
    print(f"단어 {len(classes)}개 · 학습 클립 {sum(m['item'] in classes for m in train)}개 · "
          f"평가 클립 {sum(m['item'] in classes for m in test)}개 · 수행자 학습 {len({m['signer'] for m in train})}명 / 평가 {len({m['signer'] for m in test})}명")

    joints = joint_index(args.with_face)
    train = [m for m in train if m["item"] in classes]
    x_clean, y_clean = build(train, joints, args.length, classes)
    x_aug, y_aug = build(train, joints, args.length, classes, np.random.default_rng(12345))
    x_test, y_test = build(test, joints, args.length, classes) if test else (None, None)

    model = SignRecognizer(x_clean.shape[-1], len(classes))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.iters)
    print(f"입력 {x_clean.shape[-1]}차원 × {args.length}프레임, 파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")

    log = open(os.path.join(args.run, "log.jsonl"), "w", encoding="utf-8")
    t0, best = time.time(), None
    for it in range(1, args.iters + 1):
        pick = rng.integers(len(train), size=args.batch)
        xb, yb = build([train[i] for i in pick], joints, args.length, classes, rng)
        loss = F.cross_entropy(model(xb), yb, label_smoothing=0.1)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if it % args.eval_every == 0 or it == args.iters:
            r = {"iter": it, "loss": round(loss.item(), 4),
                 "train_top1": accuracy(model, x_clean, y_clean)[0],
                 "train_aug_top1": accuracy(model, x_aug, y_aug)[0]}
            if x_test is not None:
                r["test_top1"], r["test_top5"] = accuracy(model, x_test, y_test)
            print(" ".join(f"{k} {v:.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in r.items())
                  + f"  ({time.time() - t0:.0f}s)")
            log.write(json.dumps(r) + "\n")
            log.flush()
            key = r.get("test_top1", r["train_aug_top1"])
            if best is None or key >= best[0]:
                best = (key, r)
                torch.save({"model": model.state_dict(), "classes": classes, "in_dim": x_clean.shape[-1],
                            "with_face": args.with_face, "length": args.length, "config": vars(args)},
                           os.path.join(args.run, "model.pt"))

    summary = {"best": best[1], "classes": len(classes), "minutes": round((time.time() - t0) / 60, 1),
               "evaluated_on_unseen_signers": x_test is not None}
    json.dump(summary, open(os.path.join(args.run, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
