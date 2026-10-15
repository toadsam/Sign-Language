"""학습된 자모표를 다른 데이터(예: 문장 SEN)의 평가 사람 클립으로 잰다. 노트북 CPU로 된다.

  python -m vq.eval_clips --vq runs/vq_e4_200k --data C:/aihub/full_sen --out runs/vq_e4_200k/eval_sen.json

클립 전체를 토큰으로 바꿨다 되돌린 뒤, 프레임을 라벨 구간으로 나눠 오차를 따로 낸다.
  단어 구간 : segments 의 f0~f1 안
  전환     : 앞 단어 f1 과 다음 단어 f0 사이 (문장에만 있다. 단어만으로 학습한 자모표가 약할 수 있는 곳)
  앞뒤     : 첫 단어 앞, 마지막 단어 뒤 (손 내린 대기 자세 포함)
"""
import argparse
import json
import os

import numpy as np
import torch

from common.data import FEAT_DIM, apply_split, load_split
from common.skeleton import BODY, LHAND, N_JOINTS, RHAND
from vq.model import load_vqvae
from vq.train import hand_relative

REGIONS = ("단어 구간", "전환", "앞뒤")


def regions(m, T):
    """프레임마다 0 단어 구간 / 1 전환 / 2 앞뒤."""
    r = np.full(T, 2)
    segs = sorted(m.get("segments") or [], key=lambda s: s["f0"])
    for s in segs:
        r[max(s["f0"], 0): min(s["f1"] + 1, T)] = 0
    for a, b in zip(segs, segs[1:]):
        lo, hi = a["f1"] + 1, b["f0"]
        if lo < hi:
            r[lo: min(hi, T)] = np.where(r[lo: min(hi, T)] == 0, 0, 1)
    return r


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vq", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--part", default="test", choices=["train", "val", "test"])
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    model, cfg = load_vqvae(os.path.join(args.vq, "model.pt"))
    metas = [json.loads(l) for l in open(os.path.join(args.data, "meta.jsonl"), encoding="utf-8")]
    train, val, test = apply_split(metas, load_split(args.data))
    clips = {"train": train, "val": val, "test": test}[args.part]
    print(f"{args.vq} (parts={cfg.get('parts', 'all')}) · {args.data} {args.part} {len(clips)}클립")

    acc = {k: {g: [] for g in REGIONS} for k in ("body", "hand", "finger_rel")}
    per_clip, used = [], set()
    for i, m in enumerate(clips):
        x = np.load(os.path.join(args.data, "npy", f"{m['clip']}.npy")).reshape(-1, FEAT_DIM)
        T = len(x) // model.down * model.down
        xt = torch.from_numpy(x[:T])[None]
        idx = model.encode(xt)
        xh = model.decode(idx)
        used.update(idx.flatten().tolist())
        mm = m["norm"]["scale"] * 1000
        x4, xh4 = xt.view(1, T, N_JOINTS, 3), xh.view(1, T, N_JOINTS, 3)
        d = ((x4 - xh4).norm(dim=-1)[0] * mm).numpy()  # [T, 125]
        fr = ((hand_relative(x4) - hand_relative(xh4)).norm(dim=-1)[0] * mm).numpy()  # [T, 42]
        per = {"body": d[:, BODY].mean(1), "hand": np.concatenate([d[:, LHAND], d[:, RHAND]], 1).mean(1),
               "finger_rel": fr.mean(1)}
        r = regions(m, T)
        for k, v in per.items():
            for gi, g in enumerate(REGIONS):
                acc[k][g].append(v[r == gi])
        per_clip.append({"clip": m["clip"], "hand": float(per["hand"].mean())})
        if (i + 1) % 1000 == 0:
            print(f"  {i + 1}/{len(clips)}")

    out = {"vq": args.vq, "data": args.data, "part": args.part, "clips": len(clips),
           "codes_used": len(used), "nb_code": cfg["nb_code"], "mm": {}}
    print(f"\n프레임 평균 오차 (mm) · 코드 사용 {len(used)}/{cfg['nb_code']}")
    print(f"{'':10s} {'전체':>8s} " + " ".join(f"{g:>8s}" for g in REGIONS))
    for k, by in acc.items():
        allv = np.concatenate([np.concatenate(v) for v in by.values() if v])
        row = {"전체": float(allv.mean())}
        for g, v in by.items():
            v = np.concatenate(v) if v else np.array([])
            row[g] = float(v.mean()) if v.size else None
            row[g + "_frames"] = int(v.size)
        out["mm"][k] = row
        print(f"{k:10s} {row['전체']:8.1f} " + " ".join(f"{row[g]:8.1f}" if row[g] is not None else f"{'–':>8s}"
                                                        for g in REGIONS))
    worst = sorted(per_clip, key=lambda c: -c["hand"])[:10]
    out["worst_hand"] = worst
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n저장: {args.out}")


if __name__ == "__main__":
    main()
