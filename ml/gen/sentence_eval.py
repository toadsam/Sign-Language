"""문장 GPT 평가 A와 기준선 A 만들기.

설계 참고: sign-motion-gloss (코드 복사 없음)

  # 1) 기준선 A 대표 동작 표 (run 폴더 baseline.npz). 학습 몫만 쓴다.
  python -m gen.sentence_eval baseline --run <run> --tokens ... --meta ... --split ... --sen-val ... --device cuda
  # 2) 평가 A. 설정 고르기는 --partition val(sen_val_v1), 마지막에 test(heldout) 한 번.
  python -m gen.sentence_eval eval --run <run> ... --partition test --guidance 1 --out <json>

평가 A: 학습 화자 12명 × 문장 클립. 그 화자 조건으로 만든 동작 vs 그 화자의 실제 동작(실제 토큰을 같은
디코더로 복원한 것). 실제 구간은 meta segments, 생성 구간은 일정표. 길이가 달라 DTW로 맞춘다.
  word  단어 구간 DTW 거리 평균        conn  연결 구간 DTW 거리 평균
  jerk  경계 창 손목 jerk 최대값 평균   jerk_ratio = 방법 jerk / 실제 jerk
  human 같은 문장을 한 다른 학습 화자의 실제 동작 (참고 하한)
--partition test_signer: 시험 화자(REAL03, REAL12) heldout 클립, 모델은 화자 지정 없이(12명 medoid).
"""
import argparse
import json
from pathlib import Path
import time

import numpy as np
import torch

from gen.sentence_data import load_inputs, make_schedule, select
from gen.sentence_generator import load_sentence_generator, save_baseline
from gen.sentence_motion import as_points, boundary_jerk, build_baseline, compare


def add_data_args(ap):
    for name in ("run", "tokens", "meta", "split", "sen-val"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--vq", default=None)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")


def real_segments(row, n_frames):
    base = row["frames"][0]
    return [(u, max(0, f0 - base), min(n_frames, f1 + 1 - base)) for u, f0, f1 in row["segments"]]


def summarize(per_clip, real_jerk):
    word = [w for c in per_clip for w in c["word"]]
    conn = [w for c in per_clip for w in c["conn"]]
    jerk = [c["jerk"] for c in per_clip if c["jerk"] is not None]
    rj = [j for j in real_jerk if j is not None]
    return {"clips": len(per_clip), "word": float(np.mean(word)) if word else None, "word_n": len(word),
            "conn": float(np.mean(conn)) if conn else None, "conn_n": len(conn),
            "jerk": float(np.mean(jerk)) if jerk else None,
            "jerk_ratio": float(np.mean(jerk) / np.mean(rj)) if jerk and rj else None}


def score(motion, segs, real, rsegs):
    c = compare(motion, segs, real, rsegs)
    j = boundary_jerk(motion, segs)
    return {**c, "jerk": float(np.mean(j)) if j else None}


def run_eval(gen, rows, partition, decode, seed=17, batch=64, limit=None, log=print):
    """→ {"methods": {model, baseline, human: 요약}, "real_jerk", "skipped", "seconds"}"""
    started = time.time()
    known_rows, skipped = [], 0
    for r in rows:
        units = [s[0] for s in r["segments"]]
        if gen.known(units)[1] or (gen.baseline is not None and any(u not in gen.baseline["motions"] for u in units)):
            skipped += 1
            continue
        known_rows.append(r)
    if limit:
        known_rows = known_rows[:limit]
    reals = {}
    for r in known_rows:
        m = as_points(decode(r["tokens"]))
        reals[r["clip"]] = (m, real_segments(r, len(m)))
    results = {"model": [], "baseline": [], "human": []}
    real_jerk = []
    for s in range(0, len(known_rows), batch):
        chunk = known_rows[s:s + batch]
        if partition == "test_signer":
            outs = [gen.generate([u for u, *_ in r["segments"]], None, seed + s + i) for i, r in enumerate(chunk)]
            gen_m = [(o["motion"], [(x["unit"], x["start"], x["end"]) for x in o["segments"]]) for o in outs]
        else:
            schedules = [make_schedule([u for u, *_ in r["segments"]], gen.stats) for r in chunk]
            seqs = gen.sample_tokens(schedules, [gen.signers[r["signer"]] for r in chunk], seed + s)
            gen_m = [(gen.decode(q), [(u, a * gen.down, b * gen.down) for u, a, b in sc[2]])
                     for q, sc in zip(seqs, schedules)]
        for r, (m, segs) in zip(chunk, gen_m):
            real, rsegs = reals[r["clip"]]
            results["model"].append(score(m, segs, real, rsegs))
            j = boundary_jerk(real, rsegs)
            real_jerk.append(float(np.mean(j)) if j else None)
        log(f"{partition}: {min(s + batch, len(known_rows))}/{len(known_rows)} clips, {time.time() - started:.0f}s")
    if gen.baseline is not None:
        for r in known_rows:
            m, _, segs = gen._baseline([u for u, *_ in r["segments"]])
            real, rsegs = reals[r["clip"]]
            results["baseline"].append(score(m, [(x["unit"], x["start"], x["end"]) for x in segs], real, rsegs))
    by_item = {}
    for r in known_rows:
        by_item.setdefault(r["item"], []).append(r)
    for r in known_rows:
        others = sorted((o for o in by_item[r["item"]] if o["signer"] != r["signer"]
                         and [s[0] for s in o["segments"]] == [s[0] for s in r["segments"]]),
                        key=lambda o: o["signer"])
        if not others:
            continue
        after = [o for o in others if o["signer"] > r["signer"]]
        o = (after or others)[0]
        om, osegs = reals[o["clip"]]
        real, rsegs = reals[r["clip"]]
        results["human"].append(score(om, osegs, real, rsegs))
    return {"partition": partition, "methods": {k: summarize(v, real_jerk) for k, v in results.items() if v},
            "real_jerk": float(np.mean([j for j in real_jerk if j is not None])) if real_jerk else None,
            "rows": len(rows), "evaluated": len(known_rows), "skipped_unknown_unit": skipped,
            "seconds": round(time.time() - started, 1)}


def make_decoder(vq_path, device):
    from vq.model import load_vqvae
    vq = load_vqvae(str(vq_path))[0].to(device).eval()

    def decode(tokens):
        with torch.no_grad():
            return vq.decode(torch.tensor([tokens], dtype=torch.long, device=device))[0].float().cpu().numpy()
    return vq, decode


def cmd_baseline(a):
    run = Path(a.run)
    meta = json.loads((run / "generator.json").read_text(encoding="utf-8"))
    vq, decode = make_decoder(a.vq or meta["vq_checkpoint"], a.device)
    tokens, metas, split, sen_val, _ = load_inputs(a.tokens, a.meta, a.split, a.sen_val)
    sel = select(tokens, metas, split, sen_val)
    stats = json.loads((run / "schedule.json").read_text(encoding="utf-8"))
    started = time.time()
    table = build_baseline(sel["train"], sel["down"], decode, per_unit=a.per_unit, log=print)
    save_baseline(run / "baseline.npz", table, vq.rest.detach().cpu().numpy().reshape(125, 3), stats["conn_frames"])
    info = {u: v[1] for u, v in table.items()}
    (run / "baseline_info.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"units": len(table), "gap_frames": stats["conn_frames"],
                      "seconds": round(time.time() - started, 1)}))


def cmd_eval(a):
    tokens, metas, split, sen_val, _ = load_inputs(a.tokens, a.meta, a.split, a.sen_val)
    sel = select(tokens, metas, split, sen_val)
    gen = load_sentence_generator(a.run, a.device, vq_path=a.vq, per_signer=a.per_signer)
    out = {"run": str(a.run), "results": []}
    for g in a.guidance:
        gen.guidance = g
        r = run_eval(gen, sel[a.partition], a.partition, gen.decode, seed=a.seed, limit=a.limit)
        r["guidance"] = g
        out["results"].append(r)
        print(json.dumps({"guidance": g, **{k: v for k, v in r.items() if k != "methods"}}), flush=True)
        for name, s in r["methods"].items():
            print(json.dumps({name: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items()}}), flush=True)
    # 문장 하나 생성 시간 (학습 화자 하나 / 12명 medoid)
    units = [s[0] for s in sel[a.partition][0]["segments"]] if sel[a.partition] else None
    if units and not gen.known(units)[1]:
        for signer, label in ((sorted(gen.signers)[0], "one_signer"), (None, "pool")):
            t = time.time()
            gen.generate(units, signer, 0)
            if a.device.startswith("cuda"):
                torch.cuda.synchronize()
            out[f"seconds_{label}_{a.device}"] = round(time.time() - t, 3)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k.startswith("seconds")}))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("baseline")
    add_data_args(b)
    b.add_argument("--per-unit", type=int, default=32)
    e = sub.add_parser("eval")
    add_data_args(e)
    e.add_argument("--partition", choices=("val", "test", "test_signer"), default="val")
    e.add_argument("--guidance", type=float, nargs="+", default=[1.0])
    e.add_argument("--per-signer", type=int, default=1)
    e.add_argument("--seed", type=int, default=17)
    e.add_argument("--limit", type=int, default=None)
    e.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    (cmd_baseline if a.cmd == "baseline" else cmd_eval)(a)


if __name__ == "__main__":
    main()
