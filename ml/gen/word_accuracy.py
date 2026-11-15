"""단어 동작 정확도 채점: 등수 대신 '그 단어 정답 동작과 얼마나 가까운가'를 잰다.

등수(word_test_eval)는 '다른 단어와 구별되는가'라서, 비슷한 단어가 많은 숫자는 정확해도 등수가 나쁘고
독특한 지명은 엉성해도 1등이 나온다. 여기서는 단어마다 정답과의 거리만 본다.

1. 정답 = 학습에 안 쓴 test 화자(REAL03, REAL12) 각각의 그 단어 동작(토큰을 E5로 복원).
2. 손을 내린 대기 구간을 잘라 실제 동작 구간만 남기고 32프레임으로 맞춘다.
3. 몸+손 거리: 상체+양손 55점 평균 관절 거리. 손 모양 거리: 손목 기준 손가락 42점 위치 차이.
4. 방식별(꺼내 주기, 생성 guidance x temperature, 5개 중 대표) 평균/중앙값과, 꺼내 주기보다 가까운 단어 비율.
5. 사람 상한: REAL03과 REAL12의 같은 단어 동작끼리의 거리.
6. (선택) --medoid-signers: 생성 화자 하나 대신 여러 train 화자 조건으로 후보를 화자마다 k개씩 만들어
   합친 뒤 대표를 고른다. 여러 사람에게 공통인 동작에 가까워지는지 본다. 방식 이름 gen_g2_t1_multi12x1.

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


def references(rows, decode):
    """정답 동작 {단어: {화자: prepare된 동작}}. 화자마다 그 단어의 첫 클립만 쓴다."""
    truth = defaultdict(dict)
    for r in rows:
        if r["signer"] not in truth[r["item"]]:
            truth[r["item"]][r["signer"]] = decode(r["tokens"])
    return dict(truth)


def score_words(motions, truth):
    """{단어: 동작} → {단어: {body, shape}}. 그 단어 정답 화자들과의 거리 평균."""
    out = {}
    for w, m in motions.items():
        refs = truth[w].values()
        out[w] = {"body": float(np.mean([body_distance(m, t) for t in refs])),
                  "shape": float(np.mean([shape_distance(m, t) for t in refs]))}
    return out


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


def medoid_signers(names, trained):
    """--medoid-signers 값 → 화자 이름 목록. all은 학습 화자 전부(이름순, '화자 없음' 제외). 학습에 없는 화자는 거절."""
    if not names:
        return []
    if names == ["all"]:
        from gen.training import NULL_SIGNER
        return sorted(n for n in trained if n != NULL_SIGNER)
    unknown = [n for n in names if n not in trained]
    if unknown:
        raise SystemExit(f"--medoid-signers: 학습에 없는 화자 {unknown}")
    return list(dict.fromkeys(names))


def pooled_medoid(cands, k):
    """{화자: [후보 동작, ...]}에서 화자마다 앞 k개를 합쳐 몸+손 55점 대표 하나를 고른다(정답을 보지 않는다)."""
    pool = [m for seqs in cands.values() for m in seqs[:k]]
    return pool[medoid(pool, slice(0, 55))]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("checkpoint", "vq", "tokens", "data", "split-file", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--guidance", type=float, nargs="+", default=[1.0, 2.0])
    ap.add_argument("--temperature", type=float, nargs="+", default=[1.0, 0.7, 0.5, 0.3])
    ap.add_argument("--samples", type=int, nargs="+", default=[5], help="대표 고르기 후보 수(여러 개면 각각 채점)")
    ap.add_argument("--medoid-temperature", type=float, nargs="+", default=[1.0, 0.5])
    ap.add_argument("--medoid-signers", nargs="+", default=None,
                    help="여러 화자 대표 고르기에 쓸 train 화자 이름들, 또는 all(체크포인트의 학습 화자 전부)")
    ap.add_argument("--per-signer", type=int, nargs="+", default=[1],
                    help="--medoid-signers에서 화자마다 만들 후보 수(여러 개면 각각 채점)")
    ap.add_argument("--partition", choices=("test", "val"), default="test",
                    help="정답 화자. 모델·설정 고르기는 val, 최종 보고만 test")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--limit-words", type=int, default=None, help="짧은 확인용: 단어 번호 전체에서 고르게 N단어만 채점")
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
    if args.limit_words and args.limit_words < len(words):  # 단어 번호 전체에서 고르게(앞쪽 한 종류에 몰리지 않게)
        words = [words[i * len(words) // args.limit_words] for i in range(args.limit_words)]
    gen_signer = ck["generation_signer"]
    pool_signers = medoid_signers(args.medoid_signers, ck["signers"])

    def decode(tokens):
        with torch.no_grad():
            return prepare(vq.decode(torch.tensor([tokens], device=args.device))[0].float().cpu().numpy())

    keep = set(words)
    truth = references([r for r in sel.partitions[args.partition] if r["item"] in keep], decode)
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

    def generate(guidance, temperature, seed, top_k=10, signer=gen_signer):
        torch.manual_seed(seed)
        out = []
        for s in range(0, len(words), args.batch):
            cond = torch.tensor([ck["classes"][w] for w in words[s:s + args.batch]], device=args.device)
            sig = torch.full_like(cond, ck["signers"][signer])
            out += model.generate(cond, sig, top_k=top_k, temperature=temperature, min_len=2, guidance=guidance)
        return dict(zip(words, out))

    tokens = {"retrieval": retrieval}
    for g in args.guidance:
        for t in args.temperature:
            tokens[f"gen_g{g:g}_t{t:g}"] = generate(g, t, 17)
    tokens["gen_g2_greedy"] = generate(2.0, 1.0, 17, top_k=1)
    motions = {name: {w: decode(seq) for w, seq in seqs.items() if w in truth} for name, seqs in tokens.items()}
    for t in args.medoid_temperature:
        # 시드 17, 18, ...의 앞 n개로 고르므로 n이 달라도 앞쪽 후보는 같다.
        samples = [generate(2.0, t, 17 + k) for k in range(max(args.samples))]
        picked = {n: {} for n in args.samples}
        for w in words:
            if w in truth:  # 단어마다 복원해 고르고 버린다(후보 전부를 메모리에 두지 않음)
                cands = [decode(s[w]) for s in samples]
                for n in args.samples:
                    picked[n][w] = cands[medoid(cands[:n], slice(0, 55))]
        for n in args.samples:
            motions[f"gen_g2_t{t:g}_medoid{n}"] = picked[n]
        if pool_signers:
            # 화자마다 시드 17, 18, ...의 후보. 화자 순서와 시드가 같아 k가 달라도 앞쪽 후보는 같다.
            per = {p: [generate(2.0, t, 17 + k, signer=p) for k in range(max(args.per_signer))] for p in pool_signers}
            picked = {k: {} for k in args.per_signer}
            for w in words:
                if w in truth:
                    cands = {p: [decode(s[w]) for s in seqs] for p, seqs in per.items()}
                    for k in args.per_signer:
                        picked[k][w] = pooled_medoid(cands, k)
            for k in args.per_signer:
                motions[f"gen_g2_t{t:g}_multi{len(pool_signers)}x{k}"] = picked[k]
    print(json.dumps({"generated": list(motions), "seconds": round(time.time() - started, 1)}), flush=True)

    scored = {name: score_words(ms, truth) for name, ms in motions.items()}
    ceiling = {w: {"body": body_distance(v[people[0]], v[people[1]]), "shape": shape_distance(v[people[0]], v[people[1]])}
               for w, v in truth.items() if all(p in v for p in people[:2])}
    result = {"checkpoint": str(Path(args.checkpoint).resolve()), "partition": args.partition,
              "people": people, "generation_signer": gen_signer, "medoid_signers": pool_signers,
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
