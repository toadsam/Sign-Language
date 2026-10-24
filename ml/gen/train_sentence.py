"""문장 단위 받아쓰기 모델 학습: 형태소(글로스) 열 → 자모 토큰 열.

정식 데이터 (문장 라벨이 있을 때):
  python -m gen.train_sentence --tokens <tokens.json> --data <SEN-dir> --sentences <sentences.jsonl> --split <split.json> --vq-checkpoint <model.pt> --vq-version v0.3-e5 --run <new-run>
  sentences.jsonl 한 줄 = {"clip": "SEN0001_REAL01", "gloss": ["화장실", "있다"], "nonmanual": ["의문"]}

코드 확인용 (문장 데이터가 없을 때, 단어 토큰을 이어 가짜 문장을 만든다):
  python -m gen.train_sentence --tokens data/sample/tokens.json --synthetic --run runs/gen_sent_smoke --iters 300

가짜 문장은 단어 사이 전환이 실제 수어와 달라서 품질 평가에는 쓰면 안 된다.
"""
import argparse
import json
import os
import time

import numpy as np
from gen.data import (DataValidationError, Selection, _positive_int, _read,
                      select_data, source_symbols)


def build_pairs(tokens_path, sentences_path, synthetic, rng, n_synth=400, *,
                data_dir=None, meta_path=None, split_path=None, mode=None,
                return_selection=False):
    """Preserve the three-value return; formal SEN needs metadata and a split.

    --synthetic is a separate smoke path, never evidence of sentence quality.
    return_selection=True appends the Selection for local run provenance.
    """
    mode = mode or ("smoke" if synthetic else "formal")
    if synthetic:
        if mode != "smoke":
            raise DataValidationError("synthetic_mode", "synthetic data requires smoke mode")
        sources = {}
        tk = _read(tokens_path, sources, "tokens_sha256")
        nb = _positive_int(tk.get("nb_code"), "nb_code")
        _positive_int(tk.get("down"), "down")
        words = [(v["item"], v["tokens"]) for v in tk["clips"].values() if v["type"] == "WORD"]
        if len(words) < 2 or n_synth <= 0:
            raise DataValidationError("synthetic_input", "need at least two WORD clips and positive n_synth")
        if any(not t or any(type(i) is not int or not 0 <= i < nb for i in t) for _, t in words):
            raise DataValidationError("invalid_tokens", "synthetic WORD tokens")
        pairs = []
        for i in range(n_synth):
            count = int(rng.integers(2, min(3, len(words)) + 1))
            pick = [words[j] for j in rng.choice(len(words), size=count, replace=False)]
            pairs.append({"clip": f"SYN{i:06d}", "gloss": [w for w, _ in pick], "nonmanual": [], "signer": "SYN",
                          "tokens": sum((t for _, t in pick), [])})
        vocab = {"<pad>": 0}
        vocab.update({g: i for i, g in enumerate(sorted({g for p in pairs for g in p["gloss"]}), 1)})
        partitions = {k: [] for k in ("train", "val", "test", "holdout_train", "holdout_val", "holdout_test")}
        partitions["train"] = pairs
        report = {"schema_version": 1, "data_mode": "smoke", "kind": "synthetic",
                  "policy": {"synthetic": True, "quality_evaluation": False},
                  "sources": {**sources, "split_sha256": None, "meta_sha256": {}, "sentences_sha256": None},
                  "counts": {k: len(v) for k, v in partitions.items()},
                  "clips": {k: [p["clip"] for p in v] for k, v in partitions.items()},
                  "source_word_clips": sorted(c for c, v in tk["clips"].items() if v["type"] == "WORD"),
                  "vocab": vocab, "signers": {"SYN": 0}, "generation_signer": "SYN"}
        selection = Selection(tk, partitions, {}, {"SYN": 0}, vocab, report)
    else:
        if meta_path is None and data_dir is None:
            raise DataValidationError("metadata_required", "provide data_dir or meta_path")
        selection = select_data(tokens_path, meta_path or os.path.join(data_dir, "meta.jsonl"),
                                split_path, kind="SEN", mode=mode, sentences_path=sentences_path)
    result = (selection.tokens["nb_code"], selection.train, selection.vocab)
    return (*result, selection) if return_selection else result


def encode_src(p, vocab, max_src):
    symbols = source_symbols(p)
    unknown = [s for s in symbols if s not in vocab or vocab[s] == 0]
    if unknown:
        raise DataValidationError("source_oov", ", ".join(unknown))
    if len(symbols) > max_src:
        raise DataValidationError("source_too_long", f"{len(symbols)} > {max_src}")
    return [vocab[s] for s in symbols]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--sentences", default=None)
    ap.add_argument("--data", help="SEN metadata directory; required unless --synthetic")
    ap.add_argument("--split", help="formal: explicit fixed signer split JSON")
    ap.add_argument("--data-mode", choices=["formal", "smoke"], default=None)
    ap.add_argument("--vq-checkpoint", help="explicit decoder model.pt; required for formal runs")
    ap.add_argument("--vq-version", help="declared decoder version; required for formal runs")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=20000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--corrupt", type=float, default=0.3)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    if not args.synthetic and not args.sentences:
        raise SystemExit("--sentences 파일이 필요합니다. 문장 데이터가 없으면 --synthetic 으로 코드만 확인하세요.")

    from gen.artifacts import prepare_run
    from gen.model import SentenceToMotion
    import torch
    import torch.nn.functional as F

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    nb, pairs, vocab, selection = build_pairs(
        args.tokens, args.sentences, args.synthetic, rng, data_dir=args.data,
        split_path=args.split, mode=args.data_mode, return_selection=True)
    manifest = prepare_run(selection, args.run, vq_path=args.vq_checkpoint, vq_version=args.vq_version)
    signers = {s: i for i, s in enumerate(sorted({p["signer"] for p in pairs}))}
    max_src = max(len(source_symbols(p)) for p in pairs) + 2
    max_len = max(len(p["tokens"]) for p in pairs) + 8
    print(f"문장 {len(pairs)}개{' (가짜)' if args.synthetic else ''} · 어휘 {len(vocab)} · 수행자 {len(signers)} · 최대 토큰 {max_len - 8}")

    model = SentenceToMotion(len(vocab), nb, args.d, args.layers, max_src=max_src, max_len=max_len, n_signer=len(signers))
    print(f"파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.iters, pct_start=0.1)

    t0 = time.time()
    for it in range(1, args.iters + 1):
        batch = [pairs[i] for i in rng.integers(len(pairs), size=args.batch)]
        S = max(len(encode_src(p, vocab, max_src)) for p in batch)
        L = max(len(p["tokens"]) for p in batch)
        src = torch.zeros(len(batch), S, dtype=torch.long)
        inp = torch.full((len(batch), L), model.pad, dtype=torch.long)
        tgt = torch.full((len(batch), L + 1), -100, dtype=torch.long)
        for b, p in enumerate(batch):
            ids = encode_src(p, vocab, max_src)
            src[b, :len(ids)] = torch.tensor(ids)
            t = torch.tensor(p["tokens"])
            r = rng.uniform(0, args.corrupt)
            inp[b, :len(t)] = torch.where(torch.rand(len(t)) < r, torch.randint(0, nb, (len(t),)), t)
            tgt[b, :len(t)] = t
            tgt[b, len(t)] = model.end
        sig = torch.tensor([signers[p["signer"]] for p in batch])
        logits = model(src, inp, sig)
        loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1), ignore_index=-100)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if it % 100 == 0:
            print(f"[{it:5d}] loss {loss.item():.4f}  ({time.time() - t0:.0f}s)")

    torch.save({"model": model.state_dict(), "vocab": vocab, "signers": signers, "nb_code": nb,
                "max_src": max_src, "max_len": max_len, "config": vars(args),
                "artifact_manifest": manifest}, os.path.join(args.run, "model.pt"))
    # 한 문장 생성해 보기
    p = pairs[0]
    src = torch.tensor([encode_src(p, vocab, max_src)])
    out = model.eval().generate(src, torch.tensor([signers[p["signer"]]]), top_k=5)[0]
    same = sum(a == b for a, b in zip(out, p["tokens"])) / max(len(p["tokens"]), 1)
    print(f"생성 확인: 입력 {p['gloss']} → 토큰 {len(out)}개 (정답 {len(p['tokens'])}개, 앞에서부터 일치 {same:.0%})")


if __name__ == "__main__":
    main()
