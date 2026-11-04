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


def atomic_save(value, path):
    """기록 중 중단돼도 마지막 완성 체크포인트는 보존한다."""
    temporary = str(path) + ".tmp"
    with open(temporary, "wb") as f:
        torch.save(value, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)


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
    ap.add_argument("--resume", action="store_true", help="같은 run/latest.pt에서 모델·optimizer·난수 상태를 이어서 학습")
    ap.add_argument("--save-every", type=int, default=2000, help="재개용 체크포인트 저장 간격")
    args = ap.parse_args()
    config = {k: v for k, v in vars(args).items() if k not in ("resume", "save_every")}
    latest_path = os.path.join(args.run, "latest.pt")
    model_path = os.path.join(args.run, "model.pt")
    log_path = os.path.join(args.run, "log.jsonl")
    summary_path = os.path.join(args.run, "summary.json")
    if os.path.exists(summary_path):
        raise ValueError("완료된 run은 덮어쓰거나 다시 평가하지 않습니다. 새 run을 지정하세요.")
    if not args.resume and any(os.path.exists(p) for p in (latest_path, model_path, log_path)):
        raise ValueError("기존 학습 결과가 있습니다. --resume 또는 새 run을 사용하세요.")
    resumed = torch.load(latest_path, map_location="cpu", weights_only=True) if args.resume else None
    if resumed and resumed["config"] != config:
        raise ValueError("재개하려면 data/run/device/iters 등 학습 설정이 기존과 같아야 합니다.")

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)

    metas = load_data(args.data, set(args.types.split(",")))
    train, val, test, sp = partition(metas, args.data, args.test_signers, args.seed, args.smoke)
    if args.iters < 1 or args.batch < 1 or args.eval_every < 1 or args.length < 4 or args.max_classes < 0 or args.save_every < 1:
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

    t0, best, start, elapsed = time.time(), None, 0, 0.0
    if resumed:
        if resumed["classes"] != classes or resumed["split"] != sp:
            raise ValueError("재개 체크포인트의 어휘나 공용 분할표가 다릅니다.")
        model.load_state_dict(resumed["model"])
        opt.load_state_dict(resumed["optimizer"])
        sched.load_state_dict(resumed["scheduler"])
        rng.bit_generator.state = resumed["numpy_rng"]
        torch.set_rng_state(resumed["torch_rng"])
        if args.device.startswith("cuda"):
            torch.cuda.set_rng_state_all(resumed["cuda_rng"])
        elif args.device == "mps":
            torch.mps.set_rng_state(resumed["mps_rng"])
        best, start, elapsed = resumed["best"], resumed["iter"], resumed["elapsed"]
        if best is not None:
            atomic_save(resumed["best_checkpoint"], model_path)
        if os.path.exists(log_path):
            with open(log_path, encoding="utf-8") as f:
                records = [json.loads(line) for line in f if line.strip()]
            if any(r["iter"] > start for r in records):
                os.replace(log_path, log_path + f".before-resume-{time.time_ns()}")
                with open(log_path, "w", encoding="utf-8") as f:
                    for r in records:
                        if r["iter"] <= start:
                            f.write(json.dumps(r) + "\n")
        print(f"재개: iteration {start} -> {args.iters}", flush=True)
    log = open(log_path, "a" if args.resume else "w", encoding="utf-8")
    for it in range(start + 1, args.iters + 1):
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
                atomic_save({"model": model.state_dict(), "classes": classes, "in_dim": x_clean.shape[-1],
                             "with_face": args.with_face, "length": args.length, "config": config, "split": sp}, model_path)

        if it % args.save_every == 0 or it % args.eval_every == 0 or it == args.iters:
            atomic_save({"model": model.state_dict(), "optimizer": opt.state_dict(),
                         "scheduler": sched.state_dict(), "iter": it, "config": config,
                         "classes": classes, "split": sp, "best": best,
                         "best_checkpoint": torch.load(model_path, map_location="cpu", weights_only=True) if best is not None else None,
                         "numpy_rng": rng.bit_generator.state, "torch_rng": torch.get_rng_state(),
                         "cuda_rng": torch.cuda.get_rng_state_all() if args.device.startswith("cuda") else [],
                         "mps_rng": torch.mps.get_rng_state() if args.device == "mps" else None,
                         "elapsed": elapsed + time.time() - t0}, latest_path)

    log.close()
    ck = torch.load(model_path, map_location="cpu", weights_only=True)
    model.load_state_dict(ck["model"])
    summary = {"best": best[1], "classes": len(classes), "minutes": round((elapsed + time.time() - t0) / 60, 1),
               "split": sp, "config": config, "excluded_test_clips": excluded_test, "test_clips": len(test),
               "selection": "val_top1" if val else "train_aug_top1",
               "evaluated_on_unseen_signers": x_test is not None}
    if x_test is not None:
        summary["test_top1"], summary["test_top5"] = accuracy(model, x_test, y_test)
    with open(summary_path + ".tmp", "w") as f:
        json.dump(summary, f, indent=2)
    os.replace(summary_path + ".tmp", summary_path)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
