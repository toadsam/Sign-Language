"""작은 단어 묶음으로 GPT 구조가 단어별 동작을 배우는지 빠르게 확인한다(정식 학습 아님).

gen_match와 같은 seed17 규칙으로 단어 N개를 고르고, 그 단어들의 train 클립만으로 새 MotionGPT를 학습한다.
끝나면 같은 N개 안에서
  - 확률 비교: 정답 단어 조건의 NLL 순위 (train 클립 / val 클립)
  - 생성 비교: 생성 동작이 그 단어 정답 동작에 가장 가까운지 (gen_match.match_report)
를 낸다. 체크포인트는 저장하지 않는다.

  python -m gen.quick_fit --tokens ... --data ... --split-file ... --vq ... --words 50 --iters 3000 \
      --cond-every --cond-drop 0.1 --guidance 1 2 --device cuda --out .../quick_B.json
"""
import argparse
import json
import math
from pathlib import Path
import time

import numpy as np


def batch_loss(model, rows, classes, signer_ids, corrupt, rng, cond_drop, device):
    import torch
    import torch.nn.functional as F
    length = max(len(r["tokens"]) for r in rows)
    inputs = torch.full((len(rows), length), model.pad, dtype=torch.long)
    targets = torch.full((len(rows), length + 1), -100, dtype=torch.long)
    for i, row in enumerate(rows):
        tokens = torch.tensor(row["tokens"], dtype=torch.long)
        rate = rng.uniform(0, corrupt)
        noisy = torch.where(torch.rand(len(tokens)) < rate, torch.randint(0, model.nb_code, (len(tokens),)), tokens)
        inputs[i, :len(tokens)] = noisy
        targets[i, :len(tokens)] = tokens
        targets[i, len(tokens)] = model.end
    cond = torch.tensor([classes[r["item"]] for r in rows], dtype=torch.long)
    if cond_drop:
        cond = torch.where(torch.rand(len(rows)) < cond_drop, torch.full_like(cond, model.null), cond)
    sig = torch.tensor([signer_ids[r["signer"]] for r in rows], dtype=torch.long)
    logits = model(cond.to(device), inputs.to(device), sig.to(device))
    return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.to(device).reshape(-1), ignore_index=-100)


def rank_report(model, rows, classes, signer_of):
    from gen.rank_words import evaluate_model
    metrics, _ = evaluate_model(model, rows, classes, signer_of, chunk=len(classes))
    return {k: metrics[k] for k in ("clips", "conditions", "top1", "top5", "mean_rank")} | {
        "gain_first4": metrics["condition_gain_by_position"][:4]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("tokens", "data", "split-file", "vq", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--words", type=int, default=50, help="0이면 train의 모든 단어")
    ap.add_argument("--eval-clips", type=int, default=0, help="중간 평가에 쓸 train/val 클립 수(seed17 고정). 0이면 전부")
    ap.add_argument("--gen-words", type=int, default=200, help="--words 0일 때 생성 비교에 쓸 단어 수")
    ap.add_argument("--save", help="val top5가 가장 좋은 시점의 가중치를 저장할 .pt 경로")
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--corrupt", type=float, default=0.3)
    ap.add_argument("--cond-every", action="store_true")
    ap.add_argument("--cond-drop", type=float, default=0.0, help=">0이면 null 조건을 만들고 그 비율로 바꿔 넣는다")
    ap.add_argument("--guidance", type=float, nargs="+", default=[1.0])
    ap.add_argument("--generation-signer", default="REAL01")
    ap.add_argument("--eval-every", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = ap.parse_args(argv)

    import torch
    from gen.data import select_data
    from gen.gen_match import SAMPLING, SEEDS, match_report, pick_words, vq_decoder
    from gen.model import MotionGPT
    from vq.model import load_vqvae
    started = time.time()
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    selection = select_data(args.tokens, str(Path(args.data) / "meta.jsonl"), args.split_file, mode="formal")
    if args.words:
        words, train_by, val_by = pick_words(selection, selection.classes, args.words)
        gen_words = words
    else:
        words = sorted(selection.classes, key=selection.classes.get)
        gen_words, train_by, val_by = pick_words(selection, selection.classes, args.gen_words)
    classes = {w: i for i, w in enumerate(words)}
    signer_ids = selection.signers
    train = [r for r in selection.train if r["item"] in classes]
    val = [r for r in selection.partitions["val"] if r["item"] in classes]

    def fixed(rows):
        if not args.eval_clips or len(rows) <= args.eval_clips:
            return rows
        return [rows[i] for i in sorted(np.random.default_rng(17).choice(len(rows), args.eval_clips, replace=False))]
    train_eval, val_eval = fixed(train), fixed(val)
    max_len = max(len(r["tokens"]) for r in train) + 8
    model = MotionGPT(len(words), selection.tokens["nb_code"], d=args.d, layers=args.layers, max_len=max_len,
                      n_signer=len(signer_ids), dropout=args.dropout, cond_every=args.cond_every,
                      null_cond=args.cond_drop > 0).to(args.device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    warm = max(1, args.iters // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) *
                                              0.5 * (1 + math.cos(math.pi * min(s, args.iters) / args.iters)))
    gen_signer = signer_ids[args.generation_signer]
    history, best = [], {"key": None, "step": None, "state": None}

    def evaluate(step):
        model.eval()
        entry = {"step": step, "train_loss_avg": float(np.mean(losses[-args.eval_every:])),
                 "rank_train": rank_report(model, train_eval, classes, lambda r: signer_ids[r["signer"]]),
                 "rank_val": rank_report(model, val_eval, classes, lambda r: gen_signer),
                 "elapsed": round(time.time() - started, 1)}
        model.train()
        history.append(entry)
        key = (entry["rank_val"]["top5"], entry["rank_val"]["top1"])
        if best["key"] is None or key > best["key"]:
            best.update(key=key, step=step, state={k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
        print(json.dumps({"step": step, "train_top1": entry["rank_train"]["top1"], "val_top1": entry["rank_val"]["top1"],
                          "val_top5": entry["rank_val"]["top5"], "best_step": best["step"],
                          "elapsed": entry["elapsed"]}), flush=True)

    model.train()
    losses = []
    for step in range(1, args.iters + 1):
        rows = [train[i] for i in rng.integers(0, len(train), args.batch)]
        loss = batch_loss(model, rows, classes, signer_ids, args.corrupt, rng, args.cond_drop, args.device)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        losses.append(loss.item())
        if step % args.eval_every == 0 or step == args.iters:
            evaluate(step)

    model.load_state_dict(best["state"])
    model.eval()
    if args.save:
        Path(args.save).parent.mkdir(parents=True, exist_ok=True)
        torch.save({"model": best["state"], "step": best["step"], "config": vars(args), "classes": classes,
                    "signers": signer_ids, "nb_code": model.nb_code, "max_len": max_len,
                    "generation_signer": args.generation_signer,
                    "arch": {"d": args.d, "layers": args.layers, "dropout": args.dropout,
                             "cond_every": args.cond_every, "null_cond": args.cond_drop > 0}}, args.save)
    decode = vq_decoder(load_vqvae(args.vq)[0].to(args.device), args.device)
    cond = torch.tensor([classes[w] for w in gen_words], device=args.device)
    sig = torch.full_like(cond, gen_signer)
    generation = {}
    for g in args.guidance:
        generated = []
        for seed in SEEDS:
            torch.manual_seed(seed)
            generated += list(zip(gen_words, model.generate(cond, sig, **SAMPLING, guidance=g)))
        report = match_report(generated, gen_words, train_by, val_by, decode)
        generation[str(g)] = report
        print(json.dumps({"guidance": g, "gen_top1": report["body_hands55"]["generated"]["top1"],
                          "real_top1": report["body_hands55"]["real_val_ceiling"]["top1"]}), flush=True)
    result = {"config": vars(args), "words": len(words), "train_clips": len(train), "val_clips": len(val),
              "eval_clips": {"train": len(train_eval), "val": len(val_eval)}, "best_step": best["step"],
              "epochs": args.iters * args.batch / len(train), "final_train_loss_avg100": float(np.mean(losses[-100:])),
              "history": history, "generation": generation, "seconds": round(time.time() - started, 1)}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
