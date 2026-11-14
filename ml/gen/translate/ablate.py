"""검증 문장(sen_val_v1)에서 설정별 비교 (ablation). 설정마다 학습 → 가중치 조정 → 검증 채점.

    python -m gen.translate.ablate --pairs <엑셀> --gloss-table <표> [--sen-meta <meta>] [--out result.json]

heldout은 읽지 않는다. 출력은 집계 숫자만.
설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import argparse
import collections
import json
from pathlib import Path

from gen.translate.evaluate import evaluate, load_split, table_md
from gen.translate.train import tune
from gen.translate.translator import build_translator

SETTINGS = [
    ("기본", {}, False),
    ("− 언어 모델", {"use_lm": False}, False),
    ("− 어미 단위", {"keep_endings": False}, False),
    ("구 길이 1", {"max_src": 1}, False),
    ("구 길이 2", {"max_src": 2}, False),
    ("− 어미 단위, 구 길이 2", {"keep_endings": False, "max_src": 2}, False),
    ("− 규칙 앵커 정렬", {"anchor": False}, False),
    ("− 규칙 후보", {"use_rules": False}, False),
    ("strict 학습", {}, True),
]


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
    p.add_argument("--analyzer", default="auto")
    p.add_argument("--out")
    a = p.parse_args()
    table = json.loads(Path(a.gloss_table).read_text(encoding="utf-8"))
    rows, extra = [], {}
    for name, cfg, strict in SETTINGS:
        parts = load_split(a.pairs, None, sen_meta=a.sen_meta, strict=strict)
        extra[name] = {"train": len(parts["train"]), **coverage(parts["train"], parts["val"])}
        t = build_translator(parts["train"], table, config={"analyzer": a.analyzer, **cfg})
        tune(t, parts["val"], log=lambda *_: None)
        row, _ = evaluate(t, parts["val"], n_boot=500)
        row["weights"] = dict(t.weights)
        rows.append((name, row))
    print(table_md(rows))
    print(json.dumps(extra, ensure_ascii=False))
    if a.out:
        Path(a.out).write_text(json.dumps({"rows": dict(rows), "data": extra}, ensure_ascii=False, indent=1),
                               encoding="utf-8")


if __name__ == "__main__":
    main()
