"""Investigate audit candidates without modifying motion or labels."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import zipfile

import numpy as np

from common.skeleton import L_WRIST, R_WRIST, L_HAND_ROOT, R_HAND_ROOT, NECK


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--audit", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    args = ap.parse_args()
    details = json.loads((args.audit / "details.json").read_text(encoding="utf-8"))
    metas = {m["clip"]: m for m in map(json.loads, (args.data / "meta.jsonl").read_text(encoding="utf-8").splitlines())}
    rows = []
    for candidate in details["outliers"]:
        clip = candidate["clip"]
        m = metas[clip]
        x = np.load(args.data / "npy" / f"{clip}.npy", allow_pickle=False).reshape(-1, 125, 3)
        cm = m["norm"]["scale"] * 100
        body = x[:, [R_WRIST, L_WRIST]]
        hands = x[:, [R_HAND_ROOT, L_HAND_ROOT]]
        gaps = np.linalg.norm(body - hands, axis=-1) * cm
        frame, side = np.unravel_index(gaps.argmax(), gaps.shape)
        active = gaps[m["active"][0]:m["active"][1] + 1]
        radius_body = np.linalg.norm(body - x[:, NECK, None], axis=-1) * cm
        radius_hand = np.linalg.norm(hands - x[:, NECK, None], axis=-1) * cm
        rows.append({"clip": clip, "peak_cm": float(gaps[frame, side]), "peak_frame": int(frame),
                     "side": "right" if side == 0 else "left", "active_peak_cm": float(active.max()),
                     "frames_over_100cm": int((gaps.max(axis=1) > 100).sum()),
                     "peak_body_neck_cm": float(radius_body[frame, side]),
                     "peak_hand_neck_cm": float(radius_hand[frame, side]),
                     "median_body_neck_cm": float(np.median(radius_body[:, side])),
                     "median_hand_neck_cm": float(np.median(radius_hand[:, side])),
                     "peak_inside_active": m["active"][0] <= int(frame) <= m["active"][1]})
    label25 = []
    pat = re.compile(r"NIA_SL_(WORD\d+)_(REAL25)_F(?:_|\.)")
    with zipfile.ZipFile(args.labels) as archive:
        for name in archive.namelist():
            match = pat.search(Path(name).name)
            if not match or not name.endswith(".json"):
                continue
            doc = json.loads(archive.read(name).decode("utf-8-sig"))
            m = metas.get(f"{match[1]}_REAL02")
            duration = doc.get("metaData", {}).get("duration")
            label25.append({"item": match[1], "motion_frames": m["frames"] if m else None,
                            "label_duration_s": duration, "motion_duration_s_assuming_30fps": m["frames"] / 30 if m else None,
                            "duration_difference_s": abs(float(duration) - m["frames"] / 30) if m and duration is not None else None})
    ranked = sorted(rows, key=lambda r: r["peak_cm"], reverse=True)
    severe = [r for r in ranked if r["peak_cm"] > 100]
    summary = {"candidate_clips": len(rows), "peak_over_100cm": len(severe),
               "peak_over_100cm_by_signer": dict(Counter(r["clip"].split("_")[-1] for r in severe)),
               "active_peak_over_100cm": sum(r["active_peak_cm"] > 100 for r in rows),
               "top3": ranked[:3], "real25_comparisons": len(label25),
               "real25_duration_difference_s_p50_max": np.percentile([r["duration_difference_s"] for r in label25 if r["duration_difference_s"] is not None], [50, 100]).tolist(),
               "scope": "733 raw-mean-gap candidates only; not a full peak-gap screening"}
    (args.audit / "diagnosis.json").write_text(json.dumps({"summary": summary, "candidates": ranked, "real25": label25}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
