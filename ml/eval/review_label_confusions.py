"""같은 학습 최빈 표기의 오인식을 실제 표기·동일 표현자 손좌표와 대조한다.

표기나 좌표 차이로 수어 의미를 확정하지 않으며 자동 병합/삭제하지 않는다.
원본 좌표는 서버 밖으로 내보내지 않고 숫자 보고서와 선택적 막대손 그림만 쓴다.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np


def majority(variants):
    counts = Counter(tuple(m["gloss"]) for m in variants)
    best = counts.most_common(1)[0][0]
    return best, sum(n == counts[best] for n in counts.values()) == 1


def resample_positions(x, active):
    x = np.asarray(x, dtype=np.float32).reshape(-1, 125, 3)
    a, b = active
    if not 0 <= a <= b < len(x) or not np.isfinite(x).all():
        raise ValueError("유효한 active와 유한 좌표가 필요합니다.")
    y = x[max(a-4, 0):min(b+4, len(x)-1)+1]
    t = np.linspace(0, len(y)-1, 64)
    lo = np.floor(t).astype(int)
    hi = np.minimum(lo+1, len(y)-1)
    w = (t-lo)[:, None, None]
    return (y[lo]*(1-w)+y[hi]*w).astype(np.float32)


def difference(a, b):
    d = np.asarray(a, dtype=np.float64)-np.asarray(b, dtype=np.float64)
    distances = np.linalg.norm(d, axis=-1)
    return {"exact_equal": bool(np.array_equal(a, b)),
            "rms": float(np.sqrt(np.mean(d*d))),
            "max_point_distance": float(distances.max()),
            "point_fraction_over_1e_minus_6": float(np.mean(distances>1e-6))}


def compare_hands(a, b):
    ah, bh = a[:, 13:55].reshape(64, 2, 21, 3), b[:, 13:55].reshape(64, 2, 21, 3)
    return {"hands": difference(ah, bh),
            "wrists": difference(ah[:, :, 0], bh[:, :, 0]),
            "left_fingers": difference(ah[:, 0, 1:]-ah[:, 0, :1], bh[:, 0, 1:]-bh[:, 0, :1]),
            "right_fingers": difference(ah[:, 1, 1:]-ah[:, 1, :1], bh[:, 1, 1:]-bh[:, 1, :1])}


def make_figure(path, a, b, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    edges = [(0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),
             (5,9),(9,10),(10,11),(11,12),(9,13),(13,14),(14,15),(15,16),
             (13,17),(0,17),(17,18),(18,19),(19,20)]
    fig = plt.figure(figsize=(12,6))
    for side, start in enumerate((13,34)):
        for col, frame in enumerate((16,32,47)):
            ax = fig.add_subplot(2,4,side*4+col+1,projection="3d")
            sets = [p[frame,start:start+21]-p[frame,start:start+1] for p in (a,b)]
            extent = max(max(np.abs(s).max() for s in sets)*1.1, 0.01)
            for points, color in zip(sets,("#1565c0","#e76f00")):
                for i,j in edges:
                    ax.plot(*points[[i,j]].T,color=color,linewidth=1)
            ax.set(xlim=(-extent,extent),ylim=(-extent,extent),zlim=(-extent,extent),
                   title=f'{"L" if side==0 else "R"} {frame}/63')
            ax.set_box_aspect((1,1,1))
        ax = fig.add_subplot(2,4,side*4+4)
        for p,color,label in zip((a,b),("#1565c0","#e76f00"),("target","predicted WORD")):
            ax.plot(p[:,start,0],p[:,start,1],color=color,label=label)
        ax.set_title("Wrist path (x/y)"); ax.set_aspect("equal",adjustable="datalim"); ax.legend(fontsize=7)
    fig.suptitle(title+" | blue: target; orange: predicted WORD reference",fontsize=10)
    fig.text(.02,.01,"NIA AI Hub 'Sign Language Video' dataset | normalized coordinates; fixed 64-frame alignment",fontsize=7)
    fig.tight_layout(rect=(0,.03,1,.94)); fig.savefig(path,dpi=120); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, default=Path("/data/work/ryush2002/Sign-Language-recog/ml/runs/recog_3000_dedup3_20261027_1738"),
                        help="기본값: 2026-10-27 중복 처리 후 완료한 모델")
    parser.add_argument("--out", type=Path, help="기본값: run 아래 한국 시각의 새 label_review 폴더")
    parser.add_argument("--expected-cases", type=int, default=8)
    parser.add_argument("--figures", action="store_true")
    args = parser.parse_args()
    if args.out is None:
        args.out=args.run/("label_review_"+datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y%m%d_%H%M%S"))
    if args.out.exists():
        raise ValueError("기존 보고서를 보존하려면 새 출력 폴더를 지정하세요.")
    read = lambda p: json.loads(p.read_text())
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    summary = read(args.run/"summary.json")
    data = Path(summary["config"]["data"])
    source = Path(read(data/"preparation.json")["source"])
    if args.out.resolve()==source.resolve() or source.resolve() in args.out.resolve().parents:
        raise ValueError("원본 데이터 밖의 개인 작업 경로를 쓰세요.")
    protected = {str(p):sha(p) for p in (args.run/"model.pt",args.run/"audit_failures.json",
                                        data/"meta.jsonl",source/"meta.jsonl",data/"split_snapshot.json")}
    if read(data/"split_snapshot.json") != summary["split"]:
        raise ValueError("학습 때의 분할과 현재 스냅샷이 다릅니다.")
    source_checks=args.run/"audit_source_checks.json"
    if source_checks.exists() and read(source_checks)["model_sha256"]!=sha(args.run/"model.pt"):
        raise ValueError("재점검 때와 모델 가중치가 다릅니다.")
    rows = [json.loads(line) for line in (data/"meta.jsonl").read_text().splitlines()]
    original = [json.loads(line) for line in (source/"meta.jsonl").read_text().splitlines()]
    train = set(summary["split"]["signers"]["train"])
    selected = {m["clip"] for m in rows}
    training = defaultdict(list)
    for m in rows:
        if m["signer"] in train:
            training[m["item"]].append(m)
    modes = {item:majority(group) for item,group in training.items()}
    failures = read(args.run/"audit_failures.json")
    cases = [f for f in failures if modes[f["target"]][0]==modes[f["top5"][0]][0]]
    if args.expected_cases and len(cases)!=args.expected_cases:
        raise ValueError(f"예상 {args.expected_cases}건과 실제 {len(cases)}건이 다릅니다.")
    by_clip = {m["clip"]:m for m in original}
    if any(m!=by_clip.get(m["clip"]) for m in rows):
        raise ValueError("학습 메타와 현재 원본 메타가 다릅니다. 버전 확인이 필요합니다.")
    by_item = defaultdict(dict)
    for m in original:
        by_item[m["item"]][m["signer"]]=m
    args.out.mkdir(parents=True)
    pair_results = {}
    case_results = []
    for f in cases:
        target,predicted=f["target"],f["top5"][0]
        key=target+"__"+predicted
        if key not in pair_results:
            labels={}
            for item in (target,predicted):
                groups=defaultdict(list)
                for m in by_item[item].values():
                    groups[tuple(m["gloss"])].append(m["signer"])
                labels[item]=[{"gloss":list(g),"signers":sorted(ss)} for g,ss in groups.items()]
            paired=[]
            for signer in sorted(set(by_item[target])&set(by_item[predicted])):
                ma,mb=by_item[target][signer],by_item[predicted][signer]
                positions=[]
                for m in (ma,mb):
                    p=source/"npy"/f"{m['clip']}.npy"
                    before=sha(p)
                    x=np.load(p,allow_pickle=False)
                    positions.append(resample_positions(x,m["active"]))
                    if sha(p)!=before:
                        raise ValueError("검사 중 원본 좌표가 변경됐습니다.")
                    protected[str(p)]=before
                paired.append({"signer":signer,"clips":[ma["clip"],mb["clip"]],
                               "selected":[ma["clip"] in selected,mb["clip"] in selected],
                               "actual_gloss":[ma["gloss"],mb["gloss"]],
                               "actual_gloss_equal":ma["gloss"]==mb["gloss"],
                               "geometry":compare_hands(*positions)})
            pair_results[key]={"target":target,"predicted":predicted,
                               "training_majority_gloss":list(modes[target][0]),
                               "training_majority_unique":[modes[target][1],modes[predicted][1]],
                               "label_variants":labels,"same_signer_pairs":paired}
        ma=by_clip[f["clip"]]
        reference=by_item[predicted].get(ma["signer"])
        row={"clip":ma["clip"],"target":target,"predicted":predicted,
             "actual_target_gloss":ma["gloss"],"training_majority_gloss":list(modes[target][0]),
             "reference_clip":reference["clip"] if reference else None,
             "reference_in_selected_dataset":reference["clip"] in selected if reference else False,
             "actual_reference_gloss":reference["gloss"] if reference else None,
             "policy":"preserve separate samples; no automatic semantic merge"}
        if reference:
            entry=next(p for p in pair_results[key]["same_signer_pairs"] if p["signer"]==ma["signer"])
            row["geometry"]=entry["geometry"]
            row["actual_gloss_equal"]=entry["actual_gloss_equal"]
            if args.figures:
                positions=[resample_positions(np.load(source/"npy"/f"{m['clip']}.npy",allow_pickle=False),m["active"])
                           for m in (ma,reference)]
                figure=ma["clip"]+"__"+predicted+".png"
                make_figure(args.out/figure,*positions,ma["clip"]+" vs "+reference["clip"])
                row["figure"]=figure
        case_results.append(row)
    if not all(sha(Path(p))==h for p,h in protected.items()):
        raise ValueError("보호 대상 파일이 변경됐습니다.")
    counts={"cases":len(cases),"WORD_pairs":len(pair_results),
            "actual_same_gloss_cases":sum(r.get("actual_gloss_equal",False) for r in case_results),
            "hands_numerically_different_cases":sum(not r["geometry"]["hands"]["exact_equal"] for r in case_results if "geometry" in r),
            "hands_equal_cases":sum(r["geometry"]["hands"]["exact_equal"] for r in case_results if "geometry" in r),
            "missing_same_signer_reference":sum(r["reference_clip"] is None for r in case_results),
            "protected_hashes_unchanged":True}
    report={"counts":counts,"units":"shoulder-width normalized coordinates",
            "policy":"No relabeling, merging, deletion, exclusion changes or retraining",
            "limitations":["Numerical hand differences do not establish different lexical meanings",
                           "Fixed 64-frame alignment; timing/style differences remain",
                           "Training majority gloss is not the ground truth for a particular clip",
                           "Original video/raw keypoints require separate verification"],
            "cases":case_results,"pairs":pair_results,
            "attribution":"한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"}
    (args.out/"review.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    (args.out/"protected_hashes.json").write_text(json.dumps(protected,indent=2)+"\n")
    print(json.dumps(counts,ensure_ascii=False,indent=2))
    print("REPORT_DIR",str(args.out))
    for row in case_results:
        geometry=row.get("geometry",{})
        print(json.dumps({"clip":row["clip"],"target":row["target"],"predicted":row["predicted"],
                          "actual_gloss":[row["actual_target_gloss"],row["actual_reference_gloss"]],
                          "actual_gloss_equal":row.get("actual_gloss_equal"),
                          "reference_in_selected_dataset":row["reference_in_selected_dataset"],
                          "rms":{name:round(part["rms"],8) for name,part in geometry.items()},
                          "hand_max_distance":geometry.get("hands",{}).get("max_point_distance"),
                          "figure":row.get("figure")},ensure_ascii=False))


if __name__=="__main__":
    main()
