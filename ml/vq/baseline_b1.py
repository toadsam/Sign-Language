"""기준선 B1(단어 클립 이어붙이기)을 정식 데이터의 처음 보는 사람(test)으로 잰다.

  python -m vq.baseline_b1 --data C:/aihub/full --vq runs/vq_e1 --out runs/b1

[단어] test 사람의 단어 클립 하나하나를 정답으로 두고 비교한다 (움직임 구간 ± 4프레임, 상체+손 55점)
  B1 저장 클립   : 같은 단어를 학습 사람 한 명(대표 수행자)이 한 클립. 서비스가 단어마다 영상 하나를 갖고 있는 것과 같다
  자모표 복원    : 정답 클립을 자모표 토큰으로 바꿨다 되돌린 것. 토큰 방식이 낼 수 있는 상한
[단어 3개 잇기] test 사람의 단어 클립 3개를 골라 잇는다 (문장 데이터가 오기 전 대용)
  그대로 잇기(1학기 방식) · 움직임만 잘라 8프레임 보간(B0 폴백) · 자른 구간의 토큰을 이어 한 번에 복원
  중간에 손 내림 횟수 · 손목 jerk · 길이

기준선 함수는 gen/baselines.py(지헌 폴더)를 고치지 않고 불러 쓴다.
"""
import argparse
import json
import os

import numpy as np
import torch

from common import metrics as M
from common.data import FEAT_DIM, apply_split, load_split
from common.skeleton import N_JOINTS
from common.viewer import write_viewer
from gen import baselines
from vq.model import PARTS, load_vqvae

NJ = PARTS["body_hand"]  # 비교는 상체+손만 (얼굴은 B1은 다른 사람 얼굴, E1은 평균 얼굴이라 공정하지 않다)


def seg(m):
    a, b = m["active"]
    return m["x"][max(a - baselines.PAD, 0): min(b + baselines.PAD + 1, len(m["x"]))]


def dtw_mm(x, ref, m_ref):
    """상체+손 55점 DTW 평균 거리(mm). 얼굴은 정답 것을 넣어 거리 0으로 만든 뒤 125/55를 곱해 55점 평균으로 되돌린다."""
    x = x.reshape(len(x), N_JOINTS, 3).copy()
    r = ref.reshape(len(ref), N_JOINTS, 3)
    x[:, NJ:] = r[:1, NJ:]
    r = r.copy()
    r[:, NJ:] = r[:1, NJ:]
    return M.dtw_mje(x, r, m_ref["norm"]["scale"] * 1000) * N_JOINTS / NJ


def load_x(data_dir, metas):
    for m in metas:
        m["x"] = np.load(os.path.join(data_dir, "npy", f"{m['clip']}.npy")).reshape(-1, FEAT_DIM)
    return metas


def label_ok(m):
    return m.get("label") == "ok" and 0.85 <= m.get("dur_ratio", 1.0) < 1.5


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--vq", required=True, help="자모표 run 폴더 (상한 비교용)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sentences", type=int, default=200, help="test 사람마다 만들 단어 3개 조합 수")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.out, exist_ok=True)

    metas = [json.loads(l) for l in open(os.path.join(args.data, "meta.jsonl"), encoding="utf-8")]
    train, _, test = apply_split(metas, load_split(args.data))
    test = [m for m in test if label_ok(m)]
    # 대표 수행자: 학습 사람 중 단어를 가장 많이 가진 사람 → 없는 단어만 다음 사람으로 채운다
    by_signer = {}
    for m in train:
        if label_ok(m):
            by_signer.setdefault(m["signer"], {})[m["item"]] = m
    order = sorted(by_signer, key=lambda s: (-len(by_signer[s]), s))
    stored = {}
    for s in order:
        for item, m in by_signer[s].items():
            stored.setdefault(item, m)
    test = [m for m in test if m["item"] in stored]
    load_x(args.data, test)
    load_x(args.data, list({id(m): m for m in (stored[m["item"]] for m in test)}.values()))
    print(f"test 클립 {len(test)}개 (사람 {sorted({m['signer'] for m in test})}) · "
          f"대표 수행자 {order[0]} (단어 {len(by_signer[order[0]])}개, 없는 단어는 다른 학습 사람)")

    vq, cfg = load_vqvae(os.path.join(args.vq, "model.pt"))
    down = vq.down

    def recon(x):
        T = len(x) // down * down
        return vq.decode(vq.encode(torch.from_numpy(x[:T])[None]))[0].numpy()

    # ------------------------------------------------ 단어
    rows, word_view = [], []
    for i, m in enumerate(test):
        ref = seg(m)
        outs = {"B1 저장 클립": seg(stored[m["item"]]), "자모표 복원 (상한)": recon(ref)}
        for name, x in outs.items():
            rows.append({"method": name, "clip": m["clip"], "dtw_mm": dtw_mm(x, ref, m),
                         "size_ratio": M.wrist_path(x) / max(M.wrist_path(ref), 1e-6),
                         "len_ratio": len(x) / len(ref)})
        if i < 8:
            word_view.append({"name": f"{m['clip']} ← {stored[m['item']]['signer']}", "split": "단어",
                              "a": ref, "b": outs["B1 저장 클립"]})
        if (i + 1) % 1000 == 0:
            print(f"  단어 {i + 1}/{len(test)}")
    word = {}
    for r in rows:
        w = word.setdefault(r["method"], {"dtw_mm": [], "size_ratio": [], "len_ratio": []})
        for k in w:
            w[k].append(r[k])
    word = {k: {s: {"mean": float(np.mean(v)), "median": float(np.median(v))} for s, v in w.items()}
            for k, w in word.items()}

    # ------------------------------------------------ 단어 3개 잇기
    by_test = {}
    for m in test:
        by_test.setdefault(m["signer"], []).append(m)
    sent_rows, sent_view = [], []
    for s, ms in sorted(by_test.items()):
        for k in range(args.sentences):
            clips = [ms[j] for j in rng.choice(len(ms), 3, replace=False)]
            name = f"{s}:" + "+".join(m["item"][-4:] for m in clips)
            segs = [seg(m)[: len(seg(m)) // down * down] for m in clips]
            tokens = torch.cat([vq.encode(torch.from_numpy(x)[None]) for x in segs], 1)
            variants = {"그대로 잇기 (1학기 방식)": baselines.hard_cut(clips),
                        "움직임만 잘라 8프레임 보간 (B0)": baselines.trimmed(clips),
                        "자른 구간 토큰 이어 복원": vq.decode(tokens)[0].numpy()}
            for v, x in variants.items():
                sent_rows.append({"method": v, "sentence": name, "rest_dips": M.rest_dips(x),
                                  "jerk": M.jerk(x), "seconds": len(x) / 30})
            if k < 3:
                sent_view.append({"name": name, "split": "단어 3개", "a": variants["그대로 잇기 (1학기 방식)"],
                                  "b": variants["자른 구간 토큰 이어 복원"]})
    sent = {}
    for r in sent_rows:
        t = sent.setdefault(r["method"], {"rest_dips": [], "jerk": [], "seconds": []})
        for k in t:
            t[k].append(r[k])
    sent = {k: {s: float(np.mean(v)) for s, v in t.items()} for k, t in sent.items()}

    # ------------------------------------------------ 출력
    print(f"\n[단어]  test 클립 {len(test)}개, 상체+손 55점, 움직임 구간")
    print(f"{'방법':20s} {'정답과 거리 mm (평균/중앙)':>24s} {'움직임 크기':>10s} {'길이 비':>8s}")
    for k, t in word.items():
        print(f"{k:20s} {t['dtw_mm']['mean']:12.1f} / {t['dtw_mm']['median']:5.1f} "
              f"{t['size_ratio']['median']:10.2f} {t['len_ratio']['median']:8.2f}")
    print(f"\n[단어 3개 잇기]  {len(sent_rows) // len(sent)}조합 평균")
    print(f"{'방법':28s} {'중간에 손 내림':>12s} {'손목 jerk':>10s} {'길이(초)':>8s}")
    for k, t in sent.items():
        print(f"{k:28s} {t['rest_dips']:12.2f} {t['jerk']:10.1f} {t['seconds']:8.2f}")

    json.dump({"word": word, "sentence": sent, "stored_signers": order, "test_clips": len(test),
               "vq": args.vq, "vq_version": cfg.get("note", ""), "config": vars(args)},
              open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"word_rows": rows, "sentence_rows": sent_rows},
              open(os.path.join(args.out, "rows.json"), "w", encoding="utf-8"), ensure_ascii=False)
    write_viewer(os.path.join(args.out, "viewer_words.html"), word_view,
                 labels=("처음 보는 사람의 실제 동작 (정답)", "B1: 학습 사람이 한 같은 단어 클립"),
                 title="B1 단어 — 저장 클립과 정답 비교", down=down)
    write_viewer(os.path.join(args.out, "viewer_sentences.html"), sent_view,
                 labels=("그대로 잇기 (1학기 방식)", "자른 구간 토큰을 이어 한 번에 복원"),
                 title="단어 3개 잇기", down=down)


if __name__ == "__main__":
    main()
