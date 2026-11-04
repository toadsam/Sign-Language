"""준비된 읽는 모델 데이터 전체를 스트리밍 검사하고 요약만 저장한다."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np

from common.data import apply_split, load_split
from recog.features import joint_index, prepare
from recog.infer import validate_motion
from recog.prepare_data import apply_duplicate_groups, select_records


def fingerprint(x):
    x = np.ascontiguousarray(x, dtype=np.float32)
    return hashlib.sha256(str(x.shape).encode() + x.tobytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True)
    args = ap.parse_args()
    data = Path(args.data)
    report = json.loads((data / "preparation.json").read_text())
    split = load_split(str(data))
    assert split == json.loads((data / "split_snapshot.json").read_text()), "공용 분할표 변경"
    rows = [json.loads(line) for line in (data / "meta.jsonl").read_text().splitlines()]
    source = Path(report["source"])
    original = [json.loads(line) for line in (source / "meta.jsonl").read_text().splitlines()]
    expected, classes, _ = select_records(original, split, report["max_classes"], report["min_signers"])
    if "deduplication" in report:
        manifest = json.loads((data / "deduplication.json").read_text())
        expected, verified = apply_duplicate_groups(expected, source, split, manifest["groups"])
        assert verified == manifest, "중복 원본 또는 제외 정책 변경"
        assert verified["removed_clips"] == report["deduplication"]["removed_clips"]
    assert rows == expected, "원본 품질 필터와 준비된 메타 불일치"
    assert classes == json.loads((data / "classes.json").read_text()), "어휘 불일치"
    joints = joint_index(False)
    split_by_signer = {s: p for p, ss in split["signers"].items() for s in ss}
    duplicate_hashes = {"full_coordinates": defaultdict(set), "model_input_features": defaultdict(set)}
    for i, m in enumerate(rows, 1):
        path = data / "npy" / f"{m['clip']}.npy"
        assert path.is_symlink() and path.resolve() == (source / "npy" / path.name).resolve()
        x = np.load(path, allow_pickle=False)
        x, active = validate_motion(x, m["active"])
        if "frames" in m:
            assert len(x) == m["frames"], "프레임 수 불일치"
        feat = prepare(x, active, joints, 64)
        assert feat.shape == (64, 330) and np.isfinite(feat).all(), "특징 추출 실패"
        part = split_by_signer[m["signer"]]
        duplicate_hashes["full_coordinates"][fingerprint(x.reshape(-1, 125, 3))].add(part)
        duplicate_hashes["model_input_features"][fingerprint(feat)].add(part)
        if i % 5000 == 0:
            print(f"validated {i}/{len(rows)}", flush=True)
    partitions = dict(zip(("train", "val", "test"), apply_split(rows, split)))
    counts = {k: len(v) for k, v in partitions.items()}
    assert counts == report["counts"]
    duplicate_counts = {k: sum(len(parts) > 1 for parts in groups.values())
                        for k, groups in duplicate_hashes.items()}
    if "deduplication" in report:
        assert not any(duplicate_counts.values()), "중복 처리 후 분할 간 정확 중복이 남았습니다."
    result = {
        "validated_clips": len(rows), "classes": len(classes), "counts": counts,
        "cross_split_exact_duplicate_groups": duplicate_counts,
        "coverage": {k: {"classes": len({m['item'] for m in v}),
                         "missing_classes": sorted(set(classes) - {m['item'] for m in v})}
                     for k, v in partitions.items()},
        "checks": ["source_metadata_and_quality", "unchanged_source_links", "shape", "finite_coordinates",
                   "active_bounds", "frames", "features", "split_snapshot", "classes"],
        "attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용",
    }
    target = data / "validation.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(target)
    print(json.dumps({k: v for k, v in result.items() if k != "coverage"}, ensure_ascii=False), flush=True)
    print("coverage", {k: v["classes"] for k, v in result["coverage"].items()}, flush=True)


if __name__ == "__main__":
    main()
