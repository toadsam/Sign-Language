"""동작 자모표(VQ-VAE) 학습.

샘플 과적합 테스트:
  python -m vq.train --data data/sample --run runs/vq_sample --iters 3000 --nb-code 128

기록하는 것: 손실, 코드북 사용률, 부위별 복원 오차(MPJPE, mm)
끝나면 runs/<이름>/viewer.html 에 원본·복원 비교 뷰어를 만든다.
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from common.skeleton import BODY, FACE, FEAT_DIM, L_HAND_ROOT, LHAND, N_JOINTS, R_HAND_ROOT, RHAND, all_edges
from vq.model import MotionVQVAE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWER_TEMPLATE = os.path.join(os.path.dirname(ROOT), "viewer", "skeleton_viewer.html")


# ---------------------------------------------------------------- 데이터
def load_data(data_dir):
    metas = [json.loads(l) for l in open(os.path.join(data_dir, "meta.jsonl"), encoding="utf-8")]
    for m in metas:
        m["x"] = np.load(os.path.join(data_dir, "npy", f"{m['clip']}.npy")).reshape(-1, FEAT_DIM)
    return metas


def split(metas, holdout):
    """샘플은 수행자가 1명이라 단어 단위로 나눈다. 정식 데이터에서는 수행자 단위로 나눈다."""
    items = sorted({m["item"] for m in metas})
    test_items = set(items[-holdout:]) if holdout > 0 else set()
    return [m for m in metas if m["item"] not in test_items], [m for m in metas if m["item"] in test_items]


def sample_batch(clips, batch, window, rng):
    out = np.empty((batch, window, FEAT_DIM), np.float32)
    for b in range(batch):
        x = clips[rng.integers(len(clips))]["x"]
        s = rng.integers(0, len(x) - window + 1)
        out[b] = x[s: s + window]
    return torch.from_numpy(out)


# ---------------------------------------------------------------- 손실
def joint_weights(w_body, w_hand, w_face):
    w = torch.empty(N_JOINTS)
    w[BODY], w[LHAND], w[RHAND], w[FACE] = w_body, w_hand, w_hand, w_face
    return w / w.mean()


def hand_relative(x):  # [B, T, 125, 3] → 손목 기준 손가락 좌표 [B, T, 42, 3]
    return torch.cat([x[:, :, LHAND] - x[:, :, L_HAND_ROOT: L_HAND_ROOT + 1],
                      x[:, :, RHAND] - x[:, :, R_HAND_ROOT: R_HAND_ROOT + 1]], dim=2)


def losses(x, xh, w, beta):
    B, T, _ = x.shape
    x4, xh4 = x.view(B, T, N_JOINTS, 3), xh.view(B, T, N_JOINTS, 3)
    sl1 = lambda a, b: F.smooth_l1_loss(a, b, reduction="none", beta=beta)
    pos = (sl1(x4, xh4) * w[None, None, :, None]).mean()
    vel = (sl1(x4[:, 1:] - x4[:, :-1], xh4[:, 1:] - xh4[:, :-1]) * w[None, None, :, None]).mean()
    hand = sl1(hand_relative(x4), hand_relative(xh4)).mean()
    return pos, vel, hand


# ---------------------------------------------------------------- 평가
@torch.no_grad()
def evaluate(model, clips, down):
    """클립 전체를 인코딩→복원해 부위별 MPJPE(mm)와 코드 사용 현황을 잰다."""
    model.eval()
    errs = {"body": [], "hand": [], "finger_rel": [], "face": [], "all": []}
    used, recon = set(), {}
    for m in clips:
        T = len(m["x"]) // down * down
        x = torch.from_numpy(m["x"][:T])[None]
        xh, _, _, idx = model(x)
        used.update(idx.flatten().tolist())
        mm = m["norm"]["scale"] * 1000.0  # 정규화 단위(어깨너비) → mm
        x4, xh4 = x.view(1, T, N_JOINTS, 3), xh.view(1, T, N_JOINTS, 3)
        d = (x4 - xh4).norm(dim=-1)[0] * mm  # [T, 125]
        errs["body"].append(d[:, BODY].mean().item())
        errs["hand"].append(torch.cat([d[:, LHAND], d[:, RHAND]], 1).mean().item())
        errs["face"].append(d[:, FACE].mean().item())
        errs["all"].append(d.mean().item())
        errs["finger_rel"].append(((hand_relative(x4) - hand_relative(xh4)).norm(dim=-1) * mm).mean().item())
        recon[m["clip"]] = (xh[0].numpy(), idx[0].tolist())
    model.train()
    return {k: float(np.mean(v)) for k, v in errs.items()}, used, recon


# ---------------------------------------------------------------- 뷰어 내보내기
def export_viewer(run_dir, train_clips, test_clips, recon, down, per_split=4):
    if not os.path.exists(VIEWER_TEMPLATE):
        print(f"뷰어 템플릿이 없어 건너뜀: {VIEWER_TEMPLATE}")
        return
    chosen = [("test", m) for m in test_clips[:per_split]] + [("train", m) for m in train_clips[:per_split]]
    data = {"edges": all_edges(), "down": down, "fps": 30, "parts": {
        "body": [BODY.start, BODY.stop], "lhand": [LHAND.start, LHAND.stop],
        "rhand": [RHAND.start, RHAND.stop], "face": [FACE.start, FACE.stop]}, "clips": []}
    for sp, m in chosen:
        xh, tokens = recon[m["clip"]]
        T = len(xh)
        data["clips"].append({
            "name": m["clip"], "split": sp, "frames": T, "active": m["active"], "tokens": tokens,
            "orig": np.round(m["x"][:T].reshape(-1), 3).tolist(),
            "recon": np.round(xh.reshape(-1), 3).tolist(),
        })
    html = open(VIEWER_TEMPLATE, encoding="utf-8").read()
    html = html.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")))
    path = os.path.join(run_dir, "viewer.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"뷰어: {path}")


# ---------------------------------------------------------------- 학습
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--window", type=int, default=64)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--width", type=int, default=256)
    ap.add_argument("--code-dim", type=int, default=256)
    ap.add_argument("--nb-code", type=int, default=512)
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--w-body", type=float, default=1.0)
    ap.add_argument("--w-hand", type=float, default=2.0)
    ap.add_argument("--w-face", type=float, default=0.5)
    ap.add_argument("--lam-vel", type=float, default=0.5)
    ap.add_argument("--lam-hand", type=float, default=1.0)
    ap.add_argument("--commit", type=float, default=0.02)
    ap.add_argument("--beta", type=float, default=0.02, help="Smooth L1 경계 (정규화 단위, 약 7mm)")
    ap.add_argument("--holdout", type=int, default=4, help="평가용으로 빼 둘 단어 수")
    ap.add_argument("--eval-every", type=int, default=500)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)
    json.dump(vars(args), open(os.path.join(args.run, "config.json"), "w"), indent=2)

    metas = load_data(args.data)
    train_clips, test_clips = split(metas, args.holdout)
    print(f"학습 클립 {len(train_clips)}개, 평가 클립 {len(test_clips)}개")

    model = MotionVQVAE(FEAT_DIM, args.width, args.code_dim, args.nb_code, depth=args.depth)
    down = model.down
    print(f"파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.99), weight_decay=0.0)
    w = joint_weights(args.w_body, args.w_hand, args.w_face)
    log = open(os.path.join(args.run, "log.jsonl"), "w", encoding="utf-8")

    t0 = time.time()
    acc = {"pos": 0.0, "vel": 0.0, "hand": 0.0, "commit": 0.0, "ppl": 0.0}
    for it in range(1, args.iters + 1):
        for g in opt.param_groups:
            g["lr"] = args.lr * min(1.0, it / args.warmup)
        x = sample_batch(train_clips, args.batch, args.window, rng)
        xh, commit, ppl, _ = model(x)
        pos, vel, hand = losses(x, xh, w, args.beta)
        loss = pos + args.lam_vel * vel + args.lam_hand * hand + args.commit * commit
        opt.zero_grad()
        loss.backward()
        opt.step()
        for k, v in zip(acc, (pos, vel, hand, commit, ppl)):
            acc[k] += v.item()

        if it % 100 == 0:
            avg = {k: v / 100 for k, v in acc.items()}
            acc = {k: 0.0 for k in acc}
            print(f"[{it:5d}] pos {avg['pos']:.5f} vel {avg['vel']:.5f} hand {avg['hand']:.5f} "
                  f"commit {avg['commit']:.4f} ppl {avg['ppl']:.1f}  ({time.time() - t0:.0f}s)")
            log.write(json.dumps({"iter": it, **avg}) + "\n")
        if it % args.eval_every == 0 or it == args.iters:
            ev_tr, used_tr, _ = evaluate(model, train_clips, down)
            ev_te, used_te, _ = evaluate(model, test_clips, down) if test_clips else ({}, set(), {})
            fmt = lambda e: " ".join(f"{k} {v:.1f}" for k, v in e.items())
            print(f"  평가 train(mm): {fmt(ev_tr)} | 코드 {len(used_tr)}/{args.nb_code}")
            if test_clips:
                print(f"  평가 test (mm): {fmt(ev_te)} | 코드 {len(used_te)}/{args.nb_code}")
            log.write(json.dumps({"iter": it, "eval_train": ev_tr, "eval_test": ev_te,
                                  "codes_train": len(used_tr), "codes_test": len(used_te)}) + "\n")
        log.flush()

    torch.save({"model": model.state_dict(), "config": vars(args)}, os.path.join(args.run, "model.pt"))
    ev_tr, used_tr, rec_tr = evaluate(model, train_clips, down)
    ev_te, used_te, rec_te = evaluate(model, test_clips, down) if test_clips else ({}, set(), {})
    summary = {"train_mm": ev_tr, "test_mm": ev_te, "codes_used_train": len(used_tr),
               "codes_used_test": len(used_te), "nb_code": args.nb_code,
               "minutes": round((time.time() - t0) / 60, 1)}
    json.dump(summary, open(os.path.join(args.run, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))
    export_viewer(args.run, train_clips, test_clips, {**rec_tr, **rec_te}, down)


if __name__ == "__main__":
    main()
