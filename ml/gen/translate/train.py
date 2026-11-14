"""번역기 학습: 엑셀 학습 몫 → 구 대응표 + 글로스 LM → (선택) 검증 문장으로 가중치 조정 → JSON 한 파일.

    python -m gen.translate.train --pairs <엑셀> --gloss-table <gloss_table_v2.json> \
        --out <.local/translate/translator_v1.json> [--tune] [--strict] [--analyzer madi|rule|auto] \
        [--content-drop-min 0.8] [--split-compounds] [--synonyms .local/translate/synonyms_v1.json]

서비스용: --all 이면 2,000쌍 전부로 학습한다(검증 · 시험 문장도 학습에 들어가므로 평가에 쓰지 않는다).
가중치는 --weights-from <평가용 학습 파일>에서 가져온다.

가중치 조정: 검증 문장(sen_val_v1)에서 좌표별 탐색, 목표 (F1 + (1 − WER)) / 2. heldout은 쓰지 않는다.
결과 파일은 AI Hub 파생물이라 커밋하지 않는다.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import argparse
import json
from pathlib import Path

from gen.translate import metrics
from gen.translate.evaluate import load_split
from gen.translate.synonyms import load_synonyms
from gen.translate.translator import build_translator

GRID = {
    "fwd": [0.0, 0.5, 1.0, 2.0],
    "bwd": [0.0, 0.5, 1.0, 2.0],
    "lm": [0.0, 0.25, 0.5, 1.0],
    "glosses": [-1.0, -0.5, 0.0, 0.5, 1.0],
    "phrases": [-1.0, -0.5, 0.0, 0.5, 1.0],
    "rule": [-4.0, -2.0, -1.0, 0.0],
    "drop": [-6.0, -4.0, -2.0, -1.0, 0.0],
    "shrink": [-3.0, -2.0, -1.0, -0.5, 0.0],
    "syn": [-3.0, -2.0, -1.0, 0.0],
}


def objective(translator, pairs, kind="f1wer"):
    """kind: 'f1wer' = (F1 + (1 − WER)) / 2,  'f1' = F1."""
    stats = [metrics.sentence_stats(translator.translate(p["korean"])["gloss"], p["gloss"]) for p in pairs]
    r = metrics.aggregate(stats)
    return (r["f1"] if kind == "f1" else (r["f1"] + 1 - r["wer"]) / 2), r


def tune(translator, val_pairs, rounds=3, grid=None, log=print, kind="f1wer"):
    """좌표별 탐색. 같은 점수면 지금 값을 유지한다."""
    grid = dict(grid or GRID)
    if not (translator.config.get("use_synonyms") and translator.synonyms):
        grid.pop("syn", None)
    best, _ = objective(translator, val_pairs, kind)
    log(f"tune start objective={best:.4f}")
    for rnd in range(rounds):
        changed = False
        for name, values in grid.items():
            cur = translator.weights.get(name, 0.0)
            for v in values:
                if v == cur:
                    continue
                translator.weights[name] = v
                score, _ = objective(translator, val_pairs, kind)
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
    p.add_argument("--analyzer", default="madi", choices=["madi", "rule", "auto"])
    p.add_argument("--no-endings", action="store_true", help="어미 단위를 빼고 학습 (ablation)")
    p.add_argument("--max-src", type=int, default=3)
    p.add_argument("--content-drop-min", type=float, default=0.0,
                   help="내용어 생략 대응은 P(생략|원문)이 이 값 이상일 때만 (0이면 끔)")
    p.add_argument("--split-compounds", action="store_true", help="표에 없는 합성어를 표 안 이름 둘로 나눈다")
    p.add_argument("--synonyms", help="동의어 표 파일 (없으면 건너뜀)")
    p.add_argument("--objective", default="f1wer", choices=["f1wer", "f1"])
    p.add_argument("--tune", action="store_true")
    p.add_argument("--all", action="store_true", help="서비스용: 2,000쌍 전부로 학습 (평가에 쓰지 않음)")
    p.add_argument("--weights-from", help="가중치를 이 학습 파일에서 가져온다")
    p.add_argument("--overwrite", action="store_true")
    a = p.parse_args()
    parts = load_split(a.pairs, None, a.heldout, a.val, a.sen_meta, a.strict)
    print({k: len(v) for k, v in parts.items()})
    table = json.loads(Path(a.gloss_table).read_text(encoding="utf-8"))
    syn = load_synonyms(a.synonyms)
    if a.synonyms and syn is None:
        print(f"synonyms file not found, skipped: {a.synonyms}")
    cfg = {"analyzer": a.analyzer, "keep_endings": not a.no_endings, "max_src": a.max_src,
           "content_drop_min": a.content_drop_min, "use_split": a.split_compounds, "use_synonyms": syn is not None}
    train = parts["train"] + (parts["val"] + parts["test"] if a.all else [])
    info = {"strict": a.strict, "all_pairs": a.all, "split_sizes": {k: len(v) for k, v in parts.items()},
            "train_used": len(train), "gloss_table_stats": table.get("stats"),
            "synonym_words": len(syn) if syn else 0}
    weights = None
    if a.weights_from:
        weights = json.loads(Path(a.weights_from).read_text(encoding="utf-8"))["weights"]
        info["weights_from"] = a.weights_from
    t = build_translator(train, table, config=cfg, info=info, weights=weights, synonyms=syn)
    print(json.dumps(t.info, ensure_ascii=False))
    if a.tune:
        if a.all:
            raise SystemExit("--all과 --tune은 같이 쓰지 않는다 (검증 문장이 학습에 들어감). --weights-from을 쓴다")
        t.info["val_objective"] = tune(t, parts["val"], kind=a.objective)
        t.info["objective"] = a.objective
    t.save(a.out, overwrite=a.overwrite)
    print(f"saved {a.out} analyzer={t.config['analyzer']}")


if __name__ == "__main__":
    main()
