"""생성 동작이 그 단어의 정답 동작과 가까운지 잰다. 학습은 하지 않는다.

1. val에 클립이 있는 단어 N개를 seed17로 고정한다.
2. 단어마다 seed 17/18/19로 토큰을 생성하고 E5로 3D 좌표로 바꾼다.
3. 정답 = 그 단어 train 클립들의 실제 토큰을 같은 E5로 복원한 좌표.
4. 생성 동작마다 N개 단어의 정답과 거리를 재고(단어별로 가장 가까운 클립), 자기 단어가 몇 등인지 본다.
   거리: 상체+양손 55점(또는 양손 42점)을 32프레임으로 늘이거나 줄여 맞춘 뒤 평균 관절 거리.

같은 채점을 실제 val 클립(정답 토큰 복원)에도 해서 '실제 사람 동작이면 이 정도'라는 기준으로 함께 낸다.
다양성: 서로 다른 단어끼리의 평균 거리. 생성이 실제보다 많이 작으면 단어마다 비슷한 동작을 만든다는 뜻이다.

  python -m gen.gen_match --checkpoint .../model.pt --vq /data/runs/vq_e5/model.pt --tokens .../tokens_e5.json \
      --data /data/full --split-file splits/full.json --device cuda --out .../gen_match.json
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path
import time

import numpy as np

FRAMES = 32
PARTS = {"body_hands55": slice(0, 55), "hands42": slice(13, 55)}
SEEDS = (17, 18, 19)
SAMPLING = {"top_k": 10, "temperature": 1.0, "min_len": 2}


def resample(motion, frames=FRAMES):
    """[T, 375] → [frames, 125, 3], 시간축 선형 보간."""
    m = np.asarray(motion, dtype=np.float32).reshape(len(motion), -1, 3)
    pos = np.linspace(0, len(m) - 1, frames)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, len(m) - 1)
    w = (pos - lo)[:, None, None]
    return m[lo] * (1 - w) + m[hi] * w


def distances(queries, refs, part):
    """평균 관절 거리 [Q, R]. queries/refs: [N, frames, 125, 3]."""
    q, r = queries[:, :, part], refs[:, :, part]
    out = np.empty((len(q), len(r)), dtype=np.float32)
    for i in range(len(q)):
        out[i] = np.linalg.norm(r - q[i][None], axis=-1).mean(axis=(1, 2))
    return out


def word_ranks(dist, ref_words, query_words, words):
    """단어별 최소 거리로 모은 뒤 정답 단어의 순위(1부터)와 그 거리 행렬."""
    index = {w: i for i, w in enumerate(words)}
    per_word = np.full((len(dist), len(words)), np.inf, dtype=np.float32)
    cols = np.array([index[w] for w in ref_words])
    for j in range(len(words)):
        per_word[:, j] = dist[:, cols == j].min(1)
    truth = np.array([index[w] for w in query_words])
    own = per_word[np.arange(len(dist)), truth]
    ranks = 1 + (per_word < own[:, None]).sum(1)
    return ranks, per_word, truth


def summarize(ranks, per_word, truth):
    other = per_word.copy()
    other[np.arange(len(other)), truth] = np.inf
    return {"queries": int(len(ranks)), "words": int(per_word.shape[1]), "chance_top1": 1 / per_word.shape[1],
            "top1": float((ranks <= 1).mean()), "top5": float((ranks <= 5).mean()),
            "top10": float((ranks <= 10).mean()), "mean_rank": float(ranks.mean()),
            "own_word_distance": float(per_word[np.arange(len(truth)), truth].mean()),
            "nearest_other_word_distance": float(other.min(1).mean())}


def cross_word_spread(motions, words, part):
    """서로 다른 단어 동작끼리의 평균 거리(단어당 첫 동작만)."""
    first = {}
    for m, w in zip(motions, words):
        first.setdefault(w, m)
    x = np.stack(list(first.values()))
    d = distances(x, x, part)
    return float(d[~np.eye(len(d), dtype=bool)].mean())


def pick_words(selection, classes, count, seed=17):
    """val과 train에 모두 클립이 있는 단어 count개를 고정 seed로 고른다 → (words, train_by, val_by)."""
    val_by, train_by = defaultdict(list), defaultdict(list)
    for r in selection.partitions["val"]:
        val_by[r["item"]].append(r)
    for r in selection.train:
        train_by[r["item"]].append(r)
    eligible = sorted(w for w in val_by if w in classes and train_by[w])
    pick = np.random.default_rng(seed).choice(len(eligible), min(count, len(eligible)), replace=False)
    return [eligible[i] for i in sorted(pick)], train_by, val_by


def match_report(generated, words, train_by, val_by, decode, val_per_word=2):
    """generated: [(word, tokens)] → 부위별 생성/실제 val 채점 결과."""
    refs, ref_words, real, real_words = [], [], [], []
    for w in words:
        for r in train_by[w]:
            refs.append(decode(r["tokens"]))
            ref_words.append(w)
        for r in val_by[w][:val_per_word]:
            real.append(decode(r["tokens"]))
            real_words.append(w)
    gen = np.stack([decode(t) for _, t in generated])
    gen_words = [w for w, _ in generated]
    refs, real = np.stack(refs), np.stack(real)
    lengths = [len(t) for _, t in generated]
    result = {"words": len(words), "train_reference_clips": len(refs),
              "generated_token_length": {"mean": float(np.mean(lengths)), "min": int(min(lengths)),
                                         "max": int(max(lengths))},
              "real_token_length_mean": float(np.mean([len(r["tokens"]) for w in words for r in val_by[w]]))}
    for name, part in PARTS.items():
        result[name] = {
            "generated": summarize(*word_ranks(distances(gen, refs, part), ref_words, gen_words, words)),
            "real_val_ceiling": summarize(*word_ranks(distances(real, refs, part), ref_words, real_words, words)),
            "cross_word_spread": {"generated": cross_word_spread(gen, gen_words, part),
                                  "real_val": cross_word_spread(real, real_words, part)}}
    return result


def vq_decoder(vq, device):
    import torch

    def decode(tokens):
        with torch.no_grad():
            idx = torch.tensor([tokens], dtype=torch.long, device=device)
            return resample(vq.decode(idx)[0].float().cpu().numpy())
    return decode


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("checkpoint", "vq", "tokens", "data", "split-file", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--words", type=int, default=200)
    ap.add_argument("--val-per-word", type=int, default=2)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = ap.parse_args(argv)

    import torch
    from gen.data import select_data
    from gen.train_word import load_generator
    from vq.model import load_vqvae
    started = time.time()
    model, checkpoint = load_generator(args.checkpoint, args.device)
    vq = load_vqvae(args.vq)[0].to(args.device)
    selection = select_data(args.tokens, str(Path(args.data) / "meta.jsonl"), args.split_file, mode="formal")
    classes = checkpoint["classes"]
    words, train_by, val_by = pick_words(selection, classes, args.words)
    cond = torch.tensor([classes[w] for w in words], dtype=torch.long, device=args.device)
    sig = None
    if model.signer is not None:
        sig = torch.full_like(cond, checkpoint["signers"][checkpoint["generation_signer"]])
    generated = []
    for seed in SEEDS:
        torch.manual_seed(seed)
        generated += list(zip(words, model.generate(cond, sig, **SAMPLING)))
    result = {"checkpoint": str(Path(args.checkpoint).resolve()), "step": checkpoint.get("step"),
              "sampling": SAMPLING | {"seeds": SEEDS},
              **match_report(generated, words, train_by, val_by, vq_decoder(vq, args.device), args.val_per_word),
              "seconds": round(time.time() - started, 1)}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: {"gen_top1": result[k]["generated"]["top1"], "gen_top5": result[k]["generated"]["top5"],
                          "real_top1": result[k]["real_val_ceiling"]["top1"],
                          "real_top5": result[k]["real_val_ceiling"]["top5"],
                          "spread": result[k]["cross_word_spread"]} for k in PARTS}, ensure_ascii=False))


if __name__ == "__main__":
    main()
