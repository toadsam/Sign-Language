"""번역기 학습: 엑셀 학습 몫 → 구 대응표 + 글로스 LM → (선택) 검증 문장으로 가중치 조정 → JSON 한 파일.

    python -m gen.translate.train --pairs <엑셀> --gloss-table <gloss_table_v2.json> \
        --out <.local/translate/translator_v1.json> [--tune] [--strict] [--analyzer auto|madi|rule]

가중치 조정: 검증 문장(sen_val_v1)에서 좌표별 탐색, 목표 (F1 + (1 − WER)) / 2. heldout은 쓰지 않는다.
결과 파일은 AI Hub 파생물이라 커밋하지 않는다.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import argparse
import json
from pathlib import Path

from gen.translate import metrics
from gen.translate.evaluate import load_split
from gen.translate.translator import build_translator

GRID = {
    "fwd": [0.0, 0.5, 1.0, 2.0],
    "bwd": [0.0, 0.5, 1.0, 2.0],
    "lm": [0.0, 0.25, 0.5, 1.0],
    "glosses": [-1.0, -0.5, 0.0, 0.5, 1.0],
    "phrases": [-1.0, -0.5, 0.0, 0.5, 1.0],
    "rule": [-4.0, -2.0, -1.0, 0.0],
    "drop": [-6.0, -4.0, -2.0, -1.0, 0.0],
}


def objective(translator, pairs):
    stats = [metrics.sentence_stats(translator.translate(p["korean"])["gloss"], p["gloss"]) for p in pairs]
    r = metrics.aggregate(stats)
    return (r["f1"] + 1 - r["wer"]) / 2, r


def tune(translator, val_pairs, rounds=3, grid=None, log=print):
    """좌표별 탐색. 같은 점수면 지금 값을 유지한다."""
    grid = grid or GRID
    best, _ = objective(translator, val_pairs)
    log(f"tune start objective={best:.4f}")
    for rnd in range(rounds):
        changed = False
        for name, values in grid.items():
            cur = translator.weights[name]
            for v in values:
                if v == cur:
                    continue
                translator.weights[name] = v
                score, _ = objective(translator, val_pairs)
                if score > best + 1e-9:
                    best, cur, changed = score, v, True
            translator.weights[name] = cur
        log(f"tune round {rnd + 1} objective={best:.4f} weights={json.dumps(translator.weights)}")
        if not changed:
            break
    return best


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pairs", required=True)
    p.add_argument("--gloss-table", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--heldout")
    p.add_argument("--val")
    p.add_argument("--sen-meta")
    p.add_argument("--strict", action="store_true", help="검증·시험과 한국어 문장이 같은 학습 쌍도 뺀다")
    p.add_argument("--analyzer", default="auto", choices=["auto", "madi", "rule"])
    p.add_argument("--no-endings", action="store_true", help="어미 단위를 빼고 학습 (ablation)")
    p.add_argument("--max-src", type=int, default=3)
    p.add_argument("--tune", action="store_true")
    p.add_argument("--overwrite", action="store_true")
    a = p.parse_args()
    parts = load_split(a.pairs, None, a.heldout, a.val, a.sen_meta, a.strict)
    print({k: len(v) for k, v in parts.items()})
    table = json.loads(Path(a.gloss_table).read_text(encoding="utf-8"))
    cfg = {"analyzer": a.analyzer, "keep_endings": not a.no_endings, "max_src": a.max_src}
    info = {"strict": a.strict, "split_sizes": {k: len(v) for k, v in parts.items()},
            "gloss_table_stats": table.get("stats")}
    t = build_translator(parts["train"], table, config=cfg, info=info)
    print(json.dumps(t.info, ensure_ascii=False))
    if a.tune:
        t.info["val_objective"] = tune(t, parts["val"])
    t.save(a.out, overwrite=a.overwrite)
    print(f"saved {a.out} analyzer={t.config['analyzer']}")


if __name__ == "__main__":
    main()
