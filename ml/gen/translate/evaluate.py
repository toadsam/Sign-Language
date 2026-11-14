"""번역기 평가: B0(규칙만)과 전체(B0 + 학습)를 나란히.

    python -m gen.translate.evaluate --model <translator.json> --pairs <엑셀> \
        [--split val|test] [--strict] [--out result.json] [--errors errors.jsonl]

--suite 이면 지표 세 가지를 함께 낸다 (11-14 추가):
  기존 F1     그 문장의 엑셀 번역 하나와 비교
  여러 정답 F1 같은 한국어 문장의 사람 번역 전부(학습 · 검증 · 시험 어디에 있든) 중 가장 가까운 것과 비교
  의미 F1     여러 정답 + 글로스 표 동작 단위 같음 · 동의어 표 비슷한말이면 맞음 (metrics.Matcher, --synonyms)
  사람 기준선  같은 지표로 사람 번역끼리 (번역이 2개 이상인 한국어 문장, leave-one-out, metrics.human_baseline)

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


def all_references(eval_pairs, all_pairs):
    """평가 문장마다 같은 한국어 문장의 서로 다른 사람 번역 전부 (자기 번역이 맨 앞)."""
    by_ko = {}
    for p in all_pairs:
        lst = by_ko.setdefault(p["korean"], [])
        if p["gloss"] and p["gloss"] not in lst:
            lst.append(p["gloss"])
    out = []
    for p in eval_pairs:
        refs = [p["gloss"]] + [g for g in by_ko.get(p["korean"], []) if g != p["gloss"]]
        out.append(refs)
    return out


def human_groups(all_pairs, koreans=None):
    """한국어 문장마다 서로 다른 번역 목록 (2개 이상인 것만). koreans를 주면 그 문장만."""
    by_ko = {}
    for p in all_pairs:
        if koreans is not None and p["korean"] not in koreans:
            continue
        lst = by_ko.setdefault(p["korean"], [])
        if p["gloss"] and p["gloss"] not in lst:
            lst.append(p["gloss"])
    return [g for _k, g in sorted(by_ko.items()) if len(g) >= 2]


def make_matcher(glosses, synonyms_path=None):
    """의미 F1 판정기: 글로스 표 기본 동작 단위 + 동의어 표 by_gloss (없으면 동작 단위만)."""
    units = {n: g["default"] for n, g in glosses.items()}
    by_gloss = {}
    if synonyms_path and Path(synonyms_path).exists():
        by_gloss = json.loads(Path(synonyms_path).read_text(encoding="utf-8")).get("by_gloss", {})
    return metrics.Matcher(units, by_gloss)


def score_suite(translator, eval_pairs, all_pairs, matcher, mode=None, n_boot=1000):
    """번역 한 번으로 기존 / 여러 정답 / 의미 F1 세 줄."""
    outs = [translator.translate(p["korean"], mode=mode) for p in eval_pairs]
    preds = [o["gloss"] for o in outs]
    multi = all_references(eval_pairs, all_pairs)
    rows = {}
    for name, refs, m in (("기존 F1", [[p["gloss"]] for p in eval_pairs], None),
                          ("여러 정답 F1", multi, None), ("의미 F1", multi, matcher)):
        stats = [metrics.sentence_stats(pr, r, m) for pr, r in zip(preds, refs)]
        row = metrics.aggregate(stats)
        row["f1_lo"], row["f1_hi"] = metrics.bootstrap_f1(stats, n_boot=n_boot)
        row["unknown_per_sent"] = sum(len(o["unknown"]) for o in outs) / max(1, len(outs))
        row["substituted_per_sent"] = sum(len(o.get("substituted", [])) for o in outs) / max(1, len(outs))
        rows[name] = row
    # 사람 기준선과 같은 조건: 번역이 2개 이상인 문장만, 그 문장 자기 번역은 빼고 나머지 번역을 정답 후보로
    loo = [(pr, r[1:]) for pr, r in zip(preds, multi) if len(r) >= 2]
    for name, m in (("여러 정답 F1 (사람과 같은 조건)", None), ("의미 F1 (사람과 같은 조건)", matcher)):
        stats = [metrics.sentence_stats(pr, r, m) for pr, r in loo]
        row = metrics.aggregate(stats)
        row["f1_lo"], row["f1_hi"] = metrics.bootstrap_f1(stats, n_boot=n_boot)
        rows[name] = row
    rows["_refs_per_sent"] = sum(map(len, multi)) / max(1, len(multi))
    return rows, outs


def suite_md(rows):
    lines = ["| 대상 | 지표 | n | 정밀도 | 재현율 | F1 (95% 구간) | WER | unknown/문장 |", "|" + "---|" * 8]
    for who, rs in rows:
        for metric, r in rs.items():
            if metric.startswith("_"):
                continue
            ci = f" ({r['f1_lo']:.3f}–{r['f1_hi']:.3f})" if "f1_lo" in r else ""
            unk = f"{r['unknown_per_sent']:.2f}" if "unknown_per_sent" in r else "–"
            lines.append(f"| {who} | {metric} | {r['n']} | {r['precision']:.3f} | {r['recall']:.3f} | "
                         f"{r['f1']:.3f}{ci} | {r['wer']:.3f} | {unk} |")
    return "\n".join(lines)


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
    p.add_argument("--suite", action="store_true", help="기존 / 여러 정답 / 의미 F1 + 사람 기준선")
    p.add_argument("--synonyms", help="의미 F1에 쓸 동의어 표 (번역기에도 붙인다)")
    p.add_argument("--out")
    p.add_argument("--errors")
    a = p.parse_args()
    t = load_translator(a.model, synonyms=a.synonyms)
    if a.suite:
        parts = load_split(a.pairs, None, a.heldout, a.val, a.sen_meta, a.strict)
        all_pairs = read_pairs(a.pairs)  # strict여도 정답 후보는 2,000쌍 전부에서 모은다
        data = parts[a.split]
        matcher = make_matcher(t.glosses, a.synonyms)
        rows, _ = score_suite(t, data, all_pairs, matcher)
        b0, _ = score_suite(t, data, all_pairs, matcher, mode="rules")
        hb = metrics.human_baseline(human_groups(all_pairs, {p["korean"] for p in data}), matcher)
        human = {"기존 F1": hb["single"], "여러 정답 F1": hb["multi"], "의미 F1": hb["semantic"]}
        print(f"split={a.split} human_groups={hb['groups']}")
        print(suite_md([("번역기", rows), ("B0 규칙만", b0), ("사람 기준선", human)]))
        if a.out:
            Path(a.out).write_text(json.dumps({"split": a.split, "model": a.model, "translator": rows, "b0": b0,
                                               "human": hb}, ensure_ascii=False, indent=1), encoding="utf-8")
        return
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
