"""재점검에서 발견한 정확 중복의 분할 관계와 평가 민감도만 확인한다."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np

from common.data import apply_split
from eval.audit_recognizer import fingerprint
from recog.features import joint_index, prepare
from recog.infer import validate_motion


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True)
    args = ap.parse_args()
    run = Path(args.run)
    output = run / "audit_duplicates.json"
    if output.exists():
        raise ValueError("기존 중복 상세를 덮어쓰지 않습니다.")
    summary = json.loads((run / "summary.json").read_text())
    audit = json.loads((run / "audit.json").read_text())
    failures = json.loads((run / "audit_failures.json").read_text())
    data = Path(summary["config"]["data"])
    rows = [json.loads(line) for line in (data / "meta.jsonl").read_text().splitlines()]
    partitions = dict(zip(("train", "val", "test"), apply_split(rows, summary["split"])))
    joints = joint_index(summary["config"]["with_face"])
    length = summary["config"]["length"]
    groups = {"full_coordinates": defaultdict(list), "model_input_features": defaultdict(list)}
    for part, metas in partitions.items():
        for index, m in enumerate(metas, 1):
            x, active = validate_motion(np.load(data / "npy" / f"{m['clip']}.npy", allow_pickle=False), m["active"])
            entry = {"split": part, "clip": m["clip"], "item": m["item"], "signer": m["signer"]}
            groups["full_coordinates"][fingerprint(x)].append(entry)
            groups["model_input_features"][fingerprint(prepare(x, active, joints, length))].append(entry)
            if index % 10000 == 0:
                print(part, index, flush=True)
    details = {kind: [{"sha256": key, "entries": entries}
                      for key, entries in values.items() if len({e['split'] for e in entries}) > 1]
               for kind, values in groups.items()}
    assert all(len(v) == audit["cross_split_duplicate_groups"][k] for k, v in details.items())
    # 집계뿐 아니라 해당 원본 배열과 특징도 직접 일치하는지 확인한다.
    for kind, records in details.items():
        for record in records:
            arrays = []
            for entry in record["entries"]:
                m = next(m for m in partitions[entry["split"]] if m["clip"] == entry["clip"])
                x, active = validate_motion(np.load(data / "npy" / f"{m['clip']}.npy"), m["active"])
                arrays.append(x if kind == "full_coordinates" else prepare(x, active, joints, length))
            assert all(np.array_equal(arrays[0], a) for a in arrays[1:])
    test_rows = {m["clip"]: m for m in partitions["test"]}
    wrong1 = {m["clip"] for m in failures}
    wrong5 = {m["clip"] for m in failures if not m["target_in_top5"]}
    assert wrong1 <= set(test_rows)
    assert len(test_rows) - len(wrong1) == audit["metrics"]["test"]["correct_top1"]

    def sensitivity(drop):
        keep = set(test_rows) - drop
        correct1, correct5 = len(keep - wrong1), len(keep - wrong5)
        return {"removed_test_clips": len(drop), "test_clips": len(keep),
                "classes": len({test_rows[c]['item'] for c in keep}),
                "correct_top1": correct1, "correct_top5": correct5,
                "top1": correct1 / len(keep), "top5": correct5 / len(keep)}

    test_with_train, test_with_any, val_with_train = set(), set(), set()
    for records in details.values():
        for record in records:
            entries = record["entries"]
            parts = {e["split"] for e in entries}
            test_with_any.update(e["clip"] for e in entries if e["split"] == "test")
            if "train" in parts:
                test_with_train.update(e["clip"] for e in entries if e["split"] == "test")
                val_with_train.update(e["clip"] for e in entries if e["split"] == "val")
    result = {"groups": details,
              "overlap_clips": {"test_with_train": len(test_with_train), "test_with_any_other_split": len(test_with_any),
                                "val_with_train": len(val_with_train)},
              "sensitivity_drop_test_matching_train": sensitivity(test_with_train),
              "sensitivity_drop_test_matching_any_other_split": sensitivity(test_with_any),
              "model_sha256": hashlib.sha256((run / "model.pt").read_bytes()).hexdigest(),
              "limitations": ["Post-hoc test sensitivity only; model and selection remain fixed",
                              "Shared data and splits unchanged; no retraining performed"],
              "attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "groups"}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
