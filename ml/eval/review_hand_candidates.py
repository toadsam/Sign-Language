"""근접 후보의 손목 궤적과 손목 기준 손가락 좌표를 읽기 전용 비교한다.

좌표 차이는 별개 표본으로 보존하는 사용자 기준이며 의미가 다른 단어라는
판정이 아니다. epsilon은 수치 오차 진단값이며 자동 제외 임계값이 아니다.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from recog.features import joint_index, prepare


def metrics(a, b):
    delta = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    distances = np.linalg.norm(delta, axis=-1)
    return {"equal": bool(np.array_equal(a, b)),
            "rms": float(np.sqrt(np.mean(delta ** 2))),
            "max_point_distance": float(distances.max()),
            "point_fraction_over_1e_minus_6": float(np.mean(distances > 1e-6))}


def hands(x):
    return x[:, 13:55].reshape(len(x), 2, 21, 3)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() or args.data.resolve() in args.out.resolve().parents:
        raise ValueError("원본 밖의 새 출력 파일을 지정하세요.")
    meta_file = args.data / "meta.jsonl"
    protected = {str(p): sha(p) for p in (meta_file, args.candidates)}
    metas = {m["clip"]: m for m in map(json.loads, meta_file.read_text().splitlines())}
    rows = []
    for candidate in json.loads(args.candidates.read_text()):
        clips = candidate["clips"]
        arrays = []
        for clip in clips:
            p = args.data / "npy" / f"{clip}.npy"
            protected[str(p)] = sha(p)
            arrays.append(np.load(p, allow_pickle=False).reshape(-1, 125, 3))
        a, b = arrays
        if a.shape != b.shape:
            raise ValueError(f"원본 프레임 수가 다릅니다: {clips}")
        prepared = [prepare(x, metas[c]["active"], joint_index(False), 64)
                    [:, :165].reshape(64, 55, 3) for c, x in zip(clips, arrays)]
        ha, hb = map(hands, arrays)
        pa, pb = map(hands, prepared)
        row = {"clips": clips, "same_label": metas[clips[0]]["item"] == metas[clips[1]]["item"],
               "body_equal": bool(np.array_equal(a[:, :13], b[:, :13])),
               "face_equal": bool(np.array_equal(a[:, 55:], b[:, 55:])),
               "full_hand": metrics(ha, hb),
               "active_resampled_hand": metrics(pa, pb),
               "active_wrist": metrics(pa[:, :, 0], pb[:, :, 0]),
               "active_fingers_relative_to_wrist": metrics(
                   pa[:, :, 1:] - pa[:, :, :1], pb[:, :, 1:] - pb[:, :, :1])}
        row["user_policy"] = ("keep_as_distinct_samples" if not row["full_hand"]["equal"]
                              else "hands_identical_requires_other_checks")
        rows.append(row)
    assert all(sha(Path(p)) == value for p, value in protected.items()), "Source changed"
    report = {"units": "shoulder-width normalized coordinates",
              "interpretation": "coordinate difference does not establish different lexical meanings or independent recordings",
              "epsilon": 1e-6, "source_hashes_unchanged": True,
              "pairs": rows}
    with args.out.open("x") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({"pairs": len(rows), "hands_different": sum(not r["full_hand"]["equal"] for r in rows),
                      "remaining_eight": [r for r in rows if not r["body_equal"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
