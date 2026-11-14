"""번역기 평가: B0(규칙만)과 전체(B0 + 학습)를 나란히.

    python -m gen.translate.evaluate --model <translator.json> --pairs <엑셀> \
        [--split val|test] [--strict] [--out result.json] [--errors errors.jsonl]

--split test(heldout)는 설정을 다 고른 뒤 마지막에 한 번만 잰다.
출력은 집계 숫자만이다. --errors 파일(원문 포함)은 커밋하지 않고 사람이 직접 읽는다.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import argparse
import json
import time
from pathlib import Path

from gen.translate import metrics
from gen.translate.pairs import load_meta_gloss, read_pairs, references, split_pairs
from gen.translate.translator import load_translator

ML = Path(__file__).resolve().parents[2]


def load_split(pairs_path, split, heldout_path=None, val_path=None, sen_meta=None, strict=False):
    pairs = read_pairs(pairs_path)
    heldout = json.loads(Path(heldout_path or ML / "splits/full_sen.json").read_text(encoding="utf-8"))
    heldout = heldout.get("heldout_sentences", heldout)
    val = json.loads(Path(val_path or ML / "gen/splits/sen_val_v1.json").read_text(encoding="utf-8"))["items"]
    meta = load_meta_gloss(sen_meta) if sen_meta else None
    parts = split_pairs(pairs, heldout, val, meta, strict=strict)
    return parts if split is None else parts[split]


def evaluate(translator, eval_pairs, mode=None, multi=False, n_boot=1000):
    preds, units, unknown, n_content = [], [], 0, 0
    t0 = time.perf_counter()
    outs = []
    for p in eval_pairs:
        out = translator.translate(p["korean"], mode=mode)
        outs.append(out)
        preds.append(out["gloss"])
        units.append(out["units"])
        unknown += len(out["unknown"])
        n_content += len(out["unknown"]) + len(out["gloss"])
    ms = (time.perf_counter() - t0) * 1000 / max(1, len(eval_pairs))
    refs = references(eval_pairs, multi=multi)
    stats = [metrics.sentence_stats(pr, r) for pr, r in zip(preds, refs)]
    row = metrics.aggregate(stats)
    lo, hi = metrics.bootstrap_f1(stats, n_boot=n_boot)
    row.update({"f1_lo": lo, "f1_hi": hi, "drawable": metrics.drawable_ratio(units),
                "unknown_per_sent": unknown / max(1, len(eval_pairs)), "ms_per_sent": ms,
                "mean_len_pred": sum(map(len, preds)) / max(1, len(preds)),
                "mean_len_ref": sum(len(p["gloss"]) for p in eval_pairs) / max(1, len(eval_pairs))})
    return row, outs


def table_md(rows):
    head = "| 설정 | n | 정밀도 | 재현율 | F1 (95% 구간) | WER | 완전 일치 | 그릴 수 있는 비율 | unknown/문장 | ms/문장 |"
    lines = [head, "|" + "---|" * 10]
    for name, r in rows:
        lines.append(f"| {name} | {r['n']} | {r['precision']:.3f} | {r['recall']:.3f} | "
                     f"{r['f1']:.3f} ({r['f1_lo']:.3f}–{r['f1_hi']:.3f}) | {r['wer']:.3f} | {r['exact']:.3f} | "
                     f"{r['drawable']:.3f} | {r['unknown_per_sent']:.2f} | {r['ms_per_sent']:.2f} |")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--pairs", required=True)
    p.add_argument("--split", default="val", choices=["val", "test", "train"])
    p.add_argument("--heldout")
    p.add_argument("--val")
    p.add_argument("--sen-meta")
    p.add_argument("--strict", action="store_true", help="학습 쪽 분할 규칙과 맞추려고 같이 넘긴다(평가 세트는 같다)")
    p.add_argument("--multi-ref", action="store_true", help="같은 세트 안 같은 한국어 문장의 번역을 모두 정답으로")
    p.add_argument("--out")
    p.add_argument("--errors")
    a = p.parse_args()
    t = load_translator(a.model)
    data = load_split(a.pairs, a.split, a.heldout, a.val, a.sen_meta, a.strict)
    rows = []
    for name, mode in (("B0 규칙만", "rules"), ("전체 (B0+학습)", None)):
        row, outs = evaluate(t, data, mode=mode, multi=a.multi_ref)
        rows.append((name, row))
        if a.errors and mode is None:
            with open(a.errors, "w", encoding="utf-8") as fh:
                for pair, out in zip(data, outs):
                    if metrics.normalize(out["gloss"]) != metrics.normalize(pair["gloss"]):
                        fh.write(json.dumps({"id": pair["id"], "korean": pair["korean"], "ref": pair["gloss"],
                                             "pred": out["gloss"], "unknown": out["unknown"]},
                                            ensure_ascii=False) + "\n")
    print(f"split={a.split} analyzer={t.config['analyzer']} multi_ref={a.multi_ref}")
    print(table_md(rows))
    if a.out:
        Path(a.out).write_text(json.dumps({"split": a.split, "model": a.model, "config": t.config,
                                           "weights": t.weights, "rows": dict(rows)}, ensure_ascii=False, indent=1),
                               encoding="utf-8")


if __name__ == "__main__":
    main()
