"""Create provisional quality lists from existing reports; never modify motion."""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path


def classify_motion(row):
    hold, review = [], []
    if float(row["gap_peak_cm"]) > 100:
        hold.append("wrist_gap_over_100cm")
    if float(row["step_peak_cm"]) > 100:
        hold.append("joint_step_over_100cm")
    if float(row["gap_peak_cm"]) > 20:
        review.append("wrist_gap_over_20cm")
    if float(row["step_peak_cm"]) > 50:
        review.append("joint_step_over_50cm")
    if float(row["raw_mean_gap_max_cm"]) > 5:
        review.append("raw_mean_gap_over_5cm")
    return ("hold", hold + review) if hold else ("review", review) if review else ("usable", [])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--audit", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    data, audit, out = args.data.resolve(), args.audit.resolve(), args.out.resolve()
    if out == data or data in out.parents:
        ap.error("Output must be outside the data directory")
    source = (data / "meta.jsonl").read_bytes()
    metas = [json.loads(line) for line in source.decode("utf-8").splitlines()]
    ids = [m["clip"] for m in metas]
    scan = json.loads((audit / "full_spikes" / "summary.json").read_text(encoding="utf-8"))
    if hashlib.sha256(source).hexdigest() != scan["meta_sha256"] or scan["errors"]:
        raise ValueError("Scan is stale or incomplete")
    details = json.loads((audit / "details.json").read_text(encoding="utf-8"))
    missing = set(details["motion_without_label"])
    empty = set(details["empty_labels"])
    broken = set(details["broken_labels"])
    with (audit / "full_spikes" / "all_clips.csv").open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if len(ids) != len(set(ids)) or len(rows) != len(ids) or {r["clip"] for r in rows} != set(ids):
        raise ValueError("Duplicate or unmatched scan/meta IDs")
    classified = []
    for row in rows:
        motion, reasons = classify_motion(row)
        label = "missing" if row["clip"] in missing else "broken" if row["clip"] in broken else "empty" if row["clip"] in empty else "matched_nonempty_unvalidated"
        overall = "hold" if label != "matched_nonempty_unvalidated" else motion
        classified.append({**row, "motion_status": motion, "label_status": label,
                           "status": overall, "reasons": ";".join(reasons + ([f"label_{label}"] if overall == "hold" and label != "matched_nonempty_unvalidated" else []))})
    groups = {s: [r for r in classified if r["status"] == s] for s in ("usable", "review", "hold")}
    summary = {"policy": "word_quality_v0.1_provisional", "clips": len(rows),
               "counts": {s: len(g) for s, g in groups.items()},
               "motion_counts": dict(Counter(r["motion_status"] for r in classified)),
               "label_counts": dict(Counter(r["label_status"] for r in classified)),
               "by_signer": {s: dict(sorted(Counter(r["signer"] for r in g).items())) for s,g in groups.items()},
               "reason_counts_nonexclusive": dict(Counter(reason for r in classified for reason in r["reasons"].split(";") if reason)),
               "label_only_clips_not_assigned": len(details["label_without_motion"]),
               "meta_sha256": hashlib.sha256(source).hexdigest(),
               "scan_csv_sha256": hashlib.sha256((audit / "full_spikes" / "all_clips.csv").read_bytes()).hexdigest(),
               "notes": "Full clip screening; labels are matched/nonempty only, segment validity pending. VQ can use motion_status independently. No training filter activated. Thresholds are heuristic, strict greater-than; hold takes priority."}
    out.mkdir(parents=True, exist_ok=True)
    for name, values in (("all_clips", classified), *groups.items()):
        with (out / f"{name}.csv").open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(classified[0]))
            writer.writeheader()
            writer.writerows(values)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if source != (data / "meta.jsonl").read_bytes():
        raise ValueError("Metadata changed during classification")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
