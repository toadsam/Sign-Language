"""AI Hub 형태소 라벨(zip)을 변환된 클립 meta에 붙인다.

정면(F) 라벨 json 하나 = 클립 하나. 클립 json(`npy/<clip>.json`)과 meta.jsonl에 아래 필드를 **추가**한다.
기존 필드는 바꾸지 않는다 (계약 ①에 필드 추가).

  label     "ok" | "empty"(라벨은 있지만 구간이 비어 있음) | "missing"(라벨 파일 없음)
  gloss     형태소 이름 목록 (시간순)
  segments  [{"name", "start", "end", "f0", "f1", "nonmanual"}]  초 단위 시각과 30fps 프레임 번호(끝 포함)
  question  구간 중 하나라도 의문형 표시가 있으면 true (비수지는 의문형만 라벨에 있다)
  dur_ratio 라벨의 영상 길이 / (프레임 수 / 30). 정상 1.0, 약 3이면 10fps로 뽑힌 클립 (라벨 없으면 null)

문장(SEN) 클립이 있으면 받아쓰기 학습용 `sentences.jsonl` 도 만든다: {"clip", "gloss", "nonmanual"}.

좌표 없이 라벨만 있는 클립(예: REAL25 55개)은 붙이지 않고 개수만 보고한다 (2026-10-14 재훈 결정:
REAL02 누락 55단어와 번호·길이가 맞지만 확인되지 않은 추측으로 연결하지 않는다).

  python -m prep.attach_labels --data C:/aihub/full \
      --labels "C:/aihub/004.수어영상/1.Training/라벨링데이터/REAL/WORD/01_real_word_morpheme.zip" \
               "C:/aihub/004.수어영상/1.Training/라벨링데이터/REAL/SEN/01_real_sen_morpheme.zip" \
               "C:/aihub/004.수어영상/2.Validation/라벨링데이터_231204_add/01_real_sen_morpheme.zip"
"""
import argparse
import collections
import json
import os
import re
import zipfile

FPS = 30
NAME_RE = re.compile(r"NIA_SL_(?P<item>[A-Z]+\d+)_(?P<signer>[A-Z]+\d+)_F_morpheme\.json$")


def read_labels(paths):
    """{clip: 라벨 json}. 정면 F만."""
    out = {}
    for p in paths:
        z = zipfile.ZipFile(p)
        for n in z.namelist():
            m = NAME_RE.search(n)
            if m:
                out[f"{m['item']}_{m['signer']}"] = json.loads(z.read(n).decode("utf-8-sig"))
    return out


def to_fields(lab, frames):
    """라벨 json → 추가 필드와 점검 메모."""
    segs, notes = [], []
    for s in lab.get("data", []):
        names = [a.get("name") for a in s.get("attributes", []) if a.get("name")]
        nm = [v for a in s.get("attributes", []) for v in (a.get("attribute") or []) if v]
        start, end = float(s["start"]), float(s["end"])
        f0, f1 = int(round(start * FPS)), min(int(round(end * FPS)), frames - 1)
        if not end > start:
            notes.append("start>=end")
        if f0 > frames - 1:
            notes.append("start_after_clip")
        for name in names:
            segs.append({"name": name, "start": round(start, 3), "end": round(end, 3), "f0": f0, "f1": f1, "nonmanual": nm})
    segs.sort(key=lambda s: s["start"])
    dur = float(lab.get("metaData", {}).get("duration") or 0)
    if dur and abs(dur - frames / FPS) > 0.5:
        notes.append("duration_mismatch")
    # 영상 길이 / (프레임 수 / 30). 정상은 1.0. 약 3이면 키포인트가 10fps로 뽑힌 클립이다(REAL02에 많음).
    # 이런 클립은 동작이 3배 빠르게 보이고 구간 시각(f0, f1)도 맞지 않는다
    ratio = round(dur / (frames / FPS), 3) if dur else None
    return {"label": "ok" if segs else "empty", "gloss": [s["name"] for s in segs], "segments": segs,
            "question": any("의문" in v for s in segs for v in s["nonmanual"]), "dur_ratio": ratio}, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--labels", nargs="+", required=True, help="형태소 라벨 zip들")
    args = ap.parse_args()

    labels = read_labels(args.labels)
    npy_dir = os.path.join(args.data, "npy")
    clips = sorted(f[:-5] for f in os.listdir(npy_dir) if f.endswith(".json"))
    stat, notes_all = collections.Counter(), collections.Counter()
    metas, sentences = [], []
    for c in clips:
        jp = os.path.join(npy_dir, f"{c}.json")
        m = json.load(open(jp, encoding="utf-8"))
        if c in labels:
            add, notes = to_fields(labels[c], m["frames"])
            notes_all.update(notes)
        else:
            add = {"label": "missing", "gloss": [], "segments": [], "question": False, "dur_ratio": None}
        m.update(add)
        r = m["dur_ratio"]
        stat[("dur_ratio", "~1 (0.85–1.5)" if r and 0.85 <= r < 1.5 else "≥1.5 (10fps 등)" if r and r >= 1.5 else "<0.85" if r else "없음")] += 1
        stat[(m["type"], m["label"])] += 1
        with open(jp, "w", encoding="utf-8") as fh:
            json.dump(m, fh, ensure_ascii=False)
        metas.append(m)
        if m["type"] == "SEN" and m["label"] == "ok":
            sentences.append({"clip": c, "gloss": m["gloss"], "nonmanual": ["의문"] if m["question"] else []})

    with open(os.path.join(args.data, "meta.jsonl"), "w", encoding="utf-8") as fh:
        for m in metas:
            fh.write(json.dumps(m, ensure_ascii=False) + "\n")
    if sentences:
        with open(os.path.join(args.data, "sentences.jsonl"), "w", encoding="utf-8") as fh:
            for s in sentences:
                fh.write(json.dumps(s, ensure_ascii=False) + "\n")

    unused = sorted(set(labels) - set(clips))
    by = collections.Counter(re.sub(r"\d+", "", c.split("_")[0]) + " " + c.split("_")[1] for c in unused)
    print(f"라벨 {len(labels)}개 읽음 · 클립 {len(clips)}개")
    for (t, s), v in sorted(stat.items()):
        print(f"  {t} {s}: {v}")
    print("구간 점검:", dict(notes_all) or "문제 없음")
    print(f"좌표 없이 라벨만 있는 것 {len(unused)}개 — 연결하지 않음. 종류·수행자별 상위 {dict(by.most_common(5))}")
    if sentences:
        print(f"sentences.jsonl: {len(sentences)}문장")


if __name__ == "__main__":
    main()
