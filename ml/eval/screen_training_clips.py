"""전체 WORD의 구조·품질·정확 중복·근접 후보를 읽기 전용으로 검사한다.

근접 판정과 물리 임계값은 검토 후보이며 자동 제외 기준이 아니다.
같은 단어의 쌍은 전수 비교하고, 다른 단어는 고정 난수 투영으로 후보를 찾는다.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import itertools
import json
import math
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from common.data import load_split
from common.skeleton import L_WRIST, R_WRIST, L_HAND_ROOT, R_HAND_ROOT
from eval.audit_recognizer import fingerprint
from recog.features import joint_index, prepare
from recog.infer import validate_motion


def policy_reasons(meta, excluded):
    reasons = []
    if meta["clip"] in excluded:
        reasons.append("common_excluded")
    if meta.get("label") != "ok":
        reasons.append("label_not_ok")
    ratio = meta.get("dur_ratio")
    if (isinstance(ratio, bool) or not isinstance(ratio, (int, float))
            or not math.isfinite(ratio) or not 0.85 <= ratio < 1.5):
        reasons.append("invalid_dur_ratio")
    return reasons


def pair_rms(positions, pairs, threshold):
    """정렬된 동일 길이 좌표의 RMS로 후보를 직접 재검증한다."""
    for start in range(0, len(pairs), 64):
        chunk = np.asarray(pairs[start:start + 64], dtype=np.int64)
        delta = positions[chunk[:, 0]] - positions[chunk[:, 1]]
        distances = np.sqrt(np.square(delta).mean(axis=tuple(range(1, delta.ndim)), dtype=np.float64))
        for (i, j), distance in zip(chunk, distances):
            if distance <= threshold:
                yield int(i), int(j), float(distance)


def global_candidates(positions, valid, items, threshold, neighbors=24, seed=20261027):
    """다른 단어 후보 검색. 전수 검사가 아니며 이웃 수 제한을 기록한다."""
    if len(valid) < 2:
        return [], {"at_neighbor_limit": 0}
    width = int(np.prod(positions.shape[1:]))
    rng = np.random.default_rng(seed)
    projection = rng.normal(size=(width, 16)).astype(np.float32) / np.float32(np.sqrt(width))
    descriptor = np.empty((len(valid), 16), dtype=np.float32)
    for start in range(0, len(valid), 512):
        subset = valid[start:start + 512]
        descriptor[start:start + len(subset)] = positions[subset].reshape(len(subset), -1) @ projection
    radius = 3 * threshold * np.sqrt(16)
    tree = cKDTree(descriptor)
    distances, indices = tree.query(descriptor, k=min(neighbors + 1, len(valid)),
                                    distance_upper_bound=radius, workers=2)
    pairs = set()
    for a, (ds, js) in enumerate(zip(distances, indices)):
        i = valid[a]
        for distance, b in zip(ds, js):
            if not np.isfinite(distance) or b == a:
                continue
            j = valid[int(b)]
            if items[i] != items[j]:
                pairs.add(tuple(sorted((int(i), int(j)))))
    return sorted(pairs), {"projection_dimensions": 16, "seed": seed,
                          "neighbors": neighbors, "projection_radius": float(radius),
                          "at_neighbor_limit": int(np.isfinite(distances[:, -1]).sum())}


def inspect(meta, data, split, selected):
    clip = meta["clip"]
    part = next((p for p, ss in split["signers"].items() if meta["signer"] in ss), "unknown")
    reasons = policy_reasons(meta, set(split.get("exclude", {}).get("clips", [])))
    row = {"clip": clip, "item": meta["item"], "signer": meta["signer"], "split": part,
           "in_selected_dataset": clip in selected, "policy_reasons": reasons,
           "policy_eligible": not reasons, "flags": []}
    try:
        file = data / "npy" / f"{clip}.npy"
        before = file.stat()
        x = np.load(file, allow_pickle=False)
        if x.dtype != np.float32 or x.shape not in ((meta["frames"], 375), (meta["frames"], 125, 3)):
            raise ValueError("shape/dtype/frames mismatch")
        x, active = validate_motion(x, meta["active"])
        if len(x) < 2:
            raise ValueError("Fewer than 2 frames")
        scale = float(meta["norm"]["scale"])
        if not math.isfinite(scale) or scale <= 0 or part == "unknown":
            raise ValueError("Invalid normalization scale or signer")
        y = x.reshape(-1, 125, 3)
        steps = np.linalg.norm(np.diff(y, axis=0), axis=-1) * scale * 100
        gaps = np.linalg.norm(y[:, [R_WRIST, L_WRIST]] - y[:, [R_HAND_ROOT, L_HAND_ROOT]], axis=-1) * scale * 100
        a, b = active
        row.update(frames=len(x), active=list(active), shoulder_scale_m=scale,
                   gap_peak_cm=float(gaps.max()), gap_active_peak_cm=float(gaps[a:b+1].max()),
                   step_peak_cm=float(steps.max()),
                   step_active_peak_cm=float(steps[a:b].max()) if b > a else 0.,
                   motion_std=float(y.std(axis=0).mean()), missing=float(meta.get("missing", 0)))
        for name, condition in (
            ("shorter_than_preprocess_16_frames", len(x) < 16),
            ("shoulder_scale_outside_0.1_to_1m", not 0.1 < scale < 1),
            ("missing_over_20pct", row["missing"] > 0.2),
            ("zero_coordinates", bool(np.all(x == 0))),
            ("frozen_full_clip", not np.any(np.diff(x, axis=0))),
            ("very_low_motion_std", row["motion_std"] < 1e-5),
            ("wrist_gap_over_100cm", row["gap_peak_cm"] > 100),
            ("active_wrist_gap_over_100cm", row["gap_active_peak_cm"] > 100),
            ("frame_step_over_100cm", row["step_peak_cm"] > 100),
            ("active_frame_step_over_100cm", row["step_active_peak_cm"] > 100),
        ):
            if condition:
                row["flags"].append(name)
        features = prepare(x, active, joint_index(False), 64)
        if not np.isfinite(features).all():
            raise ValueError("Nonfinite prepared features")
        row["full_hash"] = fingerprint(x)
        row["feature_hash"] = fingerprint(features)
        after = file.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("Source file changed during read")
        return row, features[:, :165].reshape(64, 55, 3).copy()
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        row["structural_error"] = str(exc)
        return row, None


def exact_summary(groups, rows):
    records = []
    for entries in groups.values():
        if len(entries) < 2:
            continue
        chosen = [i for i in entries if rows[i]["in_selected_dataset"]]
        parts = Counter(rows[i]["split"] for i in entries)
        chosen_parts = Counter(rows[i]["split"] for i in chosen)
        records.append({"clips": [rows[i]["clip"] for i in entries], "splits": dict(parts),
                        "same_item": len({rows[i]["item"] for i in entries}) == 1,
                        "cross_split": len(parts) > 1,
                        "within_split": any(n > 1 for n in parts.values()),
                        "selected_clips": [rows[i]["clip"] for i in chosen],
                        "selected_cross_split": len(chosen_parts) > 1,
                        "selected_within_split": any(n > 1 for n in chosen_parts.values())})
    return records, {"groups": len(records), "clips": len({c for r in records for c in r["clips"]}),
                     "cross_split_groups": sum(r["cross_split"] for r in records),
                     "within_split_groups": sum(r["within_split"] for r in records),
                     "different_item_groups": sum(not r["same_item"] for r in records),
                     "selected_cross_split_groups": sum(r["selected_cross_split"] for r in records),
                     "selected_within_split_groups": sum(r["selected_within_split"] for r in records)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--selected", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--near-rms", type=float, default=0.01)
    args = ap.parse_args()
    if args.out.exists() or args.near_rms <= 0 or not math.isfinite(args.near_rms):
        raise ValueError("새 출력 폴더와 유한 양수 near-rms가 필요합니다.")
    data, out = args.data.resolve(), args.out.resolve()
    if data == out or data in out.parents:
        raise ValueError("원본 데이터 밖에 보고서를 저장하세요.")
    split = load_split(str(data))
    assert split and split["mode"] == "signer"
    original = (data / "meta.jsonl").read_bytes()
    metas = [json.loads(x) for x in original.decode().splitlines()]
    assert len({m['clip'] for m in metas}) == len(metas)
    selected = {m["clip"] for m in (json.loads(x) for x in (args.selected / "meta.jsonl").read_text().splitlines())}
    positions = np.zeros((len(metas), 64, 55, 3), dtype=np.float32)
    rows, valid = [], []
    exact = {"full_coordinates": defaultdict(list), "model_input_features": defaultdict(list)}
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for start in range(0, len(metas), 64):
            results = pool.map(lambda m: inspect(m, data, split, selected), metas[start:start+64])
            for row, pos in results:
                index = len(rows)
                rows.append(row)
                if pos is not None:
                    valid.append(index)
                    positions[index] = pos
                    exact["full_coordinates"][row["full_hash"]].append(index)
                    exact["model_input_features"][row["feature_hash"]].append(index)
            if start // 5000 != len(rows) // 5000 or len(rows) == len(metas):
                print(f"screened {len(rows)}/{len(metas)}", flush=True)
    out.mkdir(parents=True)
    details, duplicate_counts = {}, {}
    for kind, values in exact.items():
        details[kind], duplicate_counts[kind] = exact_summary(values, rows)
    (out / "exact_groups.json").write_text(json.dumps(details, ensure_ascii=False, indent=2))
    with (out / "all_clips.jsonl").open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    same_item = defaultdict(list)
    for i in valid:
        same_item[rows[i]["item"]].append(i)
    same_pairs = [pair for indices in same_item.values() for pair in itertools.combinations(indices, 2)]
    print("near: exhaustive same-item", len(same_pairs), flush=True)
    found = list(pair_rms(positions, same_pairs, args.near_rms))
    print("near: projected different-item candidates", flush=True)
    candidates, search = global_candidates(positions, valid, [r["item"] for r in rows], args.near_rms)
    found.extend(pair_rms(positions, candidates, args.near_rms))
    near = []
    for i, j, distance in found:
        if rows[i]["feature_hash"] == rows[j]["feature_hash"]:
            continue
        near.append({"clips": [rows[i]["clip"], rows[j]["clip"]], "rms_shoulder_units": distance,
                     "same_item": rows[i]["item"] == rows[j]["item"],
                     "cross_split": rows[i]["split"] != rows[j]["split"],
                     "both_in_selected": rows[i]["in_selected_dataset"] and rows[j]["in_selected_dataset"],
                     "split_pair": [rows[i]["split"], rows[j]["split"]]})
    (out / "near_candidates.json").write_text(json.dumps(near, ensure_ascii=False, indent=2))
    selected_rows = [r for r in rows if r["in_selected_dataset"]]
    result = {"expected_clips": len(metas), "structurally_valid": len(valid),
              "structural_errors": sum("structural_error" in r for r in rows),
              "selected_dataset_clips": len(selected_rows),
              "structural_errors_selected": sum("structural_error" in r for r in selected_rows),
              "policy_eligible_clips": sum(r["policy_eligible"] for r in rows),
              "policy_membership_disagreements": sum(r["policy_eligible"] != r["in_selected_dataset"] for r in rows),
              "policy_first_reason": dict(Counter(r["policy_reasons"][0] for r in rows if r["policy_reasons"])),
              "screening_flags_all": dict(Counter(flag for r in rows for flag in r["flags"])),
              "screening_flags_selected": dict(Counter(flag for r in selected_rows for flag in r["flags"])),
              "selected_clips_with_flags": sum(bool(r["flags"]) for r in selected_rows),
              "exact_duplicates": duplicate_counts,
              "near_duplicates": {"rms_threshold_shoulder_units": args.near_rms,
                                  "same_item_pairs_exhaustive": len(same_pairs),
                                  "different_item_candidate_pairs": len(candidates), "search": search,
                                  "confirmed_candidate_pairs": len(near),
                                  "selected_cross_split_pairs": sum(r["both_in_selected"] and r["cross_split"] for r in near),
                                  "selected_within_split_pairs": sum(r["both_in_selected"] and not r["cross_split"] for r in near)},
              "source_meta_unchanged": original == (data / "meta.jsonl").read_bytes(),
              "split_unchanged": split == load_split(str(data)),
              "source_meta_sha256": hashlib.sha256(original).hexdigest(),
              "limitations": ["Heuristic quality flags and near matches are review candidates, not automatic exclusions",
                              "Same-item near search is exhaustive for this RMS; different-item random projection search is approximate and neighbor-capped",
                              "No raw video, semantic correctness or true signer identity verification",
                              "RMS compares fixed-length normalized body/hands; it does not establish physical capture identity"],
              "attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"}
    assert result["source_meta_unchanged"] and result["split_unchanged"]
    (out / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
