"""Read-only full motion screening; thresholds flag candidates, not exclusions."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import json
from pathlib import Path

import numpy as np

from common.skeleton import L_WRIST, R_WRIST, L_HAND_ROOT, R_HAND_ROOT


def inspect(meta, data):
    path = data / "npy" / f"{meta['clip']}.npy"
    before = path.stat()
    x = np.load(path, allow_pickle=False)
    if x.shape not in ((meta["frames"], 375), (meta["frames"], 125, 3)):
        raise ValueError("Unexpected shape")
    if x.dtype != np.float32 or not np.isfinite(x).all():
        raise ValueError("Invalid dtype or nonfinite coordinates")
    x = x.reshape(-1, 125, 3)
    start, end = meta["active"]
    if not 0 <= start <= end < len(x) or meta["norm"]["scale"] <= 0:
        raise ValueError("Invalid active range or scale")
    cm = meta["norm"]["scale"] * 100
    gap = np.linalg.norm(x[:, [R_WRIST, L_WRIST]] - x[:, [R_HAND_ROOT, L_HAND_ROOT]], axis=-1) * cm
    frame, side = np.unravel_index(gap.argmax(), gap.shape)
    steps = np.linalg.norm(np.diff(x, axis=0), axis=-1) * cm
    step_frame, joint = np.unravel_index(steps.argmax(), steps.shape) if steps.size else (0, 0)
    row = {"clip": meta["clip"], "signer": meta["signer"], "frames": len(x),
           "raw_mean_gap_max_cm": max(meta["check"]["wrist_gap_cm"]),
           "gap_peak_cm": float(gap[frame, side]), "gap_peak_frame": int(frame),
           "gap_peak_side": "right" if side == 0 else "left",
           "gap_active_peak_cm": float(gap[start:end + 1].max()),
           "gap_frames_over_100cm": int((gap.max(axis=1) > 100).sum()),
           "step_peak_cm": float(steps.max()) if steps.size else 0.,
           "step_destination_frame": int(step_frame + 1) if steps.size else 0,
           "step_joint": int(joint),
           "step_active_peak_cm": float(steps[start:end].max()) if end > start else 0.}
    for part, a, b in (("body", 0, 13), ("hand", 13, 55), ("face", 55, 125)):
        row[f"step_{part}_peak_cm"] = float(steps[:, a:b].max()) if steps.size else 0.
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Motion file changed during scan")
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    data = args.data.resolve()
    out = args.out.resolve()
    if out == data or data in out.parents:
        ap.error("Report directory must be outside motion data directory")
    source = data / "meta.jsonl"
    original_meta = source.read_bytes()
    metas = [json.loads(s) for s in original_meta.decode("utf-8").splitlines()]
    rows, errors = [], []

    def job(m):
        try:
            return inspect(m, data), None
        except (OSError, ValueError, KeyError, IndexError) as exc:
            return None, {"clip": m.get("clip"), "error": str(exc)}

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for start in range(0, len(metas), 64):
            for row, error in pool.map(job, metas[start:start + 64]):
                if error:
                    errors.append(error)
                else:
                    rows.append(row)
            if (start + 64) // 5000 != start // 5000:
                print(f"checked {min(start + 64, len(metas))}/{len(metas)}", flush=True)
    thresholds = {}
    for metric, limits in (("gap_peak_cm", (20, 50, 100)), ("gap_active_peak_cm", (20, 50, 100)),
                           ("step_peak_cm", (50, 100)), ("step_active_peak_cm", (50, 100))):
        for limit in limits:
            selected = [r for r in rows if r[metric] > limit]
            thresholds[f"{metric}_over_{limit}"] = {"clips": len(selected), "signers": dict(sorted(Counter(r["signer"] for r in selected).items()))}
    candidates = [r for r in rows if r["gap_peak_cm"] > 100 or r["step_peak_cm"] > 100]
    summary = {"expected": len(metas), "checked": len(rows), "errors": errors,
               "duplicate_meta_ids": len(metas) - len({m["clip"] for m in metas}),
               "meta_unchanged": original_meta == source.read_bytes(),
               "meta_sha256": hashlib.sha256(original_meta).hexdigest(),
               "thresholds": thresholds, "candidate_union_gap_or_step_over_100cm": len(candidates),
               "gap_over_100cm_previously_missed": sum(r["gap_peak_cm"] > 100 and r["raw_mean_gap_max_cm"] <= 5 for r in rows),
               "distribution_p50_p95_p99_max": {key: np.percentile([r[key] for r in rows], [50, 95, 99, 100]).tolist() if rows else [] for key in ("gap_peak_cm", "step_peak_cm")},
               "top_gap": sorted(rows, key=lambda r: r["gap_peak_cm"], reverse=True)[:5],
               "top_step": sorted(rows, key=lambda r: r["step_peak_cm"], reverse=True)[:5],
               "interpretation": "Stored, preprocessed coordinates; no deletion or correction. Frame index is zero-based. Active step counts only transitions with both endpoints inside active. Thresholds are screening heuristics."}
    out.mkdir(parents=True, exist_ok=True)
    for name, values in (("all_clips.csv", rows), ("candidates.csv", candidates)):
        with (out / name).open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0]) if rows else ["clip"])
            writer.writeheader()
            writer.writerows(values)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("top_gap", "top_step")}, ensure_ascii=False, indent=2), flush=True)
    if errors or not summary["meta_unchanged"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
