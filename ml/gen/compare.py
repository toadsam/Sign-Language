"""비교 실험: 우리 방법(토큰 생성) vs 기준선 ① 클립 이어붙이기 vs 기준선 ② 좌표 직접 예측.

  python -m gen.compare --data data/sample --vq runs/vq_sample --recog runs/recog_sample \
      --gpt runs/gen_gpt --regress runs/gen_regress --out runs/compare

[단어 단위] 각 단어를 만들어 정답(실제 동작)과 비교
  읽는 모델 정답률 · 정답과의 DTW 거리(mm) · 움직임 크기(정답 대비) · 다양성(같은 단어 5번 생성)
[여러 단어 잇기] 단어 3개를 이어 한 문장처럼 만들었을 때
  중간에 손이 내려가는 횟수 · 손목 흔들림(jerk)
"""
import argparse
import json
import os

import numpy as np
import torch

from common import metrics as M
from common.data import load_data
from common.viewer import write_viewer
from gen import baselines
from gen.train_word import load_generator
from recog.features import joint_index, prepare
from recog.model import load_recognizer
from vq.model import load_vqvae

SENTENCES = [["WORD1501", "WORD1505", "WORD1510"], ["WORD1503", "WORD1507", "WORD1512"],
             ["WORD1502", "WORD1509", "WORD1516"]]


def main():
    ap = argparse.ArgumentParser()
    for k in ("data", "vq", "recog", "gpt", "regress", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--top-k", type=int, default=10)
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    os.makedirs(args.out, exist_ok=True)

    vq, _ = load_vqvae(f"{args.vq}/model.pt")
    recog, rc = load_recognizer(f"{args.recog}/model.pt")
    gpt, gc = load_generator(f"{args.gpt}/model.pt")
    reg, _ = load_generator(f"{args.regress}/model.pt")
    joints, L = joint_index(rc["with_face"]), rc["length"]
    tk = json.load(open(gc["tokens"], encoding="utf-8"))["clips"]
    metas = {m["clip"]: m for m in load_data(args.data)}
    by_item = {m["item"]: m for m in metas.values()}

    def read(x, item):
        """읽는 모델이 이 동작을 item으로 읽는가 (top-1)."""
        _, idx = recog.topk(torch.from_numpy(prepare(x, [0, len(x) - 1], joints, L))[None], 5)
        inv = {v: k for k, v in rc["classes"].items()}
        return inv[idx[0, 0].item()] == item

    @torch.no_grad()
    def gen_tokens(item, n):
        cond = torch.full((n,), gc["classes"][item])
        sig = torch.zeros(n, dtype=torch.long)
        return gpt.generate(cond, sig, top_k=args.top_k, temperature=args.temperature)

    decode = lambda tokens: vq.decode(torch.tensor(tokens)[None])[0].numpy()

    # ------------------------------------------------ 단어 단위
    rows, word_view, gen_cache = [], [], {}
    for item in sorted(gc["classes"]):
        m = by_item[item]
        info = tk[m["clip"]]
        s, e = info["frames"]
        ref = m["x"][s:e]
        mm = m["norm"]["scale"] * 1000
        outs = {
            "자모표 복원 (상한)": [decode(info["tokens"])],
            "우리 방법 (토큰 생성)": [decode(t) for t in gen_tokens(item, args.samples)],
            "기준선② 좌표 직접 예측": [reg(torch.tensor([gc["classes"][item]]), torch.zeros(1, dtype=torch.long))[0].detach().numpy()],
        }
        gen_cache[item] = outs["우리 방법 (토큰 생성)"][0]
        for name, xs in outs.items():
            rows.append({
                "method": name, "item": item,
                "read_ok": float(np.mean([read(x, item) for x in xs])),
                "dtw_mm": float(np.mean([M.dtw_mje(x, ref, mm) for x in xs])),
                "size_ratio": float(np.mean([M.wrist_path(x) for x in xs]) / max(M.wrist_path(ref), 1e-6)),
                "diversity_mm": M.diversity(xs) * mm if len(xs) > 1 else 0.0,
            })
        word_view.append({"name": item, "split": "우리 방법", "a": ref, "b": outs["우리 방법 (토큰 생성)"][0]})
        word_view.append({"name": item, "split": "좌표 직접 예측", "a": ref, "b": outs["기준선② 좌표 직접 예측"][0]})

    table = {}
    for r in rows:
        t = table.setdefault(r["method"], {k: [] for k in ("read_ok", "dtw_mm", "size_ratio", "diversity_mm")})
        for k in t:
            t[k].append(r[k])
    table = {k: {m: float(np.mean(v)) for m, v in t.items()} for k, t in table.items()}

    # ------------------------------------------------ 여러 단어 잇기
    sent_rows, sent_view = [], []
    for words in SENTENCES:
        clips = [by_item[w] for w in words]
        name = "+".join(w[-4:] for w in words)
        variants = {
            "기준선① 그대로 잇기 (1학기 방식)": baselines.hard_cut(clips),
            "기준선① 움직임만 잘라 잇기 (폴백)": baselines.trimmed(clips),
            "우리 방법 (생성 토큰 이어 복원)": decode(sum((gen_tokens(w, 1)[0] for w in words), [])),
        }
        for k, x in variants.items():
            sent_rows.append({"method": k, "sentence": name, "rest_dips": M.rest_dips(x), "jerk": M.jerk(x),
                              "seconds": round(len(x) / 30, 2)})
        sent_view.append({"name": name, "split": "그대로 잇기 vs 우리", "a": variants["기준선① 그대로 잇기 (1학기 방식)"],
                          "b": variants["우리 방법 (생성 토큰 이어 복원)"]})
    sent_table = {}
    for r in sent_rows:
        t = sent_table.setdefault(r["method"], {"rest_dips": [], "jerk": [], "seconds": []})
        for k in t:
            t[k].append(r[k])
    sent_table = {k: {m: float(np.mean(v)) for m, v in t.items()} for k, t in sent_table.items()}

    # ------------------------------------------------ 출력
    print("\n[단어 단위]  (단어 %d개, 우리 방법은 단어마다 %d번 생성)" % (len(gc["classes"]), args.samples))
    print(f"{'방법':24s} {'읽는모델 정답':>10s} {'정답과 거리(mm)':>14s} {'움직임 크기':>10s} {'다양성(mm)':>10s}")
    for k, t in table.items():
        print(f"{k:24s} {t['read_ok']:10.0%} {t['dtw_mm']:14.1f} {t['size_ratio']:10.2f} {t['diversity_mm']:10.1f}")
    print("\n[단어 3개 잇기]  (%d문장 평균)" % len(SENTENCES))
    print(f"{'방법':30s} {'중간에 손 내림':>12s} {'손목 jerk':>10s} {'길이(초)':>8s}")
    for k, t in sent_table.items():
        print(f"{k:30s} {t['rest_dips']:12.1f} {t['jerk']:10.1f} {t['seconds']:8.1f}")

    json.dump({"word": table, "word_rows": rows, "sentence": sent_table, "sentence_rows": sent_rows, "config": vars(args)},
              open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    write_viewer(os.path.join(args.out, "viewer_words.html"), word_view, labels=("실제 동작 (정답)", "모델이 만든 동작"),
                 title="단어 단위 생성 — 실제 동작과 비교")
    write_viewer(os.path.join(args.out, "viewer_sentences.html"), sent_view,
                 labels=("기준선①: 클립 그대로 잇기 (1학기 방식)", "우리 방법: 생성 토큰을 이어 한 번에 복원"),
                 title="단어 3개 잇기 — 이어붙이기와 비교")


if __name__ == "__main__":
    main()
