"""모든 클립을 자모표 토큰 열로 바꿔 저장한다 (받아쓰기 모델의 학습 데이터).

단어 클립은 움직임 구간만 쓴다. 앞뒤 대기 자세까지 넣으면 모델이 "손 내리기"도 단어의 일부로 배운다.
문장 클립은 전체를 쓴다 (단어 사이 전환이 배울 대상이다).

  python -m gen.tokenize --vq runs/vq_sample --data data/sample --out data/sample/tokens.json
"""
import argparse
import json

import torch

from common.data import load_data
from vq.model import load_vqvae

PAD = 4  # 움직임 구간 앞뒤로 남기는 프레임


def segment(m, down):
    """토큰으로 바꿀 프레임 구간 [s, e). 길이는 down의 배수."""
    T = len(m["x"])
    if m["type"] == "WORD":
        s, e = max(m["active"][0] - PAD, 0), min(m["active"][1] + PAD + 1, T)
    else:
        s, e = 0, T
    e = s + (e - s) // down * down
    return s, e


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vq", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    vq, cfg = load_vqvae(f"{args.vq}/model.pt")
    out = {"vq": args.vq, "nb_code": cfg["nb_code"], "down": vq.down, "clips": {}}
    lengths = []
    for m in load_data(args.data):
        s, e = segment(m, vq.down)
        tok = vq.encode(torch.from_numpy(m["x"][s:e])[None])[0].tolist()
        out["clips"][m["clip"]] = {"item": m["item"], "signer": m["signer"], "type": m["type"],
                                   "frames": [s, e], "tokens": tok}
        lengths.append(len(tok))
    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{len(lengths)}개 클립 → {args.out} · 토큰 길이 최소/평균/최대 {min(lengths)}/{sum(lengths) / len(lengths):.1f}/{max(lengths)}")


if __name__ == "__main__":
    main()
