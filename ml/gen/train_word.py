"""단어 단위 생성 모델 학습.

  코드 확인: python -m gen.train_word --model gpt --tokens data/sample/tokens.json --data data/sample --data-mode smoke --run runs/gen_gpt_smoke
  정식 학습은 --split, --vq-checkpoint, --vq-version을 명시한다.

두 모델은 같은 크기의 Transformer이고 같은 데이터(움직임 구간)로 학습한다. 다른 점은 출력뿐이다:
토큰을 하나씩 고르느냐(gpt), 좌표를 바로 맞추느냐(regress).
"""
import argparse
import json
import os
import time

import numpy as np
from gen.data import DataValidationError, select_data


def load_setup(tokens_path, data_dir, *, split_path=None, mode="formal",
               meta_path=None, include_motion=False, return_selection=False):
    """Same four-value return as before, with validated train-only clips.

    Formal callers must supply split_path. GPT leaves include_motion=False;
    B2 may explicitly request motion from selected training clips only.
    return_selection=True appends the Selection as a fifth return value.
    """
    selection = select_data(tokens_path, meta_path or os.path.join(data_dir, "meta.jsonl"),
                            split_path, kind="WORD", mode=mode)
    clips = [dict(c) for c in selection.train]
    if include_motion:
        for c in clips:
            motion = np.load(os.path.join(data_dir, "npy", f"{c['clip']}.npy"), allow_pickle=False)
            if motion.ndim not in (2, 3) or motion.shape[1:] not in ((375,), (125, 3)):
                raise DataValidationError("invalid_motion_shape", c["clip"])
            s, e = c["frames"]
            if len(motion) != c["total_frames"] or not np.isfinite(motion).all():
                raise DataValidationError("invalid_motion", c["clip"])
            c["motion"] = motion.reshape(-1, 375)[s:e]
    result = (selection.tokens, clips, selection.classes, selection.signers)
    return (*result, selection) if return_selection else result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["gpt", "regress"], required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", help="formal: explicit fixed signer split JSON")
    ap.add_argument("--data-mode", choices=["formal", "smoke"], default="formal")
    ap.add_argument("--vq-checkpoint", help="explicit decoder model.pt; required for formal runs")
    ap.add_argument("--vq-version", help="declared decoder version; required for formal runs")
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--corrupt", type=float, default=0.3, help="gpt: 입력 토큰을 무작위로 바꾸는 최대 비율")
    ap.add_argument("--length", type=int, default=64, help="regress: 출력 프레임 수")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    from common.skeleton import FEAT_DIM
    from gen.artifacts import prepare_run
    from gen.model import MotionGPT, MotionRegressor
    from recog.features import resample
    from vq.train import joint_weights, losses
    import torch
    import torch.nn.functional as F

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    tk, clips, classes, signers, selection = load_setup(
        args.tokens, args.data, split_path=args.split, mode=args.data_mode,
        include_motion=args.model == "regress", return_selection=True)
    manifest = prepare_run(selection, args.run, vq_path=args.vq_checkpoint, vq_version=args.vq_version)
    nb = tk["nb_code"]
    max_len = max(len(c["tokens"]) for c in clips) + 8
    print(f"단어 {len(classes)}개 · 클립 {len(clips)}개 · 수행자 {len(signers)}명 · 최대 토큰 {max_len - 8}")

    if args.model == "gpt":
        model = MotionGPT(len(classes), nb, args.d, args.layers, max_len=max_len, n_signer=len(signers))
    else:
        model = MotionRegressor(len(classes), FEAT_DIM, args.length, args.d, args.layers, n_signer=len(signers))
        targets = {c["clip"]: torch.from_numpy(resample(c["motion"], args.length).astype(np.float32)) for c in clips}
        w = joint_weights(1.0, 2.0, 0.5)
    print(f"파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.iters, pct_start=0.1)

    t0 = time.time()
    log = open(os.path.join(args.run, "log.jsonl"), "w", encoding="utf-8")
    for it in range(1, args.iters + 1):
        batch = [clips[i] for i in rng.integers(len(clips), size=args.batch)]
        cond = torch.tensor([classes[c["item"]] for c in batch])
        sig = torch.tensor([signers[c["signer"]] for c in batch])
        if args.model == "gpt":
            L = max(len(c["tokens"]) for c in batch)
            inp = torch.full((len(batch), L), model.pad, dtype=torch.long)
            tgt = torch.full((len(batch), L + 1), -100, dtype=torch.long)
            for b, c in enumerate(batch):
                t = torch.tensor(c["tokens"])
                r = rng.uniform(0, args.corrupt)  # 학습–추론 불일치 줄이기: 입력 일부를 무작위 자모로
                noisy = torch.where(torch.rand(len(t)) < r, torch.randint(0, nb, (len(t),)), t)
                inp[b, :len(t)] = noisy
                tgt[b, :len(t)] = t
                tgt[b, len(t)] = model.end
            logits = model(cond, inp, sig)
            loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1), ignore_index=-100)
        else:
            y = torch.stack([targets[c["clip"]] for c in batch])
            pos, vel, hand = losses(y, model(cond, sig), w, 0.02)
            loss = pos + 0.5 * vel + hand
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if it % 100 == 0:
            print(f"[{it:5d}] loss {loss.item():.4f}  ({time.time() - t0:.0f}s)")
            log.write(json.dumps({"iter": it, "loss": loss.item()}) + "\n")
            log.flush()

    torch.save({"model": model.state_dict(), "kind": args.model, "classes": classes, "signers": signers,
                "nb_code": nb, "max_len": max_len, "tokens": args.tokens, "config": vars(args),
                "artifact_manifest": manifest},
               os.path.join(args.run, "model.pt"))
    print(f"저장: {args.run}/model.pt ({(time.time() - t0) / 60:.1f}분)")


def load_generator(path):
    import torch
    from common.skeleton import FEAT_DIM
    from gen.model import MotionGPT, MotionRegressor
    ck = torch.load(path, map_location="cpu")
    c = ck["config"]
    if ck["kind"] == "gpt":
        m = MotionGPT(len(ck["classes"]), ck["nb_code"], c["d"], c["layers"], max_len=ck["max_len"], n_signer=len(ck["signers"]))
    else:
        m = MotionRegressor(len(ck["classes"]), FEAT_DIM, c["length"], c["d"], c["layers"], n_signer=len(ck["signers"]))
    m.load_state_dict(ck["model"])
    return m.eval(), ck


if __name__ == "__main__":
    main()
