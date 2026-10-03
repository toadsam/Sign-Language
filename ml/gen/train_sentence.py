"""문장 단위 받아쓰기 모델 학습: 형태소(글로스) 열 → 자모 토큰 열.

정식 데이터 (문장 라벨이 있을 때):
  python -m gen.train_sentence --tokens data/full/tokens.json --sentences data/full/sentences.jsonl --run runs/gen_sent
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
import torch
import torch.nn.functional as F

from gen.model import SentenceToMotion


def build_pairs(tokens_path, sentences_path, synthetic, rng, n_synth=400):
    tk = json.load(open(tokens_path, encoding="utf-8"))
    clips = tk["clips"]
    pairs = []
    if synthetic:
        words = [(v["item"], v["tokens"]) for v in clips.values() if v["type"] == "WORD"]
        for _ in range(n_synth):
            pick = [words[i] for i in rng.choice(len(words), size=rng.integers(2, 4), replace=False)]
            pairs.append({"gloss": [w for w, _ in pick], "nonmanual": [], "signer": "SYN",
                          "tokens": sum((t for _, t in pick), [])})
    else:
        for line in open(sentences_path, encoding="utf-8"):
            s = json.loads(line)
            if s["clip"] in clips:
                pairs.append({**s, "signer": clips[s["clip"]]["signer"], "tokens": clips[s["clip"]]["tokens"]})
    vocab = {"<pad>": 0}
    for p in pairs:
        for g in p["gloss"] + [f"<{n}>" for n in p.get("nonmanual", [])]:
            vocab.setdefault(g, len(vocab))
    return tk["nb_code"], pairs, vocab


def encode_src(p, vocab, max_src):
    ids = [vocab.get(g, 0) for g in p["gloss"]] + [vocab.get(f"<{n}>", 0) for n in p.get("nonmanual", [])]
    return ids[:max_src]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--sentences", default=None)
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

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)
    nb, pairs, vocab = build_pairs(args.tokens, args.sentences, args.synthetic, rng)
    signers = {s: i for i, s in enumerate(sorted({p["signer"] for p in pairs}))}
    max_src = max(len(encode_src(p, vocab, 64)) for p in pairs) + 2
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
                "max_src": max_src, "max_len": max_len, "config": vars(args)}, os.path.join(args.run, "model.pt"))
    # 한 문장 생성해 보기
    p = pairs[0]
    src = torch.tensor([encode_src(p, vocab, max_src)])
    out = model.eval().generate(src, torch.tensor([signers[p["signer"]]]), top_k=5)[0]
    same = sum(a == b for a, b in zip(out, p["tokens"])) / max(len(p["tokens"]), 1)
    print(f"생성 확인: 입력 {p['gloss']} → 토큰 {len(out)}개 (정답 {len(p['tokens'])}개, 앞에서부터 일치 {same:.0%})")


if __name__ == "__main__":
    main()
