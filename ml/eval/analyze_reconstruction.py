"""복원 오인식의 수치 비교와 좌표 요소별 원본 복구 진단. 원본 데이터는 수정하지 않는다."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from common import metrics as M
from common.viewer import write_viewer
from recog.infer import Recognizer
from vq.model import load_vqvae


HANDS = (slice(13, 34), slice(34, 55))


def geometry_metrics(original, reconstructed, scale):
    """같은 프레임끼리 비교. 손가락 모양은 손목을 뺀 40개 관절로 측정한다."""
    a = np.asarray(original).reshape(-1, 125, 3)
    b = np.asarray(reconstructed).reshape(-1, 125, 3)
    error = np.linalg.norm(a - b, axis=-1) * scale * 1000
    shape = np.concatenate([(a[:, h] - a[:, h.start:h.start+1])[:, 1:] -
                            (b[:, h] - b[:, h.start:h.start+1])[:, 1:] for h in HANDS], axis=1)
    path = M.wrist_path(a)
    return {"body_mm": float(error[:, :13].mean()),
            "hands_mm": float(error[:, 13:55].mean()),
            "left_hand_mm": float(error[:, 13:34].mean()),
            "right_hand_mm": float(error[:, 34:55].mean()),
            "wrists_mm": float(error[:, [13, 34]].mean()),
            "finger_shape_mm": float(np.linalg.norm(shape, axis=-1).mean() * scale * 1000),
            "wrist_path_ratio": M.wrist_path(b) / path if path > 1e-8 else None}


def restore_component(original, reconstructed, component):
    a = np.asarray(original).reshape(-1, 125, 3)
    b = np.asarray(reconstructed).reshape(-1, 125, 3).copy()
    if component == "body":
        b[:, :13] = a[:, :13]
    elif component == "hands":
        b[:, 13:55] = a[:, 13:55]
    elif component == "left_hand":
        b[:, HANDS[0]] = a[:, HANDS[0]]
    elif component == "right_hand":
        b[:, HANDS[1]] = a[:, HANDS[1]]
    elif component == "wrist_trajectories":
        for h in HANDS:
            b[:, h] += a[:, h.start:h.start+1] - b[:, h.start:h.start+1]
    elif component == "finger_shapes":
        for h in HANDS:
            b[:, h] = b[:, h.start:h.start+1] + a[:, h] - a[:, h.start:h.start+1]
    else:
        raise ValueError(component)
    return b.reshape(-1, 375)


def prediction(recognizer, motion, active, item):
    score = recognizer.score(motion, active)
    probs = score["probs"]
    truth = recognizer.classes[item]
    order = np.argsort(-probs, kind="stable")
    rank = int(np.flatnonzero(order == truth)[0]) + 1
    return {"top1": score["top5"][0][0], "truth_rank": rank,
            "truth_probability": float(probs[truth]),
            "top5": score["top5"]}


@torch.inference_mode()
def plot_severe_hands(out, cases, vq, data, metas):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
             (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15),
             (15, 16), (13, 17), (0, 17), (17, 18), (18, 19), (19, 20)]
    fig = plt.figure(figsize=(13, 8))
    details = []
    for i, row in enumerate(cases):
        m = metas[row["clip"]]
        a = np.load(data / "npy" / f"{m['clip']}.npy").reshape(-1, 375)
        length = len(a) // vq.down * vq.down
        a = a[:length]
        b = vq(torch.from_numpy(a)[None])[0][0].numpy()
        start, end = min(m["active"][0], length-2), min(m["active"][1], length-1)
        side = "left" if row["geometry"]["left_hand_mm"] > row["geometry"]["right_hand_mm"] else "right"
        hand = HANDS[0] if side == "left" else HANDS[1]
        aa, bb = a.reshape(-1, 125, 3)[:, hand], b.reshape(-1, 125, 3)[:, hand]
        aa, bb = (aa-aa[:, :1])*m["norm"]["scale"]*1000, (bb-bb[:, :1])*m["norm"]["scale"]*1000
        tips = [4, 8, 12, 16, 20]
        reach = np.linalg.norm(aa[start:end+1, tips], axis=-1).mean()
        ratio = float(np.linalg.norm(bb[start:end+1, tips], axis=-1).mean()/reach) if reach > 1e-8 else None
        details.append({"clip": row["clip"], "illustrated_hand": side, "mean_wrist_to_fingertip_distance_ratio": ratio})
        frames = [int(start+(end-start)*q) for q in (.25, .5, .75)]
        extent = max(np.abs(aa[frames]).max(), np.abs(bb[frames]).max())*1.1
        for j, frame in enumerate(frames):
            ax = fig.add_subplot(len(cases), 3, i*3+j+1, projection="3d")
            for points, color in ((aa[frame], "#1565c0"), (bb[frame], "#e76f00")):
                for u, v in edges:
                    ax.plot(*points[[u, v]].T, color=color, lw=1.6, alpha=.85)
                ax.scatter(*points.T, s=9, color=color)
            ax.set(xlim=(-extent, extent), ylim=(-extent, extent), zlim=(-extent, extent), xlabel="x mm", ylabel="y mm", zlabel="z mm")
            ax.set_box_aspect((1, 1, 1))
            ax.view_init(20, -65)
            ax.set_title(f"{row['clip']} | {side} | {int((.25,.5,.75)[j]*100)}% active", fontsize=9)
    fig.suptitle("Top-5 misses: wrist-relative hand coordinates", y=.985, fontsize=13)
    fig.legend(handles=[Line2D([0], [0], color="#1565c0", lw=2, label="Original"), Line2D([0], [0], color="#e76f00", lw=2, label="E5 reconstruction")], loc="upper center", bbox_to_anchor=(.5, .95), ncol=2)
    fig.text(.5, .015, "Same view and scale within each row. Key frames only, not linguistic validation. Source: NIA AI Hub Sign Language data.", ha="center", fontsize=8)
    fig.subplots_adjust(top=.85, bottom=.08, wspace=.12, hspace=.3)
    fig.savefig(out / "hand_details.png", dpi=150, metadata={"Source": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"})
    plt.close(fig)
    (out / "hand_details.json").write_text(json.dumps(details, indent=2)+"\n")
    return details


@torch.inference_mode()
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--evaluation", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    torch.set_num_threads(2)
    evaluation, out = Path(args.evaluation), Path(args.out)
    if out.exists():
        raise ValueError("출력 경로가 이미 있습니다. 새 경로를 지정하세요.")
    provenance = json.loads((evaluation / "provenance.json").read_text())
    previous = json.loads((evaluation / "summary.json").read_text())
    command = provenance["command"]
    recog_dir = Path(command[command.index("--recog")+1])
    vq_dir = Path(command[command.index("--vq")+1])
    data = Path(command[command.index("--data")+1])
    for path, key in ((recog_dir / "model.pt", "recognizer_sha256"), (vq_dir / "model.pt", "vq_sha256")):
        assert hashlib.sha256(path.read_bytes()).hexdigest() == provenance[key]
    recognizer = Recognizer(str(recog_dir))
    vq, _ = load_vqvae(vq_dir / "model.pt")
    metas = {m["clip"]: m for m in (json.loads(line) for line in (data / "meta.jsonl").read_text().splitlines())}
    modes = ("body", "hands", "left_hand", "right_hand", "wrist_trajectories", "finger_shapes")
    rows, viewer = [], []
    for i, old in enumerate(previous["rows"], 1):
        m = metas[old["clip"]]
        motion = np.load(data / "npy" / f"{m['clip']}.npy", allow_pickle=False).reshape(-1, 375)
        length = len(motion) // vq.down * vq.down
        a = motion[:length]
        b = vq(torch.from_numpy(a)[None])[0][0].numpy()
        active = (min(m["active"][0], length-2), min(m["active"][1], length-1))
        pa, pb = prediction(recognizer, a, active, m["item"]), prediction(recognizer, b, active, m["item"])
        assert (pa["truth_rank"] == 1) == old["orig"]
        assert (pb["truth_rank"] == 1) == old["recon"]
        start, end = active
        metrics = geometry_metrics(a[start:end+1], b[start:end+1], m["norm"]["scale"])
        row = {"clip": m["clip"], "item": m["item"], "signer": m["signer"],
               "failed": pb["truth_rank"] != 1, "original": pa, "reconstructed": pb, "geometry": metrics}
        if row["failed"]:
            row["restoration"] = {mode: prediction(recognizer, restore_component(a, b, mode), active, m["item"]) for mode in modes}
            viewer.append({"name": m["clip"], "split": f"정답 순위 {pb['truth_rank']}", "a": a, "b": b})
        rows.append(row)
        if i % 200 == 0:
            print(f"Analyzed {i}/{len(previous['rows'])}", flush=True)
    failures = [r for r in rows if r["failed"]]
    severe = [r for r in failures if r["reconstructed"]["truth_rank"] > 5]
    assert len(failures) == 29 and len(severe) == 2
    aggregate = {}
    for name, group in (("correct", [r for r in rows if not r["failed"]]), ("failed", failures), ("outside_top5", severe)):
        aggregate[name] = {"clips": len(group), "geometry": {key: {
            "mean": float(np.mean([r["geometry"][key] for r in group if r["geometry"][key] is not None])),
            "median": float(np.median([r["geometry"][key] for r in group if r["geometry"][key] is not None]))}
            for key in group[0]["geometry"]}}
    recoveries = {mode: sum(r["restoration"][mode]["truth_rank"] == 1 for r in failures) for mode in modes}
    recovery_severe = {mode: sum(r["restoration"][mode]["truth_rank"] == 1 for r in severe) for mode in modes}
    report = {"paired_clips": len(rows), "failures": len(failures), "outside_top5": len(severe),
              "failure_counts_by_signer": dict(Counter(r["signer"] for r in failures)),
              "unique_failed_words": len({r["item"] for r in failures}), "aggregate": aggregate,
              "restoration_top1_recoveries_out_of_29": recoveries,
              "restoration_top1_recoveries_out_of_2_severe": recovery_severe,
              "severe_cases": severe,
              "limitations": ["Coordinate interventions are diagnostic hybrids, not natural motions or proof of a unique cause",
                              "Restoration groups overlap; counts must not be summed",
                              "Geometry uses aligned active frames, not DTW",
                              "Original videos and linguistic correctness were not reviewed",
                              "Test-set diagnosis must not be used to select a new model without fresh evaluation"],
              "source_attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"}
    out.mkdir(parents=True)
    (out / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
    (out / "failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2)+"\n")
    (out / "all_metrics.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2)+"\n")
    write_viewer(str(out / "failed_viewer.html"), viewer, labels=("원본", "E5 복원"), title="복원 후 오인식 29클립 — 원본과 복원 비교")
    plot_severe_hands(out, severe, vq, data, metas)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("Saved:", out)


if __name__ == "__main__":
    main()
