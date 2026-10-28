"""단어 맞히기 평가: 모델이 단어를 구별하는지 직접 잰다. 학습·생성은 하지 않는다.

클립 하나의 토큰 열을 고정하고, 3000개 단어 조건 각각에서 그 열이 나올 NLL을 계산한다.
정답 단어의 NLL이 몇 등인지(top1/5/10, 평균 순위, MRR)를 보고한다. 우연 수준 top1 = 1/단어 수.
위치별 조건 이득(전체 조건 평균 NLL − 정답 조건 NLL)으로 단어 정보가 어느 위치에서 쓰이는지도 본다.

비교 기준선(bow): 토큰 등장 횟수 tf-idf 코사인으로 train 클립 1-NN과 단어 평균(centroid) 분류.
토큰 열 자체에 단어 정보가 얼마나 남아 있는지의 참고치다.

  python -m gen.rank_words --checkpoint .../model.pt --tokens .../tokens_e5.json \
      --data .../full --split-file splits/full.json --split val --device cuda --out .../rank_val.json
"""
import argparse
import json
from pathlib import Path
import sys
import time

import numpy as np


def score_clip(model, tokens, signer, n_cond, chunk=1024):
    """토큰 열 하나를 모든 조건으로 채점 → (조건별 총 NLL [n_cond], 위치별 NLL [n_cond, L+1])."""
    import torch
    device = next(model.parameters()).device
    x = torch.tensor(tokens, dtype=torch.long, device=device)[None]
    target = torch.tensor(tokens + [model.end], dtype=torch.long, device=device)
    positions = torch.arange(len(target), device=device)
    out = []
    with torch.inference_mode():
        for start in range(0, n_cond, chunk):
            cond = torch.arange(start, min(start + chunk, n_cond), device=device)
            sig = None if signer is None else torch.full_like(cond, signer)
            logp = model(cond, x.expand(len(cond), -1), sig).log_softmax(-1)
            out.append(-logp[:, positions, target])
    per_pos = torch.cat(out).float().cpu().numpy()
    return per_pos.sum(1), per_pos


def rank_metrics(ranks, n_cond):
    ranks = np.asarray(ranks)
    return {"clips": int(len(ranks)), "conditions": n_cond, "chance_top1": 1 / n_cond,
            **{f"top{k}": float((ranks <= k).mean()) for k in (1, 5, 10, 100)},
            "mean_rank": float(ranks.mean()), "median_rank": float(np.median(ranks)),
            "mrr": float((1 / ranks).mean())}


def evaluate_model(model, rows, classes, signer_of, *, chunk=1024, max_pos=12):
    """rows의 각 클립에서 정답 단어의 순위와 위치별 조건 이득을 모은다."""
    n_cond = len(classes)
    ranks, gain_sum, gain_n = [], np.zeros(max_pos), np.zeros(max_pos)
    for row in rows:
        total, per_pos = score_clip(model, row["tokens"], signer_of(row), n_cond, chunk)
        c = classes[row["item"]]
        ranks.append(1 + int((total < total[c]).sum()))
        gain = per_pos.mean(0) - per_pos[c]
        k = min(max_pos, len(gain))
        gain_sum[:k] += gain[:k]
        gain_n[:k] += 1
    gain = np.where(gain_n > 0, gain_sum / np.maximum(gain_n, 1), np.nan)
    return rank_metrics(ranks, n_cond) | {
        "condition_gain_by_position": [None if np.isnan(g) else float(g) for g in gain],
        "gain_note": "mean NLL over all conditions - correct NLL, nats; positive = word helps"}, ranks


def bag_of_tokens(rows, nb_code):
    m = np.zeros((len(rows), nb_code), dtype=np.float32)
    for i, row in enumerate(rows):
        np.add.at(m[i], row["tokens"], 1)
    return m


def bow_baseline(train, evaluated, classes, nb_code):
    """tf-idf 코사인 1-NN / centroid로 단어를 맞힌다(top1, top5)."""
    tr, ev = bag_of_tokens(train, nb_code), bag_of_tokens(evaluated, nb_code)
    idf = np.log((1 + len(tr)) / (1 + (tr > 0).sum(0))) + 1
    norm = lambda m: (m * idf) / np.maximum(np.linalg.norm(m * idf, axis=1, keepdims=True), 1e-8)
    tr, ev = norm(tr), norm(ev)
    labels = np.array([classes[r["item"]] for r in train])
    truth = np.array([classes[r["item"]] for r in evaluated])
    centroid = np.zeros((len(classes), nb_code), dtype=np.float32)
    np.add.at(centroid, labels, tr)
    centroid /= np.maximum(np.linalg.norm(centroid, axis=1, keepdims=True), 1e-8)
    result = {}
    for name, ref, ref_labels in (("nn1", tr, labels), ("centroid", centroid, np.arange(len(classes)))):
        hits1, hits5 = 0, 0
        for start in range(0, len(ev), 512):
            sim = ev[start:start + 512] @ ref.T
            # 단어별 최고 유사도로 모은 뒤 순위를 매긴다
            best = np.full((len(sim), len(classes)), -np.inf, dtype=np.float32)
            for j in range(len(sim)):
                np.maximum.at(best[j], ref_labels, sim[j])
            top = np.argsort(-best, axis=1)[:, :5]
            t = truth[start:start + 512]
            hits1 += int((top[:, 0] == t).sum())
            hits5 += int((top == t[:, None]).any(1).sum())
        result[name] = {"top1": hits1 / len(ev), "top5": hits5 / len(ev)}
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--data", required=True, help="meta.jsonl이 있는 WORD 폴더")
    ap.add_argument("--split-file", required=True)
    ap.add_argument("--split", choices=("train", "val"), default="val", help="test는 최종 평가용으로 남긴다")
    ap.add_argument("--limit", type=int, default=0, help="0이면 전체, 아니면 seed17로 고른 클립 수")
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    ap.add_argument("--chunk", type=int, default=1024)
    ap.add_argument("--no-baseline", action="store_true")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    from gen.data import select_data
    from gen.train_word import load_generator
    model, checkpoint = load_generator(args.checkpoint, args.device)
    selection = select_data(args.tokens, str(Path(args.data) / "meta.jsonl"), args.split_file, mode="formal")
    classes, signers = checkpoint["classes"], checkpoint["signers"]
    assert classes == selection.classes, "checkpoint 단어 사전과 데이터 선택 결과가 다르다"
    rows = [r for r in selection.partitions[args.split] if r["item"] in classes]
    if args.limit:
        pick = np.random.default_rng(17).choice(len(rows), min(args.limit, len(rows)), replace=False)
        rows = [rows[i] for i in sorted(pick)]
    gen_signer = signers[checkpoint["generation_signer"]]
    # train은 실제 수행자, val은 학습에 없는 수행자라 생성 때와 같은 generation_signer를 넣는다
    signer_of = (lambda r: signers[r["signer"]]) if args.split == "train" else (lambda r: gen_signer)
    if model.signer is None:
        signer_of = lambda r: None

    started = time.time()
    metrics, ranks = evaluate_model(model, rows, classes, signer_of, chunk=args.chunk)
    summary = {"checkpoint": str(Path(args.checkpoint).resolve()), "step": checkpoint.get("step"),
               "split": args.split, "limit": args.limit, "signer_rule": "actual" if args.split == "train"
               else checkpoint["generation_signer"], "model": metrics, "seconds": round(time.time() - started, 1),
               "torch_device": args.device, "python": sys.version.split()[0]}
    if not args.no_baseline:
        summary["bow_baseline"] = bow_baseline(selection.train, rows, classes, model.nb_code)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    out.with_suffix(".ranks.json").write_text(json.dumps(
        [{"clip": r["clip"], "item": r["item"], "rank": k} for r, k in zip(rows, ranks)]), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("split", "seconds")} | {
        "top1": metrics["top1"], "top5": metrics["top5"], "mean_rank": metrics["mean_rank"],
        "bow": summary.get("bow_baseline")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
