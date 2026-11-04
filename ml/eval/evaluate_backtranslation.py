"""Stream paired test clips through a frozen recognizer and VQ decoder on CPU.

Keep coordinates on the server; persist predictions, checks and provenance only.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch

from common.data import apply_split, load_split
from recog.infer import Recognizer, validate_motion
from vq.model import load_vqvae


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


@torch.inference_mode()
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--recog", required=True)
    ap.add_argument("--vq", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expected-vq-sha256", default="939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38", help="Pin the frozen candidate hash; default is historical E5.")
    args = ap.parse_args()
    torch.set_num_threads(2)
    run, vq_run, out = map(Path, (args.recog, args.vq, args.out))
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    recog = Recognizer(str(run))
    ck = recog.checkpoint
    data = Path(ck["config"]["data"])
    sp = ck["split"]
    assert sp == load_split(data) == read(data / "split_snapshot.json")
    assert sp["mode"] == "signer" and set(sp["signers"]["test"]) == {"REAL03", "REAL12"}
    assert recog.classes == read(data / "classes.json")
    metas = [json.loads(s) for s in (data / "meta.jsonl").read_text().splitlines()]
    clips = apply_split(metas, sp)[2]
    assert len({m["clip"] for m in clips}) == len(clips)
    assert all(m["item"] in recog.classes and m["label"] == "ok" and
               .85 <= m["dur_ratio"] < 1.5 for m in clips)
    audit = read(run / "audit.json")
    assert len(clips) == audit["metrics"]["test"]["clips"]
    protected = [run / "model.pt", vq_run / "model.pt", data / "meta.jsonl",
                 data / "classes.json", data / "split_snapshot.json",
                 data / "preparation.json", data / "deduplication.json",
                 Path(__file__).resolve().parents[1] / "splits/full.json"]
    before = {str(p): digest(p) for p in protected}
    # Pin the selected candidate; the default remains historical E5.
    assert before[str(vq_run / "model.pt")] == args.expected_vq_sha256
    assert before[str(run / "model.pt")] == "3759b0cd788e268b0ce552e7367a840742aafc2f8a53b44607bafe9d29f6f01f"
    vq, vc = load_vqvae(str(vq_run / "model.pt"))
    vq.eval()
    write(out / "provenance.json", {
        "started_utc": datetime.now(timezone.utc).isoformat(), "arguments": vars(args),
        "data": str(data), "device": "cpu", "threads": 2,
        "protected_sha256": before, "evaluator_sha256": digest(__file__),
        "test_clip_ids_sha256": hashlib.sha256("\n".join(sorted(m["clip"] for m in clips)).encode()).hexdigest(),
        "vq_down": vq.down, "vq_checkpoint_keys": sorted(vc),
        "protocol": "full original control; paired original/reconstruction truncated to VQ down multiple, identical clamped active; Recognizer.score contract",
        "limitations": ["VQ historical split snapshot unavailable; past training split cannot be independently established",
                        "Two test signers, one recognizer seed; recognition preservation is not human semantic evaluation"],
        "attribution": "한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용"})
    rows = []
    hits = {name: Counter() for name in ("full_orig", "orig", "recon")}
    sources = hashlib.sha256()
    with (out / "rows.jsonl").open("x") as stream:
        for i, m in enumerate(clips, 1):
            file = data / "npy" / (m["clip"] + ".npy")
            source_hash = digest(file)
            sources.update((m["clip"] + source_hash).encode())
            x, active = validate_motion(np.load(file, allow_pickle=False), m["active"])
            T = len(x) // vq.down * vq.down
            assert T >= vq.down and T >= 2
            paired_active = (min(active[0], T - 2), min(active[1], T - 1))
            xr = vq(torch.from_numpy(x[:T])[None])[0][0].numpy()
            assert xr.shape == x[:T].shape and np.isfinite(xr).all()
            row = {"clip": m["clip"], "item": m["item"], "signer": m["signer"],
                   "source_sha256": source_hash, "frames_removed": len(x) - T,
                   "active_clamped": list(paired_active) != list(active)}
            for name, arr, act in (("full_orig", x, active), ("orig", x[:T], paired_active),
                                   ("recon", xr, paired_active)):
                words = [word for word, _ in recog.score(arr, act)["top5"]]
                row[name] = {"top5": words, "top1_correct": words[0] == m["item"],
                             "top5_correct": m["item"] in words}
                hits[name]["top1"] += row[name]["top1_correct"]
                hits[name]["top5"] += row[name]["top5_correct"]
            assert digest(file) == source_hash
            rows.append(row)
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            if i % 250 == 0 or i == len(clips):
                stream.flush()
                print(json.dumps({"completed": i, "total": len(clips), "seconds": round(time.monotonic()-started, 1)}), flush=True)
    n = len(rows)
    result = {"clips": n, "evaluated_classes": len({m["item"] for m in clips}),
              "signers": dict(Counter(m["signer"] for m in clips)), "metrics": {},
              "seconds": time.monotonic() - started}
    for name, counts in hits.items():
        result["metrics"][name] = {f"correct_{k}": v for k, v in counts.items()}
        result["metrics"][name].update({k: v/n for k, v in counts.items()})
    for k in ("top1", "top5"):
        result[f"{k}_accuracy_ratio"] = hits["recon"][k]/hits["orig"][k] if hits["orig"][k] else None
        result[f"{k}_lost"] = sum(r["orig"][k+"_correct"] and not r["recon"][k+"_correct"] for r in rows)
        result[f"{k}_gained"] = sum(not r["orig"][k+"_correct"] and r["recon"][k+"_correct"] for r in rows)
        result[f"{k}_conditional_retention"] = (hits["orig"][k]-result[f"{k}_lost"])/hits["orig"][k] if hits["orig"][k] else None
    checks = {"source_files_unchanged": True, "source_manifest_sha256": sources.hexdigest(),
              "protected_hashes_unchanged": all(digest(p) == h for p, h in before.items()),
              "full_original_matches_audit": all(hits["full_orig"][k]/n == audit["metrics"]["test"][k] for k in ("top1", "top5")),
              "truncation_top5_predictions_changed": sum(r["full_orig"]["top5"] != r["orig"]["top5"] for r in rows),
              "active_clamped_clips": sum(r["active_clamped"] for r in rows),
              "truncated_clips": sum(r["frames_removed"] > 0 for r in rows)}
    write(out / "checks.json", checks)
    assert checks["protected_hashes_unchanged"] and checks["full_original_matches_audit"]
    write(out / "summary.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
