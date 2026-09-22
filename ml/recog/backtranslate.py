"""읽는 모델로 자모표 복원 동작을 채점한다 (역번역).

원본 동작과 자모표로 바꿨다 되돌린 동작을 각각 읽는 모델에 넣어,
원래 단어를 맞히는 비율이 얼마나 유지되는지(보존율) 본다.

  python -m recog.backtranslate --recog runs/recog --vq runs/vq --data data/full
"""
import argparse
import json

import numpy as np
import torch

from common.data import load_data
from recog.features import joint_index, prepare
from recog.model import SignRecognizer
from vq.model import MotionVQVAE
from vq.train import split


def load_recog(path):
    ck = torch.load(path, map_location="cpu")
    m = SignRecognizer(ck["in_dim"], len(ck["classes"]))
    m.load_state_dict(ck["model"])
    return m.eval(), ck


def load_vq(path):
    ck = torch.load(path, map_location="cpu")
    c = ck["config"]
    m = MotionVQVAE(375, c["width"], c["code_dim"], c["nb_code"], depth=c["depth"])
    m.load_state_dict(ck["model"])
    return m.eval(), c


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recog", required=True, help="읽는 모델 run 폴더")
    ap.add_argument("--vq", required=True, help="자모표 run 폴더")
    ap.add_argument("--data", required=True)
    ap.add_argument("--which", choices=["test", "train", "all"], default="test",
                    help="자모표 학습 기준 어느 클립으로 볼지")
    args = ap.parse_args()

    recog, rc = load_recog(f"{args.recog}/model.pt")
    vq, vc = load_vq(f"{args.vq}/model.pt")
    classes, joints, L = rc["classes"], joint_index(rc["with_face"]), rc["length"]

    metas = load_data(args.data)
    tr, te = split(metas, vc)
    clips = {"test": te, "train": tr, "all": metas}[args.which]
    clips = [m for m in clips if m["item"] in classes]
    if not clips:
        raise SystemExit("읽는 모델이 아는 단어가 이 클립들에 없습니다.")

    hits = {"orig": [0, 0], "recon": [0, 0]}  # top1, top5
    rows = []
    for m in clips:
        T = len(m["x"]) // vq.down * vq.down
        x = m["x"][:T]
        xr = vq(torch.from_numpy(x)[None])[0][0].numpy()
        y = classes[m["item"]]
        row = {"clip": m["clip"]}
        for name, arr in (("orig", x), ("recon", xr)):
            act = [min(m["active"][0], T - 2), min(m["active"][1], T - 1)]
            _, idx = recog.topk(torch.from_numpy(prepare(arr, act, joints, L))[None], 5)
            idx = idx[0].tolist()
            hits[name][0] += idx[0] == y
            hits[name][1] += y in idx
            row[name] = idx[0] == y
        rows.append(row)

    n = len(clips)
    res = {k: {"top1": v[0] / n, "top5": v[1] / n} for k, v in hits.items()}
    res["보존율_top1"] = res["recon"]["top1"] / max(res["orig"]["top1"], 1e-9)
    res["보존율_top5"] = res["recon"]["top5"] / max(res["orig"]["top5"], 1e-9)
    res["clips"] = n
    print(json.dumps(res, indent=2, ensure_ascii=False))
    lost = [r["clip"] for r in rows if r["orig"] and not r["recon"]]
    if lost:
        print("원본은 맞혔는데 복원은 틀린 클립:", ", ".join(lost))


if __name__ == "__main__":
    main()
