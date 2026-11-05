"""Build a local review viewer using existing skeleton UI; no motion correction."""
import argparse
import csv
import json
from pathlib import Path

import numpy as np

from common.viewer import write_viewer


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--scan", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    data, out = args.data.resolve(), args.out.resolve()
    if data == out or data in out.parents:
        ap.error("Output must be outside motion data directory")
    with (args.scan / "all_clips.csv").open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    for row in rows:
        for key in ("gap_peak_cm", "step_peak_cm", "raw_mean_gap_max_cm"):
            row[key] = float(row[key])
    candidates = sorted(rows, key=lambda r: r["gap_peak_cm"], reverse=True)[:3]
    candidates += sorted(rows, key=lambda r: r["step_peak_cm"], reverse=True)[:3]
    candidates += sorted((r for r in rows if r["signer"] == "REAL13" and int(r["step_joint"]) == 12), key=lambda r: r["step_peak_cm"], reverse=True)[:2]
    missed = [r for r in rows if r["gap_peak_cm"] > 100 and r["raw_mean_gap_max_cm"] <= 5]
    candidates += sorted(missed, key=lambda r: r["gap_peak_cm"], reverse=True)[:2]
    selected = {r["clip"]: r for r in candidates}
    metas = {m["clip"]: m for m in map(json.loads, (data / "meta.jsonl").read_text(encoding="utf-8").splitlines())}
    clips, manifest = [], []
    for clip, row in selected.items():
        item = metas[clip]["item"]
        references = [r for r in rows if metas[r["clip"]]["item"] == item and r["signer"] != row["signer"]]
        if not references:
            raise ValueError(f"No independent reference: {clip}")
        ref = min(references, key=lambda r: (r["gap_peak_cm"] > 20 or r["step_peak_cm"] > 50, r["step_peak_cm"], r["gap_peak_cm"]))
        a = np.load(data / "npy" / f"{clip}.npy", allow_pickle=False).reshape(-1, 375)
        b = np.load(data / "npy" / f"{ref['clip']}.npy", allow_pickle=False).reshape(-1, 375)
        clips.append({"name": f"{clip} / {ref['clip']}", "a": a, "b": b, "active": metas[clip]["active"]})
        manifest.append({"candidate": row, "reference": ref,
                         "reference_below_screening_thresholds": ref["gap_peak_cm"] <= 20 and ref["step_peak_cm"] <= 50})
    out.mkdir(parents=True, exist_ok=True)
    write_viewer(str(out / "viewer.html"), clips, labels=("점검 후보", "같은 단어의 다른 수행자"), title="WORD 순간 이상치 비교")
    (out / "manifest.json").write_text(json.dumps({"pairs": manifest, "note": "Different signers; timing is not aligned. Reference is selected by measured gaps and steps, not certified as correct."}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pairs": len(clips), "references_below_thresholds": sum(m["reference_below_screening_thresholds"] for m in manifest)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
