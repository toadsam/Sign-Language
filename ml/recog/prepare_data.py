"""읽는 모델용 메타 필터링. 원본 좌표는 복사·수정하지 않고 링크한다."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from common.data import apply_split, load_split
from recog.features import joint_index, prepare


def apply_duplicate_groups(records, source, split, groups):
    """확인된 정확 중복만 제거하며 검증·평가 표본과 공용 분할은 보존한다."""
    source = Path(source)
    by_clip = {m["clip"]: m for m in records}
    parts = {m["clip"]: part for part, rows in zip(
        ("train", "val", "test"), apply_split(records, split)) for m in rows}
    seen, removed, verified = set(), set(), []
    for group in groups:
        clips = sorted(group["clips"])
        if len(clips) < 2 or len(set(clips)) != len(clips) or seen.intersection(clips):
            raise ValueError("중복 그룹은 서로 겹치지 않는 2개 이상의 클립이어야 합니다.")
        seen.update(clips)
        if any(c not in by_clip or c not in parts for c in clips):
            raise ValueError("중복 그룹에 현재 선택 집합 밖의 클립이 있습니다.")
        evaluation = [c for c in clips if parts[c] in ("val", "test")]
        training = [c for c in clips if parts[c] == "train"]
        if len(evaluation) != 1 or len(training) != len(clips) - 1:
            raise ValueError("검증·평가 1개를 보존하고 학습 쪽만 제외할 수 있는 그룹이 아닙니다.")
        if len({by_clip[c]["item"] for c in clips}) != 1:
            raise ValueError("라벨이 다른 중복은 자동 처리하지 않습니다.")
        arrays, features, hashes = [], [], {}
        for clip in clips:
            path = source / "npy" / f"{clip}.npy"
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            x = np.load(path, allow_pickle=False)
            if x.dtype != np.float32 or not np.isfinite(x).all():
                raise ValueError("중복 원본의 dtype/유한값을 확인하세요.")
            arrays.append(x.reshape(-1, 125, 3))
            features.append(prepare(x, by_clip[clip]["active"], joint_index(False), 64))
            if hashlib.sha256(path.read_bytes()).hexdigest() != before:
                raise ValueError("검사 도중 원본이 변경됐습니다.")
            hashes[clip] = before
        if (not all(np.array_equal(arrays[0], x) for x in arrays[1:])
                or not all(np.array_equal(features[0], x) for x in features[1:])):
            raise ValueError("전체 좌표와 실제 모델 입력이 모두 정확히 같은 중복만 처리합니다.")
        removed.update(training)
        verified.append({"clips": clips, "retained": evaluation, "removed": training,
                         "source_file_sha256": hashes})
    return [m for m in records if m["clip"] not in removed], {
        "policy": "preserve_val_test_remove_exact_train_matches",
        "shared_split_unchanged": True, "near_duplicates_removed": False,
        "removed_clips": sorted(removed), "groups": verified}


def select_records(records, split, max_classes=0, min_signers=1):
    if max_classes < 0 or min_signers < 1:
        raise ValueError("max-classes는 0 이상, min-signers는 1 이상이어야 합니다.")
    if split.get("mode") != "signer":
        raise ValueError("정식 데이터에는 표현자 분할표가 필요합니다.")
    groups = [set(split["signers"].get(k, [])) for k in ("train", "val", "test")]
    if any(groups[i] & groups[j] for i in range(3) for j in range(i + 1, 3)):
        raise ValueError("공용 분할표의 표현자가 겹칩니다.")
    excluded = set(split.get("exclude", {}).get("clips", []))
    known = set.union(*groups)
    reasons, accepted, seen = Counter(), [], set()
    for m in records:
        clip = m["clip"]
        if not isinstance(clip, str) or Path(clip).name != clip or clip in ("", ".", ".."):
            raise ValueError("clip은 파일 이름이어야 합니다.")
        if clip in seen:
            raise ValueError("중복 clip이 있습니다.")
        seen.add(clip)
        ratio = m.get("dur_ratio")
        if m.get("type") != "WORD":
            reasons["not_word"] += 1
        elif m["signer"] not in known:
            raise ValueError("분할표에 없는 표현자가 있습니다.")
        elif clip in excluded:
            reasons["split_excluded"] += 1
        elif m.get("label") != "ok":
            reasons["label_not_ok"] += 1
        elif (isinstance(ratio, bool) or not isinstance(ratio, (int, float))
              or not math.isfinite(ratio) or not 0.85 <= ratio < 1.5):
            reasons["invalid_dur_ratio"] += 1
        else:
            accepted.append(m)
    train, _, _ = apply_split(accepted, split)
    counts = {}
    for m in train:
        counts.setdefault(m["item"], set()).add(m["signer"])
    items = sorted((it for it, signers in counts.items() if len(signers) >= min_signers),
                   key=lambda it: (-len(counts[it]), it))
    if max_classes:
        items = items[:max_classes]
    classes = {it: i for i, it in enumerate(sorted(items))}
    if not classes:
        raise ValueError("조건에 맞는 학습 단어가 없습니다.")
    selected = [m for m in accepted if m["item"] in classes]
    reasons["outside_training_vocabulary"] = len(accepted) - len(selected)
    partitions = apply_split(selected, split)
    if any(not group for group in partitions):
        raise ValueError("train/val/test 클립이 모두 필요합니다.")
    report = {
        "input_clips": len(records), "selected_clips": len(selected),
        "classes": len(classes), "dropped_by_first_reason": dict(reasons),
        "counts": {k: len(ms) for k, ms in zip(("train", "val", "test"), partitions)},
        "signers": split["signers"], "max_classes": max_classes, "min_signers": min_signers,
        "policy": {"type": "WORD", "label": "ok", "dur_ratio": "0.85 <= ratio < 1.5",
                   "vocabulary_selection": "training signers only", "coordinates": "unchanged source links"},
        "coordinate_values_validated": False,
    }
    return selected, classes, report


def prepare_dataset(data_dir, out_dir, split, max_classes=0, min_signers=1, duplicate_groups=None):
    source, out = Path(data_dir).resolve(), Path(out_dir).absolute()
    if out.exists() or out.is_symlink():
        raise ValueError("출력 경로가 이미 있습니다. 새 경로를 지정하세요.")
    # common.data.load_split은 데이터 폴더 이름으로 공용 분할표를 찾는다.
    if out.name != source.name:
        raise ValueError("공용 분할표 재사용을 위해 출력의 마지막 폴더 이름은 원본과 같아야 합니다.")
    records = [json.loads(line) for line in (source / "meta.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    selected, classes, report = select_records(records, split, max_classes, min_signers)
    deduplication = None
    if duplicate_groups is not None:
        selected, deduplication = apply_duplicate_groups(selected, source, split, duplicate_groups)
        _, after_classes, _ = select_records(selected, split, max_classes, min_signers)
        if classes != after_classes:
            raise ValueError("중복 처리로 어휘가 바뀝니다. 별도 어휘 정책 검토가 필요합니다.")
        report["selected_clips"] = len(selected)
        report["counts"] = {k: len(ms) for k, ms in zip(("train", "val", "test"), apply_split(selected, split))}
        report["dropped_by_first_reason"]["exact_train_duplicate"] = len(deduplication["removed_clips"])
        report["deduplication"] = {"manifest": "deduplication.json", "removed_clips": deduplication["removed_clips"]}
    for m in selected:
        if not (source / "npy" / f"{m['clip']}.npy").is_file():
            raise ValueError("선택된 클립의 npy 파일이 없습니다.")
    report["source"] = str(source)
    report["split_sha256"] = hashlib.sha256(json.dumps(split, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    (out / "npy").mkdir(parents=True)
    for m in selected:
        (out / "npy" / f"{m['clip']}.npy").symlink_to(source / "npy" / f"{m['clip']}.npy")
    (out / "meta.jsonl").write_text("".join(json.dumps(m, ensure_ascii=False) + "\n" for m in selected), encoding="utf-8")
    for name, value in (("preparation.json", report), ("classes.json", classes), ("split_snapshot.json", split)):
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if deduplication is not None:
        (out / "deduplication.json").write_text(json.dumps(deduplication, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-classes", type=int, default=0)
    ap.add_argument("--min-signers", type=int, default=1)
    ap.add_argument("--duplicate-groups", type=Path, help="전수 검사 exact_groups.json의 full_coordinates 그룹을 재검증 후 적용")
    args = ap.parse_args()
    split = load_split(args.data)
    if split is None:
        raise ValueError("원본에 대응하는 공용 분할표가 없습니다.")
    groups = json.loads(args.duplicate_groups.read_text())["full_coordinates"] if args.duplicate_groups else None
    print(json.dumps(prepare_dataset(args.data, args.out, split, args.max_classes, args.min_signers, groups), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
