"""틀린 귀·눈 좌표(새 번호 9–12)를 다시 계산한다.

정식 WORD 48,000클립을 보니 왼쪽 귀가 약 1.6만 클립에서 처음부터 끝까지 코에서 수 미터 떨어진 곳에 있었다
(원본 검출 실패로 추정, 원본 zip은 이미 삭제). 순간적으로 튀는 귀·눈도 1,144클립(대부분 REAL13)에 있었다.
귀·눈은 수어 의미에 거의 관여하지 않으므로 클립을 버리지 않고 이 4점만 고친다(2026-10-14 재훈 결정).
다른 121점은 건드리지 않는다.

틀린 프레임: 코에서의 거리가 --eye-cm / --ear-cm 를 넘거나, 한 프레임 이동이 --step-cm 를 넘는 프레임.
고치는 순서 (프레임마다)
  1. 대칭: 반대쪽 짝(오른눈↔왼눈, 오른귀↔왼귀)이 그 프레임에 정상이면, 두 눈을 이은 방향을 좌우 축으로 보고
     코를 지나는 얼굴 중심면에 비춘 위치를 쓴다. 고개를 돌리면 같이 따라간다.
     두 눈 중 하나가 틀린 프레임에서는 좌우 축을 어깨선 방향으로 대신한다.
  2. 보간: 짝도 틀렸으면 같은 클립의 정상(또는 1에서 고친) 프레임의 코 기준 위치로 선형 보간.
  3. 수행자 평균: 클립에 쓸 만한 프레임이 하나도 없으면 같은 수행자의 코 기준 평균 위치.

고치기 전 npy와 클립 json을 --backup 에 복사하고, 클립 json의 check.repair 에 방법별 프레임 수를 남긴다.
같은 버전으로 이미 고친 클립은 건너뛴다. --dry-run 은 아무 파일도 쓰지 않고 숫자만 보고한다.

  python -m prep.repair_ears --data C:/aihub/full --dry-run
  python -m prep.repair_ears --data C:/aihub/full --backup C:/aihub/repair_backup/ears_v2
"""
import argparse
import collections
import json
import os
import shutil

import numpy as np

from common.skeleton import L_SHOULDER, NOSE, R_SHOULDER

R_EYE, L_EYE, R_EAR, L_EAR = 9, 10, 11, 12
PAIR = {R_EYE: L_EYE, L_EYE: R_EYE, R_EAR: L_EAR, L_EAR: R_EAR}
JOINTS = [R_EYE, L_EYE, R_EAR, L_EAR]
VERSION = "ears_eyes_v2"


def bad_frames(x, scale, eye_cm, ear_cm, step_cm):
    """{관절: [T] bool}. x 정규화 좌표, scale 미터/어깨너비."""
    cm = scale * 100
    out = {}
    for j in JOINTS:
        lim = eye_cm if j in (R_EYE, L_EYE) else ear_cm
        b = np.linalg.norm(x[:, j] - x[:, NOSE], axis=-1) * cm > lim
        b[1:] |= np.linalg.norm(np.diff(x[:, j], axis=0), axis=-1) * cm > step_cm
        out[j] = b
    return out


def lateral_axis(x, bad):
    """프레임별 좌우 단위 벡터 [T,3]: 두 눈 방향, 눈이 틀린 프레임은 어깨선 방향."""
    eye = x[:, L_EYE] - x[:, R_EYE]
    sh = x[:, L_SHOULDER] - x[:, R_SHOULDER]
    use_sh = bad[R_EYE] | bad[L_EYE]
    u = np.where(use_sh[:, None], sh, eye)
    return u / (np.linalg.norm(u, axis=-1, keepdims=True) + 1e-8)


def repair(x, scale, signer_offset, eye_cm=12.0, ear_cm=25.0, step_cm=30.0):
    """고친 배열과 {관절: {방법: 프레임 수}}. signer_offset: {관절: 코 기준 평균 위치 [3]} 또는 None."""
    x = x.copy()
    T = len(x)
    t = np.arange(T)
    bad = bad_frames(x, scale, eye_cm, ear_cm, step_cm)
    u = lateral_axis(x, bad)
    nose = x[:, NOSE]
    report = {}
    for j in JOINTS:
        b = bad[j].copy()
        if not b.any():
            continue
        r = collections.Counter()
        p = PAIR[j]
        mir = b & ~bad[p]
        if mir.any():
            off = x[mir, p] - nose[mir]
            off = off - 2 * np.sum(off * u[mir], axis=-1, keepdims=True) * u[mir]
            x[mir, j] = nose[mir] + off
            r["mirror"] = int(mir.sum())
            b &= ~mir
        if b.any():
            good = ~b
            off = x[:, j] - nose
            if good.sum() >= 2:
                for c in range(3):
                    off[b, c] = np.interp(t[b], t[good], off[good, c])
                r["interp"] = int(b.sum())
            else:
                off[b] = signer_offset[j] if signer_offset is not None else np.median(off[good], 0) if good.any() else 0.0
                r["signer_mean"] = int(b.sum())
            x[b, j] = nose[b] + off[b]
        report[str(j)] = dict(r)
    return x, report


def signer_offsets(data, metas, eye_cm, ear_cm, step_cm, per_signer=200, seed=0):
    """수행자별 귀·눈의 코 기준 평균 위치(정상 프레임만, 정규화 좌표)."""
    rng = np.random.default_rng(seed)
    by = collections.defaultdict(list)
    for m in metas:
        by[m["signer"]].append(m)
    out = {}
    for s, ms in by.items():
        acc = {j: [] for j in JOINTS}
        for m in rng.permutation(ms)[:per_signer]:
            x = load(data, m["clip"])
            bad = bad_frames(x, m["norm"]["scale"], eye_cm, ear_cm, step_cm)
            for j in JOINTS:
                g = ~bad[j]
                if g.any():
                    acc[j].append((x[g, j] - x[g, NOSE]).mean(0))
        out[s] = {j: np.median(acc[j], 0) if acc[j] else np.zeros(3) for j in JOINTS}
    return out


def load(data, clip):
    return np.load(os.path.join(data, "npy", f"{clip}.npy")).reshape(-1, 125, 3).astype(np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--backup", help="고치기 전 파일을 복사할 곳 (--dry-run 이 아니면 필수)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--eye-cm", type=float, default=12.0)
    ap.add_argument("--ear-cm", type=float, default=25.0)
    ap.add_argument("--step-cm", type=float, default=30.0)
    args = ap.parse_args()
    if not args.dry_run and not args.backup:
        ap.error("--backup 이 필요합니다")

    npy_dir = os.path.join(args.data, "npy")
    metas = [json.loads(l) for l in open(os.path.join(args.data, "meta.jsonl"), encoding="utf-8")]
    lim = (args.eye_cm, args.ear_cm, args.step_cm)
    offsets = signer_offsets(args.data, metas, *lim)

    # 대칭 방식 정확도: 양쪽이 모두 정상인 프레임에서, 오른쪽을 비춘 위치와 실제 왼쪽의 거리
    mirror_err = {"eye": [], "ear": []}
    rng = np.random.default_rng(1)
    for m in rng.permutation(metas)[:500]:
        x = load(args.data, m["clip"])
        bad = bad_frames(x, m["norm"]["scale"], *lim)
        u = lateral_axis(x, bad)
        for name, (a, b) in {"eye": (R_EYE, L_EYE), "ear": (R_EAR, L_EAR)}.items():
            g = ~bad[a] & ~bad[b]
            if g.any():
                off = x[g, a] - x[g, NOSE]
                pred = x[g, NOSE] + off - 2 * np.sum(off * u[g], -1, keepdims=True) * u[g]
                mirror_err[name].append(np.linalg.norm(pred - x[g, b], axis=-1).mean() * m["norm"]["scale"] * 100)

    changed, skipped = 0, 0
    method = collections.Counter()
    joint_clips = collections.Counter()
    if not args.dry_run:
        os.makedirs(args.backup, exist_ok=True)
    for m in metas:
        c = m["clip"]
        if m["check"].get("repair", {}).get("version") == VERSION:
            skipped += 1
            continue
        x0 = load(args.data, c)
        x, rep = repair(x0, m["norm"]["scale"], offsets[m["signer"]], *lim)
        if not rep:
            continue
        changed += 1
        for j, r in rep.items():
            joint_clips[j] += 1
            method.update(r)
        if args.dry_run:
            continue
        xp, jp = os.path.join(npy_dir, f"{c}.npy"), os.path.join(npy_dir, f"{c}.json")
        shape = np.load(xp, mmap_mode="r").shape
        shutil.copy2(xp, os.path.join(args.backup, f"{c}.npy"))
        shutil.copy2(jp, os.path.join(args.backup, f"{c}.json"))
        np.save(xp, x.astype(np.float32).reshape(shape))
        cj = json.load(open(jp, encoding="utf-8"))
        cj["check"]["repair"] = {"version": VERSION, "frames": rep,
                                 "limits_cm": {"eye": args.eye_cm, "ear": args.ear_cm, "step": args.step_cm}}
        with open(jp, "w", encoding="utf-8") as fh:
            json.dump(cj, fh, ensure_ascii=False)

    if not args.dry_run:  # 클립별 json을 모아 meta.jsonl 다시 쓰기 (preprocess와 같은 방식)
        all_meta = [json.load(open(os.path.join(npy_dir, f), encoding="utf-8"))
                    for f in sorted(os.listdir(npy_dir)) if f.endswith(".json")]
        with open(os.path.join(args.data, "meta.jsonl"), "w", encoding="utf-8") as fh:
            for mm in all_meta:
                fh.write(json.dumps(mm, ensure_ascii=False) + "\n")

    names = {str(R_EYE): "오른눈", str(L_EYE): "왼눈", str(R_EAR): "오른귀", str(L_EAR): "왼귀"}
    print(f"{'[시험] ' if args.dry_run else ''}고친 클립 {changed}개 / 이미 고친 클립 건너뜀 {skipped}개 / 전체 {len(metas)}개")
    print("관절별 고친 클립:", {names[k]: v for k, v in sorted(joint_clips.items())})
    print("방법별 프레임:", dict(method))
    for k, v in mirror_err.items():
        if v:
            print(f"대칭 방식 정확도({k}, 양쪽 정상 프레임): 평균 오차 중앙 {np.median(v):.1f}cm, 90% {np.percentile(v, 90):.1f}cm")
    if not args.dry_run:
        print(f"백업: {args.backup}")


if __name__ == "__main__":
    main()
