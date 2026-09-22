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
"""
import argparse
import json
import os
import re
import sys

import numpy as np
from scipy.signal import savgol_filter

from common.skeleton import (
    FACE, HAND_PARENTS, L_HAND_ROOT, L_SHOULDER, L_WRIST, N_JOINTS, NECK,
    POSE_KEEP, R_HAND_ROOT, R_SHOULDER, R_WRIST,
)

CLIP_RE = re.compile(r"NIA_SL_(?P<item>[A-Z]+\d+)_(?P<signer>[A-Z]+\d+)_(?P<view>[DFLRU])$")


def load_clip(folder):
    """폴더 안 프레임 JSON을 파일 이름순으로 읽어 [T, 125, 3] (미터)로 쌓는다.

    파일 번호가 건너뛰는 경우(예: WORD1515_L)가 있어 번호가 아니라 정렬 순서를 쓴다.
    """
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="클립 폴더들이 들어 있는 키포인트 폴더")
    ap.add_argument("--out", required=True)
    ap.add_argument("--view", default="F")
    ap.add_argument("--max-missing", type=float, default=0.2)
    args = ap.parse_args()

    os.makedirs(os.path.join(args.out, "npy"), exist_ok=True)
    clips = sorted(d for d in os.listdir(args.src)
                   if (m := CLIP_RE.match(d)) and m["view"] == args.view)
    if not clips:
        sys.exit(f"{args.src} 에 {args.view} 방향 클립 폴더가 없습니다.")

    metas, report = [], []
    for name in clips:
        m = CLIP_RE.match(name)
        raw = load_clip(os.path.join(args.src, name))
        raw, miss = fill_missing(raw)
        if miss > args.max_missing:
            print(f"  제외 {name}: 결측 {miss:.1%}")
            continue

        # 손 데이터의 왼/오른이 몸 기준과 맞는지 확인 (손목끼리 거리, m)
        wrist_gap_r = float(np.linalg.norm(raw[:, R_WRIST] - raw[:, R_HAND_ROOT], axis=-1).mean())
        wrist_gap_l = float(np.linalg.norm(raw[:, L_WRIST] - raw[:, L_HAND_ROOT], axis=-1).mean())

        bones_before = hand_bone_lengths(raw, R_HAND_ROOT)
        x = fix_hand_bones(smooth(raw))
        bones_after = hand_bone_lengths(x, R_HAND_ROOT)
        y, norm = normalize(x)
        act = active_range(y)

        clip_id = f"{m['item']}_{m['signer']}"
        np.save(os.path.join(args.out, "npy", f"{clip_id}.npy"), y.astype(np.float32))
        meta = {
            "clip": clip_id, "item": m["item"], "signer": m["signer"], "view": m["view"],
            "type": re.sub(r"\d+", "", m["item"]), "frames": int(len(y)), "active": act,
            "missing": round(miss, 4), "norm": norm,
        }
        metas.append(meta)
        cv = lambda b: float((b.std(0) / b.mean(0)).mean())
        report.append((clip_id, len(y), act, wrist_gap_r, wrist_gap_l, cv(bones_before), cv(bones_after)))

    with open(os.path.join(args.out, "meta.jsonl"), "w", encoding="utf-8") as fh:
        for mt in metas:
            fh.write(json.dumps(mt, ensure_ascii=False) + "\n")

    print(f"{'clip':22s} {'T':>4s}  active     손목간격R/L(cm)  오른손 뼈길이 변동(전→후)")
    for cid, T, act, gr, gl, b0, b1 in report:
        print(f"{cid:22s} {T:4d}  {act[0]:3d}–{act[1]:3d}   {gr*100:5.1f}/{gl*100:5.1f}      {b0:.3f} → {b1:.4f}")
    print(f"\n저장: {len(metas)}개 클립 → {args.out}")


if __name__ == "__main__":
    main()
