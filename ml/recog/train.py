"""읽는 모델(단어 인식) 학습.

정식 데이터 (수행자 단위 분할, 처음 보는 사람으로 평가):
  python -m recog.train --data data/full --run runs/recog --types WORD --test-signers 2

샘플 (수행자 1명이라 분할 불가 → 코드 동작 확인용):
  python -m recog.train --data data/sample --run runs/recog_sample --iters 800 --smoke
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from common.data import load_data
from recog.features import augment, joint_index, prepare
from recog.model import SignRecognizer
from recog.splits import partition


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
    was_training = model.training
    model.eval()
    hits1, hits5 = 0, 0
    device = next(model.parameters()).device
    for start in range(0, len(x), 128):
        _, idx = model.topk(x[start:start+128].to(device), k)
        labels = y[start:start+128].to(device)
        hits1 += int((idx[:, 0] == labels).sum())
        hits5 += int((idx == labels[:, None]).any(1).sum())
    model.train(was_training)
    return hits1 / len(x), hits5 / len(x)


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
    ap.add_argument("--device", default="cpu", help="cpu, cuda 또는 mps")
    ap.add_argument("--smoke", action="store_true", help="샘플 동작 확인 전용. 처음 보는 표현자 점수로 보고하지 않음")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)

    metas = load_data(args.data, set(args.types.split(",")))
    train, val, test, sp = partition(metas, args.data, args.test_signers, args.seed, args.smoke)
    if args.iters < 1 or args.batch < 1 or args.eval_every < 1 or args.length < 4 or args.max_classes < 0:
        raise ValueError("iters/batch/eval-every는 양수, length는 4 이상, max-classes는 0 이상이어야 합니다.")

    # 단어별 학습 수행자 수로 거르고, 수행자가 많은 단어부터 max-classes개
    count = {}
    for m in train:
        count.setdefault(m["item"], set()).add(m["signer"])
    items = sorted((it for it, s in count.items() if len(s) >= args.min_signers), key=lambda it: (-len(count[it]), it))
    if args.max_classes:
        items = items[: args.max_classes]
    classes = {it: i for i, it in enumerate(sorted(items))}
    if not classes:
        raise ValueError("조건에 맞는 학습 단어가 없습니다.")
    print(f"단어 {len(classes)}개 · 학습 클립 {sum(m['item'] in classes for m in train)}개 · "
          f"평가 클립 {sum(m['item'] in classes for m in test)}개 · 수행자 학습 {len({m['signer'] for m in train})}명 / 평가 {len({m['signer'] for m in test})}명")

    joints = joint_index(args.with_face)
    train = [m for m in train if m["item"] in classes]
    val = [m for m in val if m["item"] in classes]
    excluded_test = sum(m["item"] not in classes for m in test)
    test = [m for m in test if m["item"] in classes]
    if not args.smoke and not test:
        raise ValueError("학습에 포함된 단어의 test 클립이 없습니다.")
    x_clean, y_clean = build(train, joints, args.length, classes)
    x_aug, y_aug = build(train, joints, args.length, classes, np.random.default_rng(12345))
    x_test, y_test = build(test, joints, args.length, classes) if test else (None, None)
    x_val, y_val = build(val, joints, args.length, classes) if val else (None, None)

    model = SignRecognizer(x_clean.shape[-1], len(classes)).to(args.device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.iters)
    print(f"입력 {x_clean.shape[-1]}차원 × {args.length}프레임, 파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")

    log = open(os.path.join(args.run, "log.jsonl"), "w", encoding="utf-8")
    t0, best = time.time(), None
    for it in range(1, args.iters + 1):
        pick = rng.integers(len(train), size=args.batch)
        xb, yb = build([train[i] for i in pick], joints, args.length, classes, rng)
        loss = F.cross_entropy(model(xb.to(args.device)), yb.to(args.device), label_smoothing=0.1)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if it % args.eval_every == 0 or it == args.iters:
            r = {"iter": it, "loss": round(loss.item(), 4),
                 "train_top1": accuracy(model, x_clean, y_clean)[0],
                 "train_aug_top1": accuracy(model, x_aug, y_aug)[0]}
            if x_val is not None:
                r["val_top1"], r["val_top5"] = accuracy(model, x_val, y_val)
            print(" ".join(f"{k} {v:.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in r.items())
                  + f"  ({time.time() - t0:.0f}s)")
            log.write(json.dumps(r) + "\n")
            log.flush()
            key = r.get("val_top1", r["train_aug_top1"])
            if best is None or key >= best[0]:
                best = (key, r)
                torch.save({"model": model.state_dict(), "classes": classes, "in_dim": x_clean.shape[-1],
                            "with_face": args.with_face, "length": args.length, "config": vars(args), "split": sp},
                           os.path.join(args.run, "model.pt"))

    log.close()
    ck = torch.load(os.path.join(args.run, "model.pt"), map_location="cpu", weights_only=True)
    model.load_state_dict(ck["model"])
    summary = {"best": best[1], "classes": len(classes), "minutes": round((time.time() - t0) / 60, 1),
               "split": sp, "config": vars(args), "excluded_test_clips": excluded_test, "test_clips": len(test),
               "selection": "val_top1" if val else "train_aug_top1",
               "evaluated_on_unseen_signers": x_test is not None}
    if x_test is not None:
        summary["test_top1"], summary["test_top5"] = accuracy(model, x_test, y_test)
    json.dump(summary, open(os.path.join(args.run, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
