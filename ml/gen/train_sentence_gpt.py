"""문장 GPT(P3) 학습: 단어 클립(W:<ID>) + 문장 클립(단어 구간 S:<이름> / 연결 / 휴지)을 함께 배운다.

설계 참고: sign-motion-gloss (코드 복사 없음)

  python -m gen.train_sentence_gpt --tokens /data/runs/tokens_e5.json --meta /data/full_all/meta.jsonl \
      --split splits/full_sen.json --sen-val gen/splits/sen_val_v1.json --vq /data/runs/vq_e5/model.pt \
      --run /data/runs/sent_gpt_<태그> --iters 40000 --device cuda

짧은 확인은 --iters 200. 검증(모델 고르기)은 sen_val_v1 문장 × 학습 화자의 다음 토큰 손실이다.
heldout 문장은 여기서 읽기만 하고(수 세기), 학습 · 고르기에 쓰지 않는다.

run 폴더: model.pt(가장 좋은 검증 손실), latest.pt(이어 하기), vocab.json, schedule.json,
selection.json(나누기 수 · 원본 해시 · 학습 클립 목록), log.jsonl, generator.json(VQ 경로 · 해시).
"""
import argparse
from dataclasses import asdict, dataclass
import json
import math
import os
from pathlib import Path
import time

import numpy as np
import torch
import torch.nn.functional as F

from gen.sentence_data import (NONE, NULL, build_vocab, encode_condition, load_inputs, schedule_stats, select,
                               sha256_path)
from gen.sentence_gpt import SentenceGPT


@dataclass
class Config:
    iters: int = 40000
    batch: int = 64
    lr: float = 3e-4
    warmup: int = 1000
    d: int = 384
    layers: int = 6
    heads: int = 6
    dropout: float = 0.1
    max_len: int = 128
    sen_frac: float = 0.5      # 한 묶음에서 문장 클립 비율 (나머지는 단어 클립)
    corrupt: float = 0.3       # 입력 토큰을 무작위로 바꾸는 최대 비율 (단어 GPT와 같음)
    cond_drop: float = 0.1     # 문장 전체 조건을 null로 (guidance용)
    ctx_drop: float = 0.1      # 위치마다 앞뒤 단위를 <none>으로 (처음 보는 조합 대비)
    eval_every: int = 1000
    seed: int = 0
    amp: bool = True
    use_words: bool = True


def encode_rows(rows, vocab, signers, context):
    out = []
    for r in rows:
        cur, prev, nxt = encode_condition(r["cond"], vocab, context)
        ph = np.asarray(r["phase"], dtype=np.int64).reshape(-1, 2)
        out.append({"tokens": np.asarray(r["tokens"], dtype=np.int64), "cur": np.asarray(cur), "prev": np.asarray(prev),
                    "next": np.asarray(nxt), "pa": ph[:, 0], "pb": ph[:, 1], "signer": signers[r["signer"]],
                    "type": r["type"]})
    return out


def collate(items, device, max_len):
    L = min(max_len, max(len(it["tokens"]) for it in items))
    B = len(items)
    names = ("tokens", "cur", "prev", "next", "pa", "pb")
    arr = {k: np.zeros((B, L), dtype=np.int64) for k in names}
    target = np.full((B, L), -100, dtype=np.int64)
    arr["prev"][:] = 1
    arr["next"][:] = 1
    for i, it in enumerate(items):
        n = min(L, len(it["tokens"]))
        for k in names:
            arr[k][i, :n] = it[k][:n]
        target[i, :n] = it["tokens"][:n]
    t = {k: torch.from_numpy(v).to(device) for k, v in arr.items()}
    t["target"] = torch.from_numpy(target).to(device)
    t["signer"] = torch.tensor([it["signer"] for it in items], dtype=torch.long, device=device)
    return t


def batch_loss(model, b, cfg, gen=None, training=False):
    tokens, cur, prev, nxt = b["tokens"], b["cur"], b["prev"], b["next"]
    if training:
        B, L = tokens.shape
        dev = tokens.device
        rate = torch.rand(B, 1, device=dev, generator=gen) * cfg.corrupt
        swap = torch.rand(B, L, device=dev, generator=gen) < rate
        tokens = torch.where(swap, torch.randint(0, model.nb_code, (B, L), device=dev, generator=gen), tokens)
        ctx = torch.rand(B, L, device=dev, generator=gen) < cfg.ctx_drop
        prev = torch.where(ctx, torch.ones_like(prev), prev)
        nxt = torch.where(ctx, torch.ones_like(nxt), nxt)
        drop = (torch.rand(B, 1, device=dev, generator=gen) < cfg.cond_drop).expand(B, L)
        cur = torch.where(drop, torch.zeros_like(cur), cur)
        prev = torch.where(drop, torch.ones_like(prev), prev)
        nxt = torch.where(drop, torch.ones_like(nxt), nxt)
    bos = torch.full_like(tokens[:, :1], model.bos)
    inputs = torch.cat([bos, tokens[:, :-1]], 1)
    logits = model.logits(cur, prev, nxt, b["pa"], b["pb"], b["signer"], inputs)
    return F.cross_entropy(logits.float().reshape(-1, logits.shape[-1]), b["target"].reshape(-1), ignore_index=-100)


def evaluate(model, items, cfg, device, batch=128):
    model.eval()
    total, count = 0.0, 0
    with torch.no_grad():
        for s in range(0, len(items), batch):
            b = collate(items[s:s + batch], device, cfg.max_len)
            n = int((b["target"] >= 0).sum())
            total += float(batch_loss(model, b, cfg)) * n
            count += n
    model.train()
    return total / max(count, 1)


def lr_at(step, cfg):
    if step < cfg.warmup:
        return cfg.lr * (step + 1) / cfg.warmup
    p = (step - cfg.warmup) / max(1, cfg.iters - cfg.warmup)
    return cfg.lr * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * min(p, 1.0))))


def write_json(path, value):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def prepare_run(sel, run, cfg, sources=None, vq_path=None):
    """vocab · 일정표 · 나누기 기록을 run 폴더에 쓴다. → (vocab, signers, context, stats)"""
    run = Path(run)
    run.mkdir(parents=True, exist_ok=True)
    vocab, signers, context = build_vocab(sel["train"], sel["train_signers"])
    stats = schedule_stats(sel["train"])
    write_json(run / "vocab.json", {"units": vocab, "signers": signers, "context": context,
                                    "nb_code": sel["nb_code"], "down": sel["down"]})
    write_json(run / "schedule.json", stats)
    write_json(run / "selection.json", {"counts": sel["counts"], "dropped": sel["dropped"], "sources": sources or {},
                                        "leak_check": "passed",
                                        "clips": {k: [r["clip"] for r in sel[k]] for k in ("train", "val", "test",
                                                                                          "test_signer")}})
    write_json(run / "config.json", asdict(cfg))
    if vq_path:
        write_json(run / "generator.json", {"kind": "sentence_gpt", "checkpoint": "model.pt",
                                            "vq_checkpoint": str(vq_path), "vq_sha256": sha256_path(vq_path)})
    return vocab, signers, context, stats


def save_model(path, model, cfg, vocab, signers, context, step, val):
    tmp = Path(str(path) + ".tmp")
    torch.save({"kind": "sentence_gpt", "config": asdict(cfg), "units": vocab, "signers": signers,
                "context": context, "nb_code": model.nb_code, "step": step, "val_loss": val,
                "model": {k: v.detach().cpu() for k, v in model.state_dict().items()}}, tmp)
    os.replace(tmp, path)


def train(sel, run, cfg, device="cpu", sources=None, vq_path=None, resume=False, log_every=100):
    run = Path(run)
    vocab, signers, context, _ = prepare_run(sel, run, cfg, sources, vq_path)
    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)
    device = torch.device(device)
    model = SentenceGPT(len(vocab), sel["nb_code"], cfg.d, cfg.layers, cfg.heads, cfg.max_len, len(signers),
                        cfg.dropout).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=0.01, betas=(0.9, 0.99))
    use_amp = cfg.amp and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    gen = torch.Generator(device=device).manual_seed(cfg.seed)
    train_items = encode_rows(sel["train"], vocab, signers, context)
    sen = [it for it in train_items if it["type"] == "SEN"]
    word = [it for it in train_items if it["type"] == "WORD"]
    val_items = encode_rows(sel["val"], vocab, signers, context)
    if not sen:
        raise ValueError("no sentence clips in train")
    step, best = 0, None
    if resume and (run / "latest.pt").exists():
        ck = torch.load(run / "latest.pt", map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        scaler.load_state_dict(ck["scaler"])
        step, best = ck["step"], ck["best"]
        rng.bit_generator.state = ck["rng"]
        gen.set_state(ck["gen"].to(gen.get_state().device) if hasattr(ck["gen"], "to") else ck["gen"])
    n_sen = max(1, int(round(cfg.batch * cfg.sen_frac))) if word else cfg.batch
    started, seen = time.time(), 0
    model.train()
    with open(run / "log.jsonl", "a", encoding="utf-8") as log:
        while step < cfg.iters:
            picks = [sen[i] for i in rng.integers(len(sen), size=n_sen)]
            if word and cfg.batch > n_sen:
                picks += [word[i] for i in rng.integers(len(word), size=cfg.batch - n_sen)]
            b = collate(picks, device, cfg.max_len)
            for g in opt.param_groups:
                g["lr"] = lr_at(step, cfg)
            with torch.autocast(device.type, dtype=torch.float16, enabled=use_amp):
                loss = batch_loss(model, b, cfg, gen, training=True)
            if not torch.isfinite(loss):
                raise RuntimeError("nonfinite training loss")
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            step += 1
            seen += 1
            if step % log_every == 0 and step % cfg.eval_every:
                log.write(json.dumps({"step": step, "train_loss": round(loss.item(), 4),
                                      "sec_per_step": round((time.time() - started) / seen, 4)}) + "\n")
                log.flush()
            if step % cfg.eval_every == 0 or step == cfg.iters:
                val = evaluate(model, val_items, cfg, device) if val_items else None
                if best is None or (val is not None and val < best):
                    best = val
                    save_model(run / "model.pt", model, cfg, vocab, signers, context, step, val)
                entry = {"step": step, "train_loss": round(loss.item(), 4), "val_loss": val, "best": best,
                         "lr": opt.param_groups[0]["lr"], "sec_per_step": round((time.time() - started) / seen, 4)}
                log.write(json.dumps(entry) + "\n")
                log.flush()
                torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "scaler": scaler.state_dict(),
                            "step": step, "best": best, "rng": rng.bit_generator.state, "gen": gen.get_state()},
                           run / "latest.pt.tmp")
                os.replace(run / "latest.pt.tmp", run / "latest.pt")
    return {"step": step, "best_val_loss": best, "sec_per_step": (time.time() - started) / max(seen, 1),
            "train_clips": len(train_items), "train_sen": len(sen), "train_word": len(word), "val_clips": len(val_items)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("tokens", "meta", "split", "sen-val", "run"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--vq", help="run 폴더 generator.json에 적을 VQ 디코더 경로")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--resume", action="store_true")
    for field, value in asdict(Config()).items():
        flag = "--" + field.replace("_", "-")
        if isinstance(value, bool):
            ap.add_argument(flag, type=lambda s: s.lower() in ("1", "true", "yes"), default=value)
        else:
            ap.add_argument(flag, type=type(value), default=value)
    a = ap.parse_args(argv)
    cfg = Config(**{f: getattr(a, f) for f in asdict(Config())})
    tokens, metas, split, sen_val, sources = load_inputs(a.tokens, a.meta, a.split, a.sen_val)
    sel = select(tokens, metas, split, sen_val, use_words=cfg.use_words)
    print(json.dumps({"counts": sel["counts"], "dropped": sel["dropped"]}), flush=True)
    result = train(sel, a.run, cfg, a.device, sources, a.vq, resume=a.resume)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
