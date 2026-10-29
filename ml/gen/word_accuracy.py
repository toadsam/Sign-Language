"""단어 동작 정확도 채점: 등수 대신 '그 단어 정답 동작과 얼마나 가까운가'를 잰다.

등수(word_test_eval)는 '다른 단어와 구별되는가'라서, 비슷한 단어가 많은 숫자는 정확해도 등수가 나쁘고
독특한 지명은 엉성해도 1등이 나온다. 여기서는 단어마다 정답과의 거리만 본다.

1. 정답 = 학습에 안 쓴 test 화자(REAL03, REAL12) 각각의 그 단어 동작(토큰을 E5로 복원).
2. 손을 내린 대기 구간을 잘라 실제 동작 구간만 남기고 32프레임으로 맞춘다.
3. 몸+손 거리: 상체+양손 55점 평균 관절 거리. 손 모양 거리: 손목 기준 손가락 42점 위치 차이.
4. 방식별(꺼내 주기, 생성 guidance x temperature, 5개 중 대표) 평균/중앙값과, 꺼내 주기보다 가까운 단어 비율.
5. 사람 상한: REAL03과 REAL12의 같은 단어 동작끼리의 거리.

  python -m gen.word_accuracy --checkpoint .../C_best.pt --vq /data/runs/vq_e5/model.pt \
      --tokens /data/runs/tokens_e5.json --data /data/full --split-file /data/code/ml/splits/full.json \
      --device cuda --out .../word_accuracy.json
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import time

import numpy as np

from gen.gen_match import resample
from gen.word_test_eval import load_quick_fit, medoid

WRISTS = (13, 34)
HANDS = (slice(13, 34), slice(34, 55))


def active(motion, lift=0.15):
    """[T, 375] → [t, 125, 3]. 두 손목 중 높은 쪽이 가장 낮은 위치보다 lift 이상 올라간 구간(y는 아래 방향)."""
    m = np.asarray(motion, dtype=np.float32).reshape(len(motion), -1, 3)
    y = np.minimum(m[:, WRISTS[0], 1], m[:, WRISTS[1], 1])
    idx = np.where(y < y.max() - lift)[0]
    return m[idx[0]:idx[-1] + 1] if len(idx) >= 4 else m


def prepare(motion):
    return resample(active(motion).reshape(-1, 375))


def body_distance(a, b):
    return float(np.linalg.norm(a[:, :55] - b[:, :55], axis=-1).mean())


def hand_shape(m):
    return np.concatenate([m[:, h] - m[:, w:w + 1] for h, w in zip(HANDS, WRISTS)], 1)


def shape_distance(a, b):
    return float(np.linalg.norm(hand_shape(a) - hand_shape(b), axis=-1).mean())


def summarize(per_word, baseline=None):
    body = np.array([v["body"] for v in per_word.values()])
    shape = np.array([v["shape"] for v in per_word.values()])
    out = {"words": len(per_word), "body_mean": float(body.mean()), "body_median": float(np.median(body)),
           "shape_mean": float(shape.mean()), "shape_median": float(np.median(shape))}
    if baseline is not None:
        common = [w for w in per_word if w in baseline]
        out["closer_than_retrieval_body"] = float(np.mean([per_word[w]["body"] < baseline[w]["body"] for w in common]))
        out["closer_than_retrieval_shape"] = float(np.mean([per_word[w]["shape"] < baseline[w]["shape"] for w in common]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("checkpoint", "vq", "tokens", "data", "split-file", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--guidance", type=float, nargs="+", default=[1.0, 2.0])
    ap.add_argument("--temperature", type=float, nargs="+", default=[1.0, 0.7, 0.5, 0.3])
    ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = ap.parse_args(argv)

    import torch
    from gen.data import select_data
    from vq.model import load_vqvae
    started = time.time()
    model, ck = load_quick_fit(args.checkpoint, args.device)
    vq = load_vqvae(args.vq)[0].to(args.device).eval()
    sel = select_data(args.tokens, str(Path(args.data) / "meta.jsonl"), args.split_file, mode="formal")
    words = sorted(ck["classes"], key=ck["classes"].get)
    gen_signer = ck["generation_signer"]

    def decode(tokens):
        with torch.no_grad():
            return prepare(vq.decode(torch.tensor([tokens], device=args.device))[0].float().cpu().numpy())

    truth = defaultdict(dict)
    for r in sel.partitions["test"]:
        truth[r["item"]].setdefault(r["signer"], decode(r["tokens"]))
    people = sorted({p for v in truth.values() for p in v})
    retrieval, own = {}, set()  # 생성 화자의 클립을 우선, 없으면 다른 train 화자의 첫 클립
    for r in sel.train:
        if r["item"] in own:
            continue
        if r["signer"] == gen_signer:
            retrieval[r["item"]] = r["tokens"]
            own.add(r["item"])
        else:
            retrieval.setdefault(r["item"], r["tokens"])

    def generate(guidance, temperature, seed, top_k=10):
        torch.manual_seed(seed)
        out = []
        for s in range(0, len(words), args.batch):
            cond = torch.tensor([ck["classes"][w] for w in words[s:s + args.batch]], device=args.device)
            sig = torch.full_like(cond, ck["signers"][gen_signer])
            out += model.generate(cond, sig, top_k=top_k, temperature=temperature, min_len=2, guidance=guidance)
        return dict(zip(words, out))

    tokens = {"retrieval": retrieval}
    for g in args.guidance:
        for t in args.temperature:
            tokens[f"gen_g{g:g}_t{t:g}"] = generate(g, t, 17)
    tokens["gen_g2_greedy"] = generate(2.0, 1.0, 17, top_k=1)
    motions = {name: {w: decode(seq) for w, seq in seqs.items() if w in truth} for name, seqs in tokens.items()}
    for t in (1.0, 0.5):
        samples = [generate(2.0, t, 17 + k) for k in range(args.samples)]
        picked = {}
        for w in words:
            if w in truth:
                cands = [decode(s[w]) for s in samples]
                picked[w] = cands[medoid(cands, slice(0, 55))]
        motions[f"gen_g2_t{t:g}_medoid{args.samples}"] = picked
    print(json.dumps({"generated": list(motions), "seconds": round(time.time() - started, 1)}), flush=True)

    def per_word(ms):
        out = {}
        for w, m in ms.items():
            ds = [(body_distance(m, truth[w][p]), shape_distance(m, truth[w][p])) for p in people if p in truth[w]]
            out[w] = {"body": float(np.mean([d[0] for d in ds])), "shape": float(np.mean([d[1] for d in ds]))}
        return out

    scored = {name: per_word(ms) for name, ms in motions.items()}
    ceiling = {w: {"body": body_distance(v[people[0]], v[people[1]]), "shape": shape_distance(v[people[0]], v[people[1]])}
               for w, v in truth.items() if all(p in v for p in people[:2])}
    result = {"checkpoint": str(Path(args.checkpoint).resolve()), "people": people, "generation_signer": gen_signer,
              "token_length_mean": {n: float(np.mean([len(t) for t in s.values()])) for n, s in tokens.items()},
              "methods": {n: summarize(s, scored["retrieval"]) for n, s in scored.items()},
              "real_person_ceiling": summarize(ceiling), "per_word": scored,
              "seconds": round(time.time() - started, 1)}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    for n, r in list(result["methods"].items()) + [("ceiling", result["real_person_ceiling"])]:
        print(json.dumps({n: {k: round(v, 3) for k, v in r.items()}}), flush=True)


if __name__ == "__main__":
    main()
