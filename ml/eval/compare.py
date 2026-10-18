"""같은 test 클립에 대한 원본/B1/B2/Ours-H/Ours-HF의 저장 동작을 평가한다.

python -m eval.compare --data data/full --recog runs/recog_100 \
    --manifest runs/generated.json --out runs/compare
"""
import argparse
import csv
import json
from pathlib import Path

import numpy as np

from common import metrics as M
from common.data import apply_split, load_data
from recog.infer import Recognizer, validate_motion

CONDITIONS = ("B1", "B2", "Ours-H", "Ours-HF")


def transition_jerk(x, boundaries, fps=30, radius=8):
    x, _ = validate_motion(x)
    if not boundaries:
        return None
    if any(isinstance(b, bool) or not isinstance(b, int) or not 0 < b < len(x) for b in boundaries):
        raise ValueError("boundaries는 동작 내부의 단어 경계 프레임 번호여야 합니다.")
    return float(np.mean([M.jerk(x[max(0, b-radius):min(len(x), b+radius+1)], fps) for b in boundaries]))


def evaluate(ref, samples, item, recognizer, scale, boundaries=None, fps=30):
    ref, _ = validate_motion(ref)
    samples = [validate_motion(x)[0] for x in samples]
    if not samples or not np.isfinite(scale) or scale <= 0 or not np.isfinite(fps) or fps <= 0:
        raise ValueError("동작 샘플과 양수 scale/fps가 필요합니다.")
    predictions = [recognizer.score(x)["top5"] for x in samples]
    ref_path = M.wrist_path(ref)
    jerks = [transition_jerk(x, boundaries, fps) for x in samples]
    return {
        "top1": float(np.mean([p[0][0] == item for p in predictions])),
        "top5": float(np.mean([item in [w for w, _ in p] for p in predictions])),
        "dtw_mm": float(np.mean([M.dtw_mje(x, ref, scale * 1000) for x in samples])),
        "size_ratio": float(np.mean([M.wrist_path(x) for x in samples]) / ref_path) if ref_path > 1e-6 else None,
        "transition_jerk": float(np.mean(jerks)) if boundaries else None,
        "diversity_mm": M.diversity(samples) * scale * 1000 if len(samples) >= 2 else None,
        "samples": len(samples),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    for key in ("data", "recog", "manifest", "out"):
        ap.add_argument(f"--{key}", required=True)
    ap.add_argument("--smoke", action="store_true", help="학습 표현자 포함을 허용하는 동작 확인. 정식 결과로 사용 금지")
    args = ap.parse_args()
    recognizer = Recognizer(args.recog)
    metas = load_data(args.data, {"WORD"})
    if not args.smoke:
        sp = recognizer.checkpoint.get("split")
        if not sp or sp["mode"] != "signer":
            raise ValueError("표현자 분할이 기록된 채점관이 필요합니다. 샘플 확인은 --smoke를 쓰세요.")
        groups = [set(sp["signers"].get(k, [])) for k in ("train", "val", "test")]
        if any(groups[i] & groups[j] for i in range(3) for j in range(i+1, 3)):
            raise ValueError("채점관의 표현자 분할이 겹칩니다.")
        _, _, metas = apply_split(metas, sp)
    refs = {m["clip"]: m for m in metas if m["item"] in recognizer.classes}
    path = Path(args.manifest)
    manifest = json.loads(path.read_text(encoding="utf-8"))
    records = manifest["records"]
    if not records or len({r["clip"] for r in records}) != len(records):
        raise ValueError("records는 비어 있지 않고 clip이 중복되지 않아야 합니다.")
    rows = []
    for record in records:
        if set(record["conditions"]) != set(CONDITIONS):
            raise ValueError(f"{record['clip']}: 네 조건이 모두 필요합니다.")
        if record["clip"] not in refs:
            raise ValueError(f"{record['clip']}: 채점관이 아는 단어의 test 클립이 아닙니다.")
        m = refs[record["clip"]]
        x, (a, b) = validate_motion(m["x"], m["active"])
        ref = x[a:b+1]
        scale = m["norm"]["scale"]
        rows.append({"clip": m["clip"], "item": m["item"], "condition": "Original",
                     **evaluate(ref, [ref], m["item"], recognizer, scale)})
        for condition, spec in record["conditions"].items():
            samples = [np.load(path.parent / name, allow_pickle=False) for name in spec["motions"]]
            rows.append({"clip": m["clip"], "item": m["item"], "condition": condition,
                         **evaluate(ref, samples, m["item"], recognizer, scale,
                                    spec.get("boundaries"), spec.get("fps", 30))})
    keys = ("top1", "top5", "dtw_mm", "size_ratio", "transition_jerk", "diversity_mm")
    table = {}
    for condition in ("Original", *CONDITIONS):
        group = [r for r in rows if r["condition"] == condition]
        table[condition] = {k: float(np.mean([r[k] for r in group if r[k] is not None]))
                            if any(r[k] is not None for r in group) else None for k in keys}
        table[condition]["measured_clips"] = {k: sum(r[k] is not None for r in group) for k in keys}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    result = {"smoke_only": args.smoke, "config": vars(args), "clips": len(records), "table": table, "rows": rows}
    (out / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    with (out / "rows.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    lines = ["| 조건 | Top-1 | Top-5 | DTW mm | 움직임 크기 | 전환 jerk | 다양성 mm |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    for c, values in table.items():
        cells = ["미측정" if values[k] is None else f"{values[k]:.4f}" for k in keys]
        lines.append("| " + " | ".join([c, *cells]) + " |")
    (out / "table.md").write_text(("샘플 동작 확인 전용\n\n" if args.smoke else "") + "\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
