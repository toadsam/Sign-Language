"""정식 데이터 확인 스크립트. 받은 폴더를 훑어서 학습 전에 알아야 할 것을 한 번에 보고한다.

확인하는 것
  1. 클립 구성: 종류(WORD/SEN/…) · 방향 · 수행자 수 · 항목 수 · 항목당 수행자 수
  2. 키포인트 형식: 3D 좌표가 있는지, 점 개수, 클립당 프레임 수
  3. 라벨 파일: 형태소 이름 · 시작/끝 시각 · 비수지 정보가 있는지, 클립과 얼마나 짝지어지는지
  4. 한국어 원문 문장이 라벨 안에 있는지 (생성 모델 입력 방식이 이것으로 정해진다)
  5. 아직 풀지 않은 압축 파일, 용량 추정

  python -m prep.inspect_dataset --root "D:/aihub/수어영상" --out data/inspect_report.json

프레임 JSON이 수백만 개라 전부 열지 않고 표본만 연다.
"""
import argparse
import collections
import json
import os
import random
import re
import sys

from common.fs import long_path

CLIP_RE = re.compile(r"NIA_SL_(?P<item>[A-Z]+\d+)_(?P<signer>[A-Z]+\d+)_(?P<view>[DFLRU])$")
ID_RE = re.compile(r"(?P<item>[A-Z]+\d+)_(?P<signer>[A-Z]+\d+)")
HANGUL = re.compile(r"[가-힣]")
TEXT_KEYS = re.compile(r"kor|text|sent|sentence|문장|원문|script|trans", re.I)


def walk(root):
    """클립 폴더는 안으로 들어가지 않고 이름만 기록한다."""
    clips, files = [], []
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            entries = list(os.scandir(long_path(d)))
        except OSError as e:
            print(f"  읽기 실패: {d} ({e})")
            continue
        for e in entries:
            if e.is_dir(follow_symlinks=False):
                (clips.append(e.path) if CLIP_RE.match(e.name) else stack.append(e.path))
            elif e.is_file(follow_symlinks=False):
                files.append((e.path, e.stat().st_size))
    return clips, files


def strings_in(obj, path=""):
    """JSON 안의 모든 문자열을 (경로, 값)으로 꺼낸다."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from strings_in(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            yield from strings_in(v, f"{path}[]")
    elif isinstance(obj, str):
        yield path, obj


def describe_label(path):
    with open(long_path(path), encoding="utf-8-sig") as fh:
        d = json.load(fh)
    info = {"file": os.path.basename(path), "top_keys": list(d)[:10] if isinstance(d, dict) else type(d).__name__}
    segs = []
    # 형태소 구간: start/end 가 있는 dict 목록
    def find_segments(o):
        if isinstance(o, dict):
            if "start" in o and "end" in o:
                segs.append(o)
            for v in o.values():
                find_segments(v)
        elif isinstance(o, list):
            for v in o:
                find_segments(v)
    find_segments(d)
    info["segments"] = len(segs)
    if segs:
        info["segment_example"] = json.dumps(segs[0], ensure_ascii=False)[:200]
        info["has_nonmanual"] = any("attribute" in json.dumps(s, ensure_ascii=False) for s in segs)
    # 한국어 원문 후보: 공백이 있는 한글 문자열, 또는 이름이 원문처럼 생긴 키
    # 비수지 속성(attribute: "의문사없는 의문형" 등)은 원문이 아니므로 뺀다
    cands = [(p, v) for p, v in strings_in(d)
             if HANGUL.search(v) and "attribute" not in p
             and (" " in v.strip() or TEXT_KEYS.search(p.split(".")[-1] or ""))]
    info["korean_text_candidates"] = [{"key": p, "value": v[:80]} for p, v in cands[:5]]
    return info


def describe_keypoint(folder):
    folder = long_path(folder)
    files = sorted(f for f in os.listdir(folder) if f.endswith(".json"))
    out = {"frames": len(files)}
    if files:
        with open(os.path.join(folder, files[0]), encoding="utf-8") as fh:
            d = json.load(fh)
        p = d.get("people", {})
        if isinstance(p, list):
            p = p[0] if p else {}
        out["keys"] = sorted(p)
        out["has_3d"] = all(k in p for k in ("pose_keypoints_3d", "hand_left_keypoints_3d",
                                              "hand_right_keypoints_3d", "face_keypoints_3d"))
        out["points_3d"] = {k: len(v) // 4 for k, v in p.items() if k.endswith("_3d")}
        out["has_camparam"] = "camparam" in d
        out["bytes"] = sum(os.path.getsize(os.path.join(folder, f)) for f in files)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--samples", type=int, default=30)
    args = ap.parse_args()
    random.seed(0)

    print(f"훑는 중: {args.root}")
    clips, files = walk(args.root)
    report = {"root": args.root}

    # ---- 1. 클립 구성
    parsed = []
    for c in clips:
        m = CLIP_RE.match(os.path.basename(c))
        t = re.sub(r"\d+", "", m["item"])
        parsed.append((c, t, m["item"], m["signer"], m["view"]))
    types = collections.Counter(p[1] for p in parsed)
    report["clip_folders"] = len(parsed)
    report["types"] = dict(types)
    report["views"] = dict(collections.Counter(p[4] for p in parsed))
    for t in types:
        rows = [p for p in parsed if p[1] == t and p[4] == "F"]
        signers_per_item = collections.Counter()
        per = collections.defaultdict(set)
        for _, _, item, signer, _ in rows:
            per[item].add(signer)
        signers_per_item.update(len(s) for s in per.values())
        report[f"{t}"] = {
            "items": len(per), "signers": len({p[3] for p in rows}),
            "front_clips": len(rows),
            "signers_per_item": dict(sorted(signers_per_item.items())),
        }

    # ---- 2. 키포인트 표본
    fronts = [p[0] for p in parsed if p[4] == "F"]
    sample = random.sample(fronts, min(args.samples, len(fronts)))
    kp = [describe_keypoint(f) for f in sample]
    if kp:
        frames = [k["frames"] for k in kp]
        report["keypoint_sample"] = {
            "folders": len(kp), "has_3d_all": all(k.get("has_3d") for k in kp),
            "points_3d": kp[0].get("points_3d"), "frames_min_avg_max": [min(frames), sum(frames) // len(frames), max(frames)],
            "avg_bytes_per_clip": sum(k.get("bytes", 0) for k in kp) // len(kp),
        }

    # ---- 3·4. 라벨 파일
    other_json = [p for p, _ in files if p.endswith(".json")]
    report["label_json_files"] = len(other_json)
    labels = [describe_label(p) for p in random.sample(other_json, min(args.samples, len(other_json)))]
    report["label_sample"] = labels[:5]
    ids_with_label = {f"{m['item']}_{m['signer']}" for p in other_json if (m := ID_RE.search(os.path.basename(p)))}
    clip_ids = {f"{p[2]}_{p[3]}" for p in parsed}
    report["label_coverage"] = round(len(clip_ids & ids_with_label) / max(len(clip_ids), 1), 4)
    report["korean_text_found"] = any(l["korean_text_candidates"] for l in labels)

    # ---- 5. 기타 파일
    ext = collections.Counter(os.path.splitext(p)[1].lower() for p, _ in files)
    report["other_files"] = dict(ext)
    archives = [p for p, _ in files if re.search(r"\.(zip|tar|gz|7z|z\d\d|part\d*)$", p, re.I)]
    report["archives_not_extracted"] = len(archives)
    report["mp4_gb"] = round(sum(s for p, s in files if p.lower().endswith(".mp4")) / 1e9, 2)
    if kp:
        report["front_keypoint_gb_estimate"] = round(report["keypoint_sample"]["avg_bytes_per_clip"] * len(fronts) / 1e9, 3)

    # ---- 요약
    print("\n=== 요약 ===")
    print(f"클립 폴더 {len(parsed)}개 · 종류 {dict(types)} · 방향 {report['views']}")
    for t in types:
        r = report[t]
        print(f"  {t}: 항목 {r['items']}개 · 수행자 {r['signers']}명 · 정면 클립 {r['front_clips']}개 · 항목당 수행자 수 분포 {r['signers_per_item']}")
    if kp:
        s = report["keypoint_sample"]
        print(f"키포인트: 3D {'있음' if s['has_3d_all'] else '없음(!)'} · 점 {s['points_3d']} · 프레임 최소/평균/최대 {s['frames_min_avg_max']}")
        gb = report["front_keypoint_gb_estimate"]
        print(f"정면 키포인트 용량 추정 {gb:.1f}GB" if gb >= 1 else f"정면 키포인트 용량 추정 {gb * 1000:.0f}MB")
    print(f"라벨 JSON {len(other_json)}개 · 클립과 짝지어진 비율 {report['label_coverage']:.1%}")
    if labels:
        l0 = labels[0]
        print(f"  예시 {l0['file']}: 구간 {l0['segments']}개 · 비수지 {'있음' if l0.get('has_nonmanual') else '없음'}")
        if l0.get("segment_example"):
            print(f"  구간 예: {l0['segment_example']}")
    print(f"한국어 원문 문장: {'있어 보임' if report['korean_text_found'] else '못 찾음'}")
    for l in labels:
        for c in l["korean_text_candidates"][:2]:
            print(f"  후보 {l['file']} {c['key']} = {c['value']}")
        if l["korean_text_candidates"]:
            break
    if archives:
        print(f"아직 풀지 않은 압축 파일 {len(archives)}개가 있습니다. 먼저 풀어야 합니다.")
    print(f"영상 {report['mp4_gb']}GB · 파일 확장자 {dict(ext)}")

    print("\n=== 판단 ===")
    if not other_json:
        print("- 라벨 파일이 없습니다. 단어 이름·형태소 시각 없이는 받아쓰기 모델을 학습할 수 없습니다. AI Hub에서 라벨링데이터의 형태소 파일을 받았는지 확인하세요.")
    elif report["korean_text_found"]:
        print("- 한국어 원문이 있어 보입니다 → 생성 모델 입력을 한국어 문장으로 할 수 있습니다. 후보 키가 정말 원문인지 눈으로 확인하세요.")
    else:
        print("- 한국어 원문을 못 찾았습니다 → 생성 모델 입력은 형태소(글로스) 열로 하고, 서비스에서는 1학기 어순 변환기를 씁니다.")
    if "SEN" not in types:
        print("- 문장(SEN) 클립이 없습니다. 단어 사이 전환 학습에는 문장 데이터가 필요합니다.")

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        json.dump(report, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n보고서: {args.out}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
