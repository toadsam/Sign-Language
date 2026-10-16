"""Read-only WORD audit. Detailed reports stay outside the repository."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import zipfile

import numpy as np

from common.skeleton import L_WRIST, R_WRIST, L_HAND_ROOT, R_HAND_ROOT


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    metas = [json.loads(s) for s in (args.data / "meta.jsonl").read_text(encoding="utf-8").splitlines()]
    ids = [m["clip"] for m in metas]
    label_ids = []
    broken_labels = []
    empty_labels = []
    pattern = re.compile(r"NIA_SL_(WORD\d+)_(REAL\d+)_F(?:_|\.)")
    with zipfile.ZipFile(args.labels) as archive:
        for name in archive.namelist():
            match = pattern.search(Path(name).name)
            if not match or not name.endswith(".json"):
                continue
            clip = "_".join(match.groups())
            label_ids.append(clip)
            try:
                doc = json.loads(archive.read(name).decode("utf-8-sig"))
                if not doc.get("data"):
                    empty_labels.append(clip)
            except (ValueError, UnicodeError):
                broken_labels.append(clip)
    if not label_ids:
        raise ValueError("No front-view WORD labels matched; check filename pattern")
    gaps = []
    peaks = []
    invalid = []
    outliers = []
    swap_candidates = []
    def read_array(m):
        try:
            return m, np.load(args.data / "npy" / f"{m['clip']}.npy", allow_pickle=False), None
        except (OSError, ValueError) as exc:
            return m, None, str(exc)

    def arrays():
        # Bounded batches avoid retaining the entire dataset in memory.
        with ThreadPoolExecutor(max_workers=8) as pool:
            for start in range(0, len(metas), 64):
                yield from pool.map(read_array, metas[start:start + 64])

    shapes = Counter()
    for index, (m, x, read_error) in enumerate(arrays(), 1):
        clip = m["clip"]
        try:
            if read_error:
                raise ValueError(read_error)
            shapes[str(x.shape[1:])] += 1
            if x.shape not in ((m["frames"], 375), (m["frames"], 125, 3)) or x.dtype != np.float32 or not np.isfinite(x).all():
                raise ValueError("shape/dtype/nonfinite")
            y = x.reshape(-1, 125, 3)
            scale = m["norm"]["scale"] * 100
            direct = np.linalg.norm(y[:, [R_WRIST, L_WRIST]] - y[:, [R_HAND_ROOT, L_HAND_ROOT]], axis=-1) * scale
            swapped = np.linalg.norm(y[:, [R_WRIST, L_WRIST]] - y[:, [L_HAND_ROOT, R_HAND_ROOT]], axis=-1) * scale
            mean = float(direct.mean())
            peak = float(direct.max())
            gaps.append(max(m["check"]["wrist_gap_cm"]))
            peaks.append(peak)
            if swapped.mean() < direct.mean() * 0.5 and mean > 5:
                swap_candidates.append(clip)
            if gaps[-1] > 5:
                outliers.append({"clip": clip, "raw_mean_gap_cm": m["check"]["wrist_gap_cm"], "processed_mean_gap_cm": direct.mean(axis=0).tolist(), "processed_peak_gap_cm": peak, "swapped_mean_gap_cm": float(swapped.mean())})
        except (OSError, ValueError, KeyError) as exc:
            invalid.append({"clip": clip, "error": str(exc)})
        if index % 5000 == 0:
            print(f"checked {index}/{len(metas)}", flush=True)
    motion_set, label_set = set(ids), set(label_ids)
    details = {"motion_without_label": sorted(motion_set-label_set), "label_without_motion": sorted(label_set-motion_set), "invalid_arrays": invalid, "broken_labels": broken_labels, "empty_labels": empty_labels, "outliers": sorted(outliers, key=lambda r: max(r["raw_mean_gap_cm"]), reverse=True), "swap_candidates": swap_candidates}
    report = {"motion_clips": len(ids), "unique_motion_clips": len(motion_set), "motion_signers": dict(sorted(Counter(m["signer"] for m in metas).items())), "items": len(set(m["item"] for m in metas)), "front_label_files": len(label_ids), "unique_label_clips": len(label_set), "label_signers": dict(sorted(Counter(c.split("_")[-1] for c in label_ids).items())), "matched": len(motion_set & label_set), "motion_without_label": len(motion_set-label_set), "label_without_motion": len(label_set-motion_set), "duplicate_motion_ids": len(ids)-len(motion_set), "duplicate_label_ids": len(label_ids)-len(label_set), "invalid_arrays": len(invalid), "broken_labels": len(broken_labels), "empty_labels": len(empty_labels), "mm_clips": sum(m["check"].get("src_unit")=="mm" for m in metas), "shoulder_m_min_max": [min(m["norm"]["scale"] for m in metas),max(m["norm"]["scale"] for m in metas)], "raw_gap_cm_p50_p95_p99_max": np.percentile(gaps,[50,95,99,100]).tolist(), "raw_gap_over_5cm": len(outliers), "raw_gap_over_5cm_by_signer": dict(sorted(Counter(r["clip"].split("_")[-1] for r in outliers).items())), "processed_peak_gap_cm_p50_p95_p99_max": np.percentile(peaks,[50,95,99,100]).tolist(), "swap_candidates": len(swap_candidates)}
    report["stored_shapes"] = dict(shapes)
    report["real02_missing_vs_real25_item_overlap"] = len({s.split("_")[0] for s in motion_set-label_set if s.endswith("_REAL02")} & {s.split("_")[0] for s in label_set-motion_set if s.endswith("_REAL25")})
    for name, value in (("summary", report), ("details", details)):
        (args.out / f"{name}.json").write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__ == "__main__":
    main()
