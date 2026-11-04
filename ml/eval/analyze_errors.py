"""원본 인식 오류의 패턴·기하 유사도·구간 경계 민감도를 읽기 전용 분석한다.

평가 오류를 대상으로 한 탐색 분석이며 원인 확정·전처리 선택·성능 개선 추정이 아니다.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from common.data import apply_split
from recog.features import prepare
from recog.infer import Recognizer


def descriptors(features):
    positions = features[:, :165].reshape(64, 55, 3)
    hands = positions[:, 13:55].reshape(64, 2, 21, 3)
    return {"model_input": features.reshape(-1),
            "body": positions[:, :13].reshape(-1),
            "hands": hands.reshape(-1),
            "wrists": hands[:, :, 0].reshape(-1),
            "finger_relative": (hands[:, :, 1:] - hands[:, :, :1]).reshape(-1)}


def windows(active, frames):
    a, b = active
    clamp = lambda v: int(np.clip(v, 0, frames - 1))
    return {"expand8": (clamp(a-8), clamp(b+8)),
            "contract4": (a+4, b-4) if b-a >= 8 else None,
            "shift_minus4": (clamp(a-4), clamp(b-4)),
            "shift_plus4": (clamp(a+4), clamp(b+4)),
            "full_clip": (0, frames-1)}


def quality(meta, row):
    if row["gap_peak_cm"] > 100 or row["step_peak_cm"] > 100:
        return "hold"
    gaps = meta.get("check", {}).get("wrist_gap_cm", [])
    if row["gap_peak_cm"] > 20 or row["step_peak_cm"] > 50 or max(gaps, default=0) > 5:
        return "review"
    return "usable"


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--screen", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        raise ValueError("새 출력 폴더를 지정하세요.")
    torch.set_num_threads(2)
    summary = read(args.run / "summary.json")
    data = Path(summary["config"]["data"])
    protected_paths = [args.run/p for p in ("model.pt", "latest.pt", "summary.json", "audit.json", "audit_failures.json")]
    protected_paths += [data/"meta.jsonl", data/"split_snapshot.json", args.screen/"all_clips.jsonl"]
    protected = {str(p): sha(p) for p in protected_paths}
    rows = [json.loads(line) for line in (data/"meta.jsonl").read_text().splitlines()]
    by_clip = {m["clip"]: m for m in rows}
    train, val, test = apply_split(rows, summary["split"])
    failures = read(args.run/"audit_failures.json")
    old_failures = read(args.baseline/"audit_failures.json")
    failure_ids = {f["clip"] for f in failures}
    old_ids = {f["clip"] for f in old_failures}
    scans = {r["clip"]: r for r in map(json.loads, (args.screen/"all_clips.jsonl").read_text().splitlines())}
    labels = defaultdict(Counter)
    train_counts = Counter(m["item"] for m in train)
    for m in train:
        labels[m["item"]][tuple(m["gloss"])] += 1
    gloss = {item: list(c.most_common(1)[0][0]) for item,c in labels.items()}
    label_variants = {item:len(c) for item,c in labels.items() if len(c)>1}
    words = Counter(f["target"] for f in failures)
    confusions = Counter((f["target"], f["top5"][0]) for f in failures)
    repeated = [{"item":item,"gloss":gloss[item],"errors":n,
                 "test_clips":sum(m["item"]==item for m in test)} for item,n in words.items() if n>1]
    same_label = [f["clip"] for f in failures if gloss[f["target"]] == gloss[f["top5"][0]]]
    error_by_signer = Counter(by_clip[c]["signer"] for c in failure_ids)
    test_by_signer = Counter(m["signer"] for m in test)
    quality_stats = {}
    for status in ("usable", "review", "hold"):
        subset = [m for m in test if quality(m, scans[m["clip"]])==status]
        wrong = sum(m["clip"] in failure_ids for m in subset)
        quality_stats[status] = {"clips":len(subset),"errors":wrong,
                                 "error_rate":wrong/len(subset) if subset else None}
    related = {f["target"] for f in failures} | {f["top5"][0] for f in failures}
    references = defaultdict(list)
    reference_ids = defaultdict(list)
    for i,m in enumerate([m for m in train if m["item"] in related],1):
        x=np.load(data/"npy"/f"{m['clip']}.npy",allow_pickle=False)
        references[m["item"]].append(descriptors(prepare(x,m["active"],np.arange(55),64)))
        reference_ids[m["item"]].append(m["clip"])
        if i%1000==0:
            print("training_references",i,flush=True)
    references = {item:{name:np.stack([r[name] for r in group]) for name in group[0]}
                  for item,group in references.items()}
    recognizer=Recognizer(str(args.run),"cpu")
    details=[]
    for i,f in enumerate(failures,1):
        m=by_clip[f["clip"]]
        x=np.load(data/"npy"/f"{m['clip']}.npy",allow_pickle=False)
        score=recognizer.score(x,m["active"])
        assert score["top5"][0][0]==f["top5"][0]
        order=np.argsort(-score["probs"],kind="stable")
        rank=int(np.flatnonzero(order==recognizer.classes[m["item"]])[0])+1
        d=descriptors(prepare(x,m["active"],np.arange(55),64))
        distances={}
        for name,vector in d.items():
            component={}
            for label,item in (("target",m["item"]),("predicted",f["top5"][0])):
                rms=np.sqrt(np.mean((references[item][name]-vector)**2,axis=1,dtype=np.float64))
                j=int(np.argmin(rms))
                component[label]={"rms":float(rms[j]),"nearest_train_clip":reference_ids[item][j]}
            distances[name]=component
        variants={name:recognizer.score(x,active)["top5"][0][0]==m["item"]
                  for name,active in windows(m["active"],len(x)).items() if active is not None}
        details.append({"clip":m["clip"],"signer":m["signer"],"target":m["item"],
                        "target_gloss":gloss[m["item"]],"predicted":f["top5"][0],
                        "predicted_gloss":gloss[f["top5"][0]],"truth_rank":rank,
                        "truth_probability":float(score["probs"][recognizer.classes[m["item"]]]),
                        "top1_probability":float(score["top5"][0][1]),
                        "was_wrong_before":m["clip"] in old_ids,"quality":quality(m,scans[m["clip"]]),
                        "training_examples":train_counts[m["item"]],"geometry":distances,
                        "window_correct":variants})
        if i%40==0:
            print("error_cases",i,flush=True)
    rng=np.random.default_rng(20261027)
    correct=[m for m in test if m["clip"] not in failure_ids]
    used=set(); controls=[]
    for f in failures:
        candidates=[m for m in correct if m["item"]==f["target"] and m["clip"] not in used]
        mode="same_word_other_signer"
        if not candidates:
            candidates=[m for m in correct if m["signer"]==by_clip[f["clip"]]["signer"] and m["clip"] not in used]
            mode="same_signer_other_word"
        m=candidates[int(rng.integers(len(candidates)))]; used.add(m["clip"])
        x=np.load(data/"npy"/f"{m['clip']}.npy",allow_pickle=False)
        assert recognizer.score(x,m["active"])["top5"][0][0]==m["item"]
        variants={name:recognizer.score(x,active)["top5"][0][0]==m["item"]
                  for name,active in windows(m["active"],len(x)).items() if active is not None}
        controls.append({"clip":m["clip"],"matched_to":f["clip"],"selection":mode,"window_correct":variants})
    sensitivity={name:{"errors_evaluated":sum(name in d["window_correct"] for d in details),
                       "errors_recovered":sum(d["window_correct"].get(name,False) for d in details),
                       "controls_evaluated":sum(name in c["window_correct"] for c in controls),
                       "controls_broken":sum(not c["window_correct"][name] for c in controls if name in c["window_correct"])}
                 for name in windows([8,40],64)}
    confidence=np.array([d["top1_probability"] for d in details])
    result={"errors":len(failures),"error_words":len(words),
            "by_signer":{s:{"clips":n,"errors":error_by_signer[s],"error_rate":error_by_signer[s]/n} for s,n in test_by_signer.items()},
            "repeated_error_words":repeated,"same_gloss_sequence_errors":len(same_label),
            "inconsistent_training_gloss_items":label_variants,
            "top_confusions":[{"target":a,"target_gloss":gloss[a],"predicted":b,"predicted_gloss":gloss[b],"count":n} for (a,b),n in confusions.most_common(15)],
            "truth_rank_counts":dict(Counter(d["truth_rank"] if d["truth_rank"]<=5 else "outside_top5" for d in details)),
            "confidence":{"median_wrong_top1":float(np.median(confidence)),"wrong_top1_over_0_9":int(sum(confidence>.9))},
            "quality":quality_stats,"training_examples":{"error_targets_mean":float(np.mean([train_counts[f['target']] for f in failures])),
                                                           "all_test_targets_mean":float(np.mean([train_counts[m['item']] for m in test]))},
            "old_new":{"improved":len(old_ids-failure_ids),"regressed":len(failure_ids-old_ids),"persistent":len(old_ids&failure_ids)},
            "nearest_training_geometry_predicted_closer_counts":{name:sum(d["geometry"][name]["predicted"]["rms"]<d["geometry"][name]["target"]["rms"] for d in details) for name in details[0]["geometry"]},
            "window_sensitivity":sensitivity,
            "errors_recovered_by_any_window":sum(any(d["window_correct"].values()) for d in details),
            "control_selection":dict(Counter(c["selection"] for c in controls)),
            "limitations":["Exploratory test-set diagnostics, not deployment preprocessing selection or unbiased accuracy improvement",
                           "Euclidean geometry after fixed 64-frame resampling is not a semantic classifier or causal attribution",
                           "Matched correct controls are selected, not a representative test sample",
                           "No raw video or original keypoint provenance verification; 27 near pairs remain"],
            "attribution":"한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"}
    assert all(sha(Path(p))==h for p,h in protected.items()),"Protected artifacts changed"
    args.out.mkdir(parents=True)
    for name,value in (("summary.json",result),("cases.json",details),("controls.json",controls),("protected_hashes.json",protected)):
        (args.out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
