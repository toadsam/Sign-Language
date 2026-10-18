"""읽는 모델로 자모표 복원 동작을 채점한다 (역번역).

원본 동작과 자모표로 바꿨다 되돌린 동작을 각각 읽는 모델에 넣어,
원래 단어를 맞히는 비율이 얼마나 유지되는지(보존율) 본다.

  python -m recog.backtranslate --recog runs/recog --vq runs/vq --data data/full
"""
import argparse
import json

import numpy as np
import torch

from common.data import apply_split, load_data
from recog.infer import Recognizer
from vq.model import load_vqvae


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recog", required=True, help="읽는 모델 run 폴더")
    ap.add_argument("--vq", required=True, help="자모표 run 폴더")
    ap.add_argument("--data", required=True)
    ap.add_argument("--which", choices=["test", "train", "all"], default="test",
                    help="채점관 학습 기준 어느 클립으로 볼지")
    ap.add_argument("--smoke", action="store_true", help="분할 없는 기존 샘플 체크포인트 동작 확인")
    ap.add_argument("--out", help="결과 JSON 경로")
    args = ap.parse_args()

    recog = Recognizer(args.recog)
    rc = recog.checkpoint
    vq, vc = load_vqvae(f"{args.vq}/model.pt")
    classes = rc["classes"]

    metas = load_data(args.data)
    sp = rc.get("split")
    if not args.smoke and (not sp or sp["mode"] != "signer"):
        raise ValueError("표현자 분할이 기록된 채점관이 필요합니다. 샘플은 --smoke를 쓰세요.")
    tr, _, te = apply_split(metas, sp) if sp and sp["mode"] == "signer" else (metas, [], metas)
    clips = {"test": te, "train": tr, "all": metas}[args.which]
    clips = [m for m in clips if m["item"] in classes]
    if not clips:
        raise SystemExit("읽는 모델이 아는 단어가 이 클립들에 없습니다.")

    hits = {"orig": [0, 0], "recon": [0, 0]}  # top1, top5
    rows = []
    for m in clips:
        T = len(m["x"]) // vq.down * vq.down
        if T < vq.down:
            raise ValueError(f"{m['clip']}: 자모표 입력보다 짧은 동작입니다.")
        x = m["x"][:T]
        xr = vq(torch.from_numpy(x)[None])[0][0].numpy()
        row = {"clip": m["clip"]}
        for name, arr in (("orig", x), ("recon", xr)):
            act = [min(m["active"][0], T - 2), min(m["active"][1], T - 1)]
            words = [word for word, _ in recog.score(arr, tuple(act))["top5"]]
            hits[name][0] += words[0] == m["item"]
            hits[name][1] += m["item"] in words
            row[name] = words[0] == m["item"]
        rows.append(row)

    n = len(clips)
    res = {k: {"top1": v[0] / n, "top5": v[1] / n} for k, v in hits.items()}
    res["보존율_top1"] = res["recon"]["top1"] / res["orig"]["top1"] if res["orig"]["top1"] else None
    res["보존율_top5"] = res["recon"]["top5"] / res["orig"]["top5"] if res["orig"]["top5"] else None
    res["clips"] = n
    res["evaluated_on_unseen_signers"] = not args.smoke and args.which == "test"
    if args.out:
        from pathlib import Path
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({**res, "rows": rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(res, indent=2, ensure_ascii=False))
    lost = [r["clip"] for r in rows if r["orig"] and not r["recon"]]
    if lost:
        print("원본은 맞혔는데 복원은 틀린 클립:", ", ".join(lost))


if __name__ == "__main__":
    main()
