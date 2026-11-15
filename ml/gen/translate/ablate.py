"""검증 문장(sen_val_v1)에서 설정별 비교 (ablation). 설정마다 학습 → 가중치 조정 → 검증 채점.

    python -m gen.translate.ablate --pairs <엑셀> --gloss-table <표> [--sen-meta <meta>] \
        [--set v2|recall] [--synonyms <synonyms_v1.json>] [--out result.json]

--set v2      11-14 첫 비교 (언어 모델, 어미 단위, 구 길이, 앵커, 규칙 후보, strict)
--set recall  재현율 개선 비교. 바탕은 v2에서 고른 설정(madi, 어미 단위 뺌, 구 길이 2)이고
              기본 학습 · strict 학습 둘 다 잰다
heldout은 읽지 않는다. 출력은 집계 숫자만.
설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import argparse
import collections
import json
from pathlib import Path

from gen.translate.evaluate import all_references, evaluate, load_split, make_matcher, score_suite, table_md
from gen.translate.pairs import read_pairs
from gen.translate.synonyms import load_synonyms
from gen.translate.train import GRID, tune
from gen.translate.translator import build_translator

GRID_V2 = {k: v for k, v in GRID.items() if k not in ("shrink", "syn")}

# (이름, 설정, strict, 조정 격자, 목표)
SETS = {
    "v2": [
        ("기본", {}, False, GRID_V2, "f1wer"),
        ("− 언어 모델", {"use_lm": False}, False, GRID_V2, "f1wer"),
        ("− 어미 단위", {"keep_endings": False}, False, GRID_V2, "f1wer"),
        ("구 길이 1", {"max_src": 1}, False, GRID_V2, "f1wer"),
        ("구 길이 2", {"max_src": 2}, False, GRID_V2, "f1wer"),
        ("− 어미 단위, 구 길이 2", {"keep_endings": False, "max_src": 2}, False, GRID_V2, "f1wer"),
        ("− 규칙 앵커 정렬", {"anchor": False}, False, GRID_V2, "f1wer"),
        ("− 규칙 후보", {"use_rules": False}, False, GRID_V2, "f1wer"),
        ("strict 학습", {}, True, GRID_V2, "f1wer"),
    ],
}
_BASE = {"keep_endings": False, "max_src": 2}
_RECALL = [
    ("v2 (개선 전)", {}, GRID_V2, "f1wer"),
    ("① 줄임 특징", {}, GRID, "f1wer"),
    ("① 생략 ≥0.5", {"content_drop_min": 0.5}, GRID, "f1wer"),
    ("① 생략 ≥0.8", {"content_drop_min": 0.8}, GRID, "f1wer"),
    ("① 생략 ≥0.95", {"content_drop_min": 0.95}, GRID, "f1wer"),
    ("① 생략 ≥0.8 + 합성어", {"content_drop_min": 0.8, "use_split": True}, GRID, "f1wer"),
    ("① 생략 ≥0.8 + 합성어, 목표 F1", {"content_drop_min": 0.8, "use_split": True}, GRID, "f1"),
]
SETS["recall"] = [(f"{n} / {'strict' if s else '기본'}", {**_BASE, **c}, s, g, o)
                  for s in (False, True) for n, c, g, o in _RECALL]
# ①은 검증에서 고른 것(줄임 특징만)을 바탕으로 동의어를 더한다
SETS["synonyms"] = [(f"{n} / {'strict' if s else '기본'}", {**_BASE, **c}, s, GRID, "f1wer")
                    for s in (False, True)
                    for n, c in (("① 줄임 특징", {}), ("①+② 동의어", {"use_synonyms": True}),
                                 ("①+② 동의어 + 합성어", {"use_synonyms": True, "use_split": True}))]

# 11-14 저녁: 빠짐 줄이기. 바탕은 v3(줄임 특징). 골라 쓰는 기준은 여러 정답 재현율(정밀도가 0.05 넘게 떨어지지 않게)
_V4 = [
    ("v3 (개선 전)", {}, "f1wer"),
    ("v3, 여러 정답으로 조정", {}, "multi:f1wer"),
    ("내용어 지키기", {"content_keep": True}, "multi:f1wer"),
    ("내용어 지키기 (생략 ≥0.9는 허용)", {"content_keep": True, "keep_drop_prob": 0.9}, "multi:f1wer"),
    ("내용어 지키기 + 붙여 찾기", {"content_keep": True, "use_join": True}, "multi:f1wer"),
    ("내용어 지키기 (≥0.9 허용) + 붙여 찾기", {"content_keep": True, "keep_drop_prob": 0.9, "use_join": True},
     "multi:f1wer"),
    ("붙여 찾기만", {"use_join": True}, "multi:f1wer"),
]
SETS["v4"] = [(f"{n} / {'strict' if s else '기본'}", {**_BASE, **c}, s, GRID, k)
              for s in (True, False) for n, c, k in _V4]

# 11-15 v5: 원형 맞추기, 대체어 표. 바탕은 v4에서 고른 것(내용어 지키기, 생략 ≥0.9 허용). 조정은 여러 정답 기준
_V4_PICK = {"content_keep": True, "keep_drop_prob": 0.9}
_V5 = [
    ("v4 (개선 전)", {}),
    ("+ 원형 맞추기", {"lemma_fix": True}),
    ("+ 대체어 표", {"use_subst": True}),
    ("+ 원형 맞추기 + 대체어 표", {"lemma_fix": True, "use_subst": True}),
    ("+ 원형 맞추기 + 대체어 표 (몫 ≥0.6)", {"lemma_fix": True, "use_subst": True, "subst_min_share": 0.6,
                                      "subst_min_keep": 0.3}),
    ("+ 원형 맞추기 + 대체어 표 (몫 ≥0.9, 3회)", {"lemma_fix": True, "use_subst": True, "subst_min_share": 0.9,
                                         "subst_min_count": 3}),
]
SETS["v5"] = [(f"{n} / {'strict' if s else '기본'}", {**_BASE, **_V4_PICK, **c}, s, GRID, "multi:f1wer")
              for s in (True, False) for n, c in _V5]


def coverage(train, val):
    """검증 정답 글로스 중 학습 글로스에 나온 비율 (학습으로 낼 수 있는 상한), 같은 한국어 문장이 학습에 있는 비율."""
    seen = collections.Counter(g for p in train for g in p["gloss"])
    toks = [g for p in val for g in p["gloss"]]
    ko = {p["korean"] for p in train}
    return {"ref_gloss_seen_in_train": sum(g in seen for g in toks) / max(1, len(toks)),
            "val_korean_seen_in_train": sum(p["korean"] in ko for p in val) / max(1, len(val))}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pairs", required=True)
    p.add_argument("--gloss-table", required=True)
    p.add_argument("--sen-meta")
    p.add_argument("--analyzer", default="madi", choices=["madi", "rule", "auto"])
    p.add_argument("--set", default="v2", choices=sorted(SETS))
    p.add_argument("--synonyms")
    p.add_argument("--out")
    a = p.parse_args()
    table = json.loads(Path(a.gloss_table).read_text(encoding="utf-8"))
    syn = load_synonyms(a.synonyms)
    rows, extra = [], {}
    all_pairs = read_pairs(a.pairs)
    multi_lines = ["| 설정 | 여러 정답 정밀도 | 재현율 | F1 | WER | 기존 F1 | unknown/문장 | 대체/문장 | 대체어 수 |",
                   "|---|---|---|---|---|---|---|---|---|"]
    for name, cfg, strict, grid, kind in SETS[a.set]:
        if cfg.get("use_synonyms") and syn is None:
            print(f"skip {name}: 동의어 표 없음")
            continue
        parts = load_split(a.pairs, None, sen_meta=a.sen_meta, strict=strict)
        extra[name] = {"train": len(parts["train"]), **coverage(parts["train"], parts["val"])}
        t = build_translator(parts["train"], table, config={"analyzer": a.analyzer, **cfg}, synonyms=syn)
        refs = all_references(parts["val"], all_pairs) if kind.startswith("multi:") else None
        tune(t, parts["val"], grid=grid, kind=kind.split(":")[-1], refs=refs, log=lambda *_: None)
        row, outs = evaluate(t, parts["val"], n_boot=500)
        suite, _ = score_suite(t, parts["val"], all_pairs, make_matcher(t.glosses), n_boot=200)
        mr = suite["여러 정답 F1"]
        row["multi"] = {k: mr[k] for k in ("precision", "recall", "f1", "wer")}
        multi_lines.append(f"| {name} | {mr['precision']:.3f} | {mr['recall']:.3f} | {mr['f1']:.3f} | {mr['wer']:.3f} | "
                           f"{row['f1']:.3f} | {row['unknown_per_sent']:.2f} | "
                           f"{sum(len(o.get('substituted', [])) for o in outs) / max(1, len(outs)):.2f} | "
                           f"{len(t.subst) if t.subst is not None else 0} |")
        print(multi_lines[-1], flush=True)
        row["weights"] = dict(t.weights)
        row["substituted_per_sent"] = sum(len(o.get("substituted", [])) for o in outs) / max(1, len(outs))
        row["subst_entries"] = len(t.subst) if t.subst is not None else 0
        rows.append((name, row))
        print(table_md([(name, row)]).splitlines()[-1], flush=True)
    print(table_md(rows))
    print("\n".join(multi_lines))
    print(json.dumps(extra, ensure_ascii=False))
    if a.out:
        Path(a.out).write_text(json.dumps({"set": a.set, "rows": dict(rows), "data": extra}, ensure_ascii=False,
                                          indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
