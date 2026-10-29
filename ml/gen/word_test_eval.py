"""최종 단어 생성 채점: 3000단어 전체를 후보로, 정답 동작은 학습에 안 쓴 test 화자의 동작으로 둔다.

1. 단어마다 방식별로 토큰열을 만든다(생성 모델 여러 설정 + 꺼내 주기 = 생성 화자의 train 정답 토큰열).
2. E5로 3D 좌표로 바꾸고 32프레임으로 맞춘다.
3. test 화자 한 명씩 따로: 그 사람의 3000단어 동작 전체와 거리를 재고 자기 단어가 몇 등인지 본다.
   두 사람 결과를 평균한다. 거리 = 상체+양손 55점(또는 양손 42점) 평균 관절 거리.
4. 사람 상한: test 화자 한 명의 동작을 다른 test 화자의 동작들에 대고 같은 채점을 한다.

  python -m gen.word_test_eval --checkpoint .../C_best.pt --vq /data/runs/vq_e5/model.pt \
      --tokens /data/runs/tokens_e5.json --data /data/full --split-file /data/code/ml/splits/full.json \
      --device cuda --out .../word_test_eval.json
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import time

import numpy as np

from gen.gen_match import PARTS, SAMPLING, resample, summarize, word_ranks


def torch_distances(queries, refs, part, device, chunk=4):
    """gen_match.distances와 같은 값을 GPU에서 낸다. [Q, R]"""
    import torch
    r = torch.as_tensor(refs[:, :, part], device=device)
    out = np.empty((len(queries), len(refs)), dtype=np.float32)
    for s in range(0, len(queries), chunk):
        q = torch.as_tensor(queries[s:s + chunk, :, part], device=device)
        out[s:s + chunk] = (r[None] - q[:, None]).norm(dim=-1).mean(dim=(2, 3)).cpu().numpy()
    return out


def medoid(motions, part):
    """서로 가장 비슷한 대표 하나의 위치(정답을 보지 않는다)."""
    x = np.stack(motions)
    d = np.linalg.norm(x[:, None, :, part] - x[None, :, :, part], axis=-1).mean(axis=(2, 3))
    return int(d.sum(1).argmin())


def load_quick_fit(path, device):
    import torch
    from gen.model import MotionGPT
    ck = torch.load(path, map_location=device, weights_only=False)
    a = ck["arch"]
    model = MotionGPT(len(ck["classes"]), ck["nb_code"], d=a["d"], layers=a["layers"], max_len=ck["max_len"],
                      n_signer=len(ck["signers"]), dropout=a["dropout"], cond_every=a["cond_every"],
                      null_cond=a["null_cond"]).to(device)
    model.load_state_dict(ck["model"])
    return model.eval(), ck


def score(methods, test_by, words, decode, device):
    """methods: {이름: {단어: 동작}} → 이름별 부위별 test 화자 평균 성적과 사람 상한."""
    people = sorted({s for w in words for s in test_by[w]})
    refs = {p: [(w, decode(t)) for w in words for t in test_by[w].get(p, [])] for p in people}
    result = {"people": people, "words": len(words), "methods": {}, "real_person_ceiling": {}}

    def rank_against(queries, query_words, person, part):
        ref_words = [w for w, _ in refs[person]]
        motions = np.stack([m for _, m in refs[person]])
        keep = [i for i, w in enumerate(query_words) if w in set(ref_words)]
        dist = torch_distances(np.stack([queries[i] for i in keep]), motions, part, device)
        return word_ranks(dist, ref_words, [query_words[i] for i in keep], sorted(set(ref_words)))

    def average(parts_by_person):
        rows = [summarize(*r) for r in parts_by_person]
        return {k: float(np.mean([r[k] for r in rows])) for k in rows[0]}

    for name, motions in methods.items():
        q_words = [w for w in words if w in motions]
        queries = [motions[w] for w in q_words]
        result["methods"][name] = {part_name: average([rank_against(queries, q_words, p, part) for p in people])
                                   for part_name, part in PARTS.items()}
    for part_name, part in PARTS.items():
        runs = []
        for p in people:
            for other in people:
                if other != p:
                    runs.append(rank_against([m for _, m in refs[p]], [w for w, _ in refs[p]], other, part))
        result["real_person_ceiling"][part_name] = average(runs)
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("checkpoint", "vq", "tokens", "data", "split-file", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--guidance", type=float, nargs="+", default=[1.0, 2.0, 3.0])
    ap.add_argument("--min-len", type=int, default=8, help="최소 길이 설정 비교용(토큰 수)")
    ap.add_argument("--samples", type=int, default=5, help="대표 고르기에 쓸 생성 개수")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = ap.parse_args(argv)

    import torch
    from gen.data import select_data
    from gen.gen_match import vq_decoder
    from vq.model import load_vqvae
    started = time.time()
    model, ck = load_quick_fit(args.checkpoint, args.device)
    decode = vq_decoder(load_vqvae(args.vq)[0].to(args.device).eval(), args.device)
    sel = select_data(args.tokens, str(Path(args.data) / "meta.jsonl"), args.split_file, mode="formal")
    words = sorted(ck["classes"], key=ck["classes"].get)
    test_by = defaultdict(lambda: defaultdict(list))
    for r in sel.partitions["test"]:
        test_by[r["item"]][r["signer"]].append(r["tokens"])
    gen_signer = ck["generation_signer"]
    retrieval, from_gen_signer = {}, set()  # 생성 화자의 클립을 우선, 없으면 다른 train 화자의 첫 클립
    for r in sel.train:
        if r["item"] in from_gen_signer:
            continue
        if r["signer"] == gen_signer:
            retrieval[r["item"]] = r["tokens"]
            from_gen_signer.add(r["item"])
        else:
            retrieval.setdefault(r["item"], r["tokens"])

    def generate(guidance, seed, min_len):
        torch.manual_seed(seed)
        out = []
        for s in range(0, len(words), args.batch):
            cond = torch.tensor([ck["classes"][w] for w in words[s:s + args.batch]], device=args.device)
            sig = torch.full_like(cond, ck["signers"][gen_signer])
            out += model.generate(cond, sig, **(SAMPLING | {"min_len": min_len}), guidance=guidance)
        return dict(zip(words, out))

    tokens = {"retrieval": retrieval}
    for g in args.guidance:
        tokens[f"gen_g{g:g}"] = generate(g, 17, SAMPLING["min_len"])
    best_g = 2.0 if 2.0 in args.guidance else args.guidance[0]
    tokens[f"gen_g{best_g:g}_min{args.min_len}"] = generate(best_g, 17, args.min_len)
    samples = [generate(best_g, 17 + k, args.min_len) for k in range(args.samples)]
    print(json.dumps({"generated": list(tokens), "seconds": round(time.time() - started, 1)}), flush=True)

    methods = {name: {w: decode(t) for w, t in seqs.items()} for name, seqs in tokens.items()}
    picked = {}
    for w in words:
        motions = [decode(s[w]) for s in samples]
        picked[w] = motions[medoid(motions, PARTS["body_hands55"])]
    methods[f"gen_g{best_g:g}_min{args.min_len}_medoid{args.samples}"] = picked
    lengths = {name: float(np.mean([len(t) for t in seqs.values()])) for name, seqs in tokens.items()}
    result = {"checkpoint": str(Path(args.checkpoint).resolve()), "step": ck.get("step"),
              "generation_signer": gen_signer, "sampling": SAMPLING, "token_length_mean": lengths,
              **score(methods, test_by, words, decode, args.device),
              "seconds": round(time.time() - started, 1)}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, r in result["methods"].items():
        print(json.dumps({name: {k: (round(v["top1"], 3), round(v["top5"], 3)) for k, v in r.items()}}), flush=True)
    print(json.dumps({"ceiling": {k: (round(v["top1"], 3), round(v["top5"], 3))
                                  for k, v in result["real_person_ceiling"].items()}}), flush=True)


if __name__ == "__main__":
    main()
