"""저장된 인식 모델의 점수 재현과 데이터 분리·정확히 같은 입력 중복을 점검한다."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from common.data import apply_split, load_split
from recog.features import prepare
from recog.infer import Recognizer, validate_motion


def fingerprint(x):
    x = np.ascontiguousarray(x, dtype=np.float32)
    return hashlib.sha256(str(x.shape).encode() + x.tobytes()).hexdigest()


def cross_split_duplicates(groups):
    return sum(len({part for part, _ in entries}) > 1 for entries in groups.values())


@torch.inference_mode()
def score_features(recognizer, features):
    """같은 모델·특징·안정 정렬을 묶어서 실행한다. 계약 score와 표본 대조한다."""
    x = torch.from_numpy(np.stack(features)).to(recognizer.device)
    return torch.softmax(recognizer.model(x), -1).cpu().numpy()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--batch", type=int, default=1)
    args = ap.parse_args()
    if args.batch < 1:
        raise ValueError("batch는 양수여야 합니다.")
    torch.set_num_threads(2)
    run = Path(args.run)
    output = run / "audit.json"
    if output.exists():
        raise ValueError("audit.json이 이미 있습니다. 기존 점검 기록을 덮어쓰지 않습니다.")
    summary = json.loads((run / "summary.json").read_text())
    recognizer = Recognizer(str(run), args.device)
    ck = recognizer.checkpoint
    data = Path(ck["config"]["data"])
    rows = [json.loads(line) for line in (data / "meta.jsonl").read_text().splitlines()]
    preparation = json.loads((data / "preparation.json").read_text())
    original = {m["clip"]: m for m in (json.loads(line) for line in
                (Path(preparation["source"]) / "meta.jsonl").read_text().splitlines())}
    sp = ck["split"]
    assert sp == summary["split"] == load_split(data) == json.loads((data / "split_snapshot.json").read_text())
    assert sp["mode"] == "signer"
    assert set(sp["signers"]["test"]) == {"REAL03", "REAL12"}
    assert set(sp["signers"]["val"]) == {"REAL04", "REAL11"}
    parts = ("train", "val", "test")
    signer_groups = [set(sp["signers"][p]) for p in parts]
    assert all(not signer_groups[i] & signer_groups[j] for i in range(3) for j in range(i+1, 3))
    assert len({m["clip"] for m in rows}) == len(rows)
    excluded = set(sp.get("exclude", {}).get("clips", []))
    assert not excluded & {m["clip"] for m in rows}
    assert all(m["type"] == "WORD" and m["label"] == "ok" and 0.85 <= m["dur_ratio"] < 1.5 for m in rows)
    assert all(m == original[m["clip"]] for m in rows)
    assert recognizer.classes == json.loads((data / "classes.json").read_text())
    assert ck["config"] == summary["config"]
    log = [json.loads(line) for line in (run / "log.jsonl").read_text().splitlines()]
    assert all("test_top1" not in row and "test_top5" not in row for row in log)
    assert summary["selection"] == "val_top1"
    assert max(log, key=lambda r: (r["val_top1"], r["iter"])) == summary["best"]
    feature_hashes, motion_hashes, file_targets = defaultdict(list), defaultdict(list), defaultdict(list)
    predictions, metrics, failures = {}, {}, []
    contract_checks, max_probability_difference = 0, 0.0
    for part, metas in zip(parts, apply_split(rows, sp)):
        print(f"Auditing {part}: {len(metas)} clips", flush=True)
        counts = Counter()
        correct1 = correct5 = 0
        confidences, saved, targets = [], [], []
        for start in range(0, len(metas), args.batch):
            batch = []
            for m in metas[start:start + args.batch]:
                file = data / "npy" / f"{m['clip']}.npy"
                assert file.resolve() == (Path(preparation["source"]) / "npy" / file.name).resolve()
                x, active = validate_motion(np.load(file, allow_pickle=False), m["active"])
                features = prepare(x, active, recognizer.joints, recognizer.length)
                entry = (part, m["clip"])
                motion_hashes[fingerprint(x)].append(entry)
                feature_hashes[fingerprint(features)].append(entry)
                file_targets[str(file.resolve())].append(entry)
                batch.append((m, x, active, features))
            probabilities = score_features(recognizer, [b[3] for b in batch])
            for offset, ((m, x, active, _), probs) in enumerate(zip(batch, probabilities)):
                order = np.argsort(-probs, kind="stable")[:5]
                words = [recognizer.items[i] for i in order]
                # 배치 추론이 계약과 같은지 각 배치 첫 test와 모든 오인식에서 대조.
                if part == "test" and (offset == 0 or words[0] != m["item"]):
                    reference = recognizer.score(x, active)
                    assert words == [word for word, _ in reference["top5"]]
                    difference = float(np.max(np.abs(probs - reference["probs"])))
                    assert difference < 1e-5, "배치/계약 추론 확률 불일치"
                    max_probability_difference = max(max_probability_difference, difference)
                    contract_checks += 1
                correct1 += words[0] == m["item"]
                correct5 += m["item"] in words
                targets.append(m["item"])
                saved.append(words[0])
                counts[m["signer"]] += 1
                confidences.append(float(probs[order[0]]))
                if part == "test" and words[0] != m["item"]:
                    failures.append({"clip": m["clip"], "signer": m["signer"], "target": m["item"],
                                     "top5": words, "probabilities": [float(probs[i]) for i in order],
                                     "target_in_top5": m["item"] in words})
            done = start + len(batch)
            if start // 1000 != done // 1000 or done == len(metas):
                print(f"{part}: {done}/{len(metas)}", flush=True)
        predictions[part] = (np.array(saved), np.array(targets))
        metrics[part] = {"clips": len(metas), "top1": correct1 / len(metas), "top5": correct5 / len(metas),
                         "correct_top1": correct1, "counts_by_signer": dict(counts),
                         "evaluated_classes": len(set(targets)),
                         "mean_top1_probability": float(np.mean(confidences))}
    pred, target = predictions["test"]
    rng = np.random.default_rng(773)
    shuffled = [float(np.mean(pred == rng.permutation(target))) for _ in range(100)]
    zero = recognizer.score(np.zeros((recognizer.length, 375), dtype=np.float32))["top5"][0][0]
    result = {
        "run": str(run), "classes": len(recognizer.classes), "metrics": metrics,
        "inference": {"device": args.device, "batch": args.batch, "contract_comparisons": contract_checks,
                      "max_contract_probability_difference": max_probability_difference},
        "checks": {"signers_disjoint": True, "common_split_matches_checkpoint": True,
                   "metadata_matches_original": True, "quality_policy_passed": True,
                   "excluded_clips_absent": True, "test_not_in_selection_log": True,
                   "best_checkpoint_selection_matches_log": True,
                   "class_mapping_matches_dataset": True,
                   "test_top1_matches_summary": metrics["test"]["top1"] == summary["test_top1"],
                   "test_top5_matches_summary": metrics["test"]["top5"] == summary["test_top5"]},
        "cross_split_duplicate_groups": {"source_file": cross_split_duplicates(file_targets),
                                         "full_coordinates": cross_split_duplicates(motion_hashes),
                                         "model_input_features": cross_split_duplicates(feature_hashes)},
        "controls": {"shuffled_label_trials": 100, "shuffled_label_mean_accuracy": float(np.mean(shuffled)),
                     "shuffled_label_max_accuracy": max(shuffled), "zero_input_accuracy": float(np.mean(target == zero))},
        "failures": {"clips": len(failures), "classes": len({m['target'] for m in failures}),
                     "by_signer": dict(Counter(m['signer'] for m in failures)),
                     "outside_top5": sum(not m['target_in_top5'] for m in failures),
                     "details": "audit_failures.json"},
        "attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용",
        "limitations": ["Exact duplicates only; near-duplicate detection not performed",
                        "Original signer labels are trusted, not verified from video",
                        f"Model vocabulary: {len(recognizer.classes)}; evaluated test vocabulary: {metrics['test']['evaluated_classes']}; two test signers",
                        "Single training seed; no independent external dataset"],
    }
    (run / "audit_failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
