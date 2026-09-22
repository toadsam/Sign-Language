"""AI Hub 수어 키포인트 JSON → 정규화된 3D 동작 npy.

처리 순서 (계획서 5.1절):
  1. 정면(F) 폴더만 읽기 — 3D 좌표는 5방향 파일에서 동일하다
  2. 125점 선택 (하체 가짜 점, conf 값 제외)
  3. 결측 보간 (좌표가 0인 관절)
  4. 평활화 (Savitzky–Golay)
  5. 손 뼈 길이 보정 (프레임마다 손가락이 늘었다 줄었다 하는 떨림 제거)
  6. 정규화: 원점 = 목, 어깨선을 x축에 평행하게 회전, 어깨너비로 나눔
  7. 움직임 구간(active) 검출 — 단어 클립은 손 내린 자세로 시작·끝난다

사용:
  python -m prep.preprocess --src "<01_real_word_keypoint 폴더>" --out data/sample
  python -m prep.preprocess --src "<정식 라벨링데이터 폴더>" --out data/full --types WORD,SEN --workers 8
"""
import argparse
import json
import os
import re
import sys

import numpy as np
from scipy.signal import savgol_filter

from common.fs import long_path
from common.skeleton import (
    FACE, HAND_PARENTS, L_HAND_ROOT, L_SHOULDER, L_WRIST, N_JOINTS, NECK,
    POSE_KEEP, R_HAND_ROOT, R_SHOULDER, R_WRIST,
)

CLIP_RE = re.compile(r"NIA_SL_(?P<item>[A-Z]+\d+)_(?P<signer>[A-Z]+\d+)_(?P<view>[DFLRU])$")


def load_clip(folder):
    """폴더 안 프레임 JSON을 파일 이름순으로 읽어 [T, 125, 3] (미터)로 쌓는다.

    파일 번호가 건너뛰는 경우(예: WORD1515_L)가 있어 번호가 아니라 정렬 순서를 쓴다.
    """
    folder = long_path(folder)
    files = sorted(f for f in os.listdir(folder) if f.endswith("_keypoints.json"))
    frames = np.full((len(files), N_JOINTS, 3), np.nan)
    for t, name in enumerate(files):
        with open(os.path.join(folder, name), encoding="utf-8") as fh:
            p = json.load(fh)["people"]
        if isinstance(p, list):
            p = p[0] if p else {}
        try:
            pose = np.asarray(p["pose_keypoints_3d"], float).reshape(-1, 4)[POSE_KEEP, :3]
            lh = np.asarray(p["hand_left_keypoints_3d"], float).reshape(-1, 4)[:, :3]
            rh = np.asarray(p["hand_right_keypoints_3d"], float).reshape(-1, 4)[:, :3]
            face = np.asarray(p["face_keypoints_3d"], float).reshape(-1, 4)[:, :3]
        except (KeyError, ValueError):
            continue  # 프레임 전체 결측 → 아래에서 보간
        frames[t] = np.concatenate([pose, lh, rh, face])
    # 세 좌표가 모두 0이면 검출 실패로 본다
    frames[np.all(frames == 0, axis=-1)] = np.nan
    return frames


def fill_missing(x):
    """관절별 시간축 선형 보간. 결측 비율을 함께 돌려준다."""
    T = x.shape[0]
    miss = np.isnan(x[..., 0])
    ratio = float(miss.mean())
    t = np.arange(T)
    for j in range(x.shape[1]):
        m = miss[:, j]
        if not m.any():
            continue
        if m.all():
            x[:, j] = 0.0
            continue
        for c in range(3):
            x[m, j, c] = np.interp(t[m], t[~m], x[~m, j, c])
    return x, ratio


def smooth(x, window=5, order=2):
    if x.shape[0] < window:
        return x
    return savgol_filter(x, window_length=window, polyorder=order, axis=0)


def hand_bone_lengths(x, root):
    return np.stack([
        np.linalg.norm(x[:, root + c] - x[:, root + p], axis=-1)
        for c, p in enumerate(HAND_PARENTS) if p >= 0
    ], axis=1)  # [T, 20]


def fix_hand_bones(x):
    """손가락 뼈 길이를 클립 중앙값으로 고정. 방향은 그대로 두고 길이만 맞춘다."""
    out = x.copy()
    for root in (L_HAND_ROOT, R_HAND_ROOT):
        med = np.median(hand_bone_lengths(x, root), axis=0)
        k = 0
        for c, p in enumerate(HAND_PARENTS):  # 부모 번호가 항상 자식보다 작다
            if p < 0:
                continue
            d = x[:, root + c] - x[:, root + p]
            d /= np.linalg.norm(d, axis=-1, keepdims=True) + 1e-8
            out[:, root + c] = out[:, root + p] + d * med[k]
            k += 1
    return out


def normalize(x, n_ref=10):
    """원점=목, 어깨선 수평 정렬(세로축 회전), 스케일=평균 어깨너비."""
    ref = x[:n_ref]
    origin = ref[:, NECK].mean(0)
    sh = (ref[:, L_SHOULDER] - ref[:, R_SHOULDER]).mean(0)
    yaw = float(np.arctan2(sh[2], sh[0]))  # 어깨선이 x–z 평면에서 틀어진 각
    c, s = np.cos(yaw), np.sin(yaw)
    rot = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])  # y축 회전
    y = (x - origin) @ rot.T
    scale = float(np.linalg.norm(x[:, L_SHOULDER] - x[:, R_SHOULDER], axis=-1).mean())
    return y / scale, {"origin": origin.round(5).tolist(), "yaw": round(yaw, 5), "scale": round(scale, 5)}


def active_range(y, thresh=0.25, pad=3, n_rest=5):
    """양 손목이 처음 자세에서 어깨너비의 thresh배 넘게 벗어난 구간."""
    wr = y[:, [L_HAND_ROOT, R_HAND_ROOT]]
    d = np.linalg.norm(wr - wr[:n_rest].mean(0), axis=-1).max(-1)
    idx = np.flatnonzero(d > thresh)
    if idx.size == 0:
        return [0, len(y) - 1]
    return [int(max(idx[0] - pad, 0)), int(min(idx[-1] + pad, len(y) - 1))]


def find_clips(src, view, types):
    """src 아래를 모두 뒤져 해당 방향의 클립 폴더를 찾는다 (정식 데이터는 폴더가 여러 겹이다)."""
    found = []
    for root, dirs, _ in os.walk(long_path(src)):
        keep = []
        for d in dirs:
            m = CLIP_RE.match(d)
            if m is None:
                keep.append(d)
            elif m["view"] == view and (not types or re.sub(r"\d+", "", m["item"]) in types):
                found.append(os.path.join(root, d))
        dirs[:] = keep  # 클립 폴더 안(프레임 JSON)으로는 들어가지 않는다
    return sorted(found)


def process(path, out, max_missing):
    """클립 하나 처리. 결과 meta와 점검값을 돌려준다(제외하면 None)."""
    m = CLIP_RE.match(os.path.basename(path))
    clip_id = f"{m['item']}_{m['signer']}"
    raw = load_clip(path)
    raw, miss = fill_missing(raw)
    if miss > max_missing or len(raw) < 16:
        return None, f"제외 {clip_id}: 결측 {miss:.1%}, {len(raw)}프레임"

    # 손 데이터의 왼/오른이 몸 기준과 맞는지 확인 (손목끼리 거리, m)
    gap_r = float(np.linalg.norm(raw[:, R_WRIST] - raw[:, R_HAND_ROOT], axis=-1).mean())
    gap_l = float(np.linalg.norm(raw[:, L_WRIST] - raw[:, L_HAND_ROOT], axis=-1).mean())
    b0 = hand_bone_lengths(raw, R_HAND_ROOT)
    x = fix_hand_bones(smooth(raw))
    b1 = hand_bone_lengths(x, R_HAND_ROOT)
    y, norm = normalize(x)
    act = active_range(y)

    np.save(os.path.join(out, "npy", f"{clip_id}.npy"), y.astype(np.float32))
    cv = lambda b: float((b.std(0) / b.mean(0)).mean())
    meta = {
        "clip": clip_id, "item": m["item"], "signer": m["signer"], "view": m["view"],
        "type": re.sub(r"\d+", "", m["item"]), "frames": int(len(y)), "active": act,
        "missing": round(miss, 4), "norm": norm,
        "check": {"wrist_gap_cm": [round(gap_r * 100, 2), round(gap_l * 100, 2)],
                  "bone_cv": [round(cv(b0), 4), round(cv(b1), 4)]},
    }
    with open(os.path.join(out, "npy", f"{clip_id}.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False)
    return meta, None


def _job(a):
    try:
        return process(*a)
    except Exception as e:  # 깨진 클립 하나 때문에 전체가 멈추지 않게
        return None, f"오류 {os.path.basename(a[0])}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="키포인트 폴더 (하위 폴더까지 모두 찾음)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--view", default="F")
    ap.add_argument("--types", default="", help="쉼표로 구분 (예: WORD,SEN). 비우면 전부")
    ap.add_argument("--max-missing", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--overwrite", action="store_true", help="이미 변환한 클립도 다시 변환")
    args = ap.parse_args()

    npy_dir = os.path.join(args.out, "npy")
    os.makedirs(npy_dir, exist_ok=True)
    types = set(filter(None, args.types.split(",")))
    clips = find_clips(args.src, args.view, types)
    if not clips:
        sys.exit(f"{args.src} 아래에 {args.view} 방향 클립 폴더가 없습니다.")

    def done(p):
        m = CLIP_RE.match(os.path.basename(p))
        return os.path.exists(os.path.join(npy_dir, f"{m['item']}_{m['signer']}.json"))
    todo = clips if args.overwrite else [p for p in clips if not done(p)]
    print(f"클립 {len(clips)}개 중 새로 변환 {len(todo)}개 (작업자 {args.workers})")

    jobs = [(p, args.out, args.max_missing) for p in todo]
    if args.workers > 1:
        from multiprocessing import Pool
        with Pool(args.workers) as pool:
            results = pool.imap_unordered(_job, jobs, chunksize=8)
            for i, (_, msg) in enumerate(results, 1):
                if msg:
                    print(" ", msg)
                if i % 500 == 0:
                    print(f"  {i}/{len(jobs)}")
    else:
        for i, j in enumerate(jobs, 1):
            _, msg = _job(j)
            if msg:
                print(" ", msg)
            if i % 500 == 0:
                print(f"  {i}/{len(jobs)}")

    # 클립별 meta를 모아 meta.jsonl 다시 쓰기 (이어서 변환해도 전체가 들어간다)
    metas = []
    for f in sorted(os.listdir(npy_dir)):
        if f.endswith(".json"):
            with open(os.path.join(npy_dir, f), encoding="utf-8") as fh:
                metas.append(json.load(fh))
    with open(os.path.join(args.out, "meta.jsonl"), "w", encoding="utf-8") as fh:
        for mt in metas:
            fh.write(json.dumps(mt, ensure_ascii=False) + "\n")

    if not metas:
        sys.exit("변환된 클립이 없습니다.")
    if len(metas) <= 40:
        print(f"{'clip':22s} {'T':>4s}  active     손목간격R/L(cm)  오른손 뼈길이 변동(전→후)")
        for mt in metas:
            c = mt["check"]
            print(f"{mt['clip']:22s} {mt['frames']:4d}  {mt['active'][0]:3d}–{mt['active'][1]:3d}   "
                  f"{c['wrist_gap_cm'][0]:5.1f}/{c['wrist_gap_cm'][1]:5.1f}      {c['bone_cv'][0]:.3f} → {c['bone_cv'][1]:.4f}")
    gaps = [max(mt["check"]["wrist_gap_cm"]) for mt in metas]
    print(f"\n저장: {len(metas)}개 클립 → {args.out}  (손목 간격 최대 {max(gaps):.1f}cm — 5cm를 넘으면 손 좌우가 뒤바뀐 클립일 수 있음)")


if __name__ == "__main__":
    main()
