"""단어 자동 점수(eval.compare)용 B1 / Ours-H 동작과 manifest를 만든다.

채점관(읽는 모델)의 test 화자 단어 클립 하나가 manifest record 하나다.
  B1      단어당 1개. 생성 split의 train 클립(최대 32개, seed 17)을 자모표로 복원해 그중 대표(medoid,
          32프레임으로 맞춘 상체+손 55점 거리 합 최소). 문장 평가 B1(sentence_motion.build_baseline)과 같은 정의다.
  Ours-H  단어당 5개. 서비스 단어 GPT 묶음(generator.json)의 모델 · 자모표 · 샘플링 설정 그대로,
          서로 다른 학습 화자 5명의 조건으로 하나씩 만든다(대표 고르기 없음). 5명은 모든 단어에 같다.
같은 단어의 test 클립 두 개(화자 둘)는 같은 동작 파일을 가리킨다.
두 조건 중 하나라도 못 만드는 단어는 record에서 빼고 report.json에 적는다(조건 구성을 모두 같게).

ml/ 에서:
  python -m gen.word_eval_clips --bundle <단어 GPT 묶음> --recog <채점관 run> --data <채점관 데이터(test 클립)> \
      --train-data /data/full --tokens /data/runs/tokens_e5.json --split-file splits/full.json \
      --out <새 폴더> --device cuda

출력 (--out, 커밋하지 않는다):
  manifest.json  eval.compare --manifest 로 넘기는 목차
  b1/WORDxxxx.npy, oursh/WORDxxxx_k.npy   float32 [T, 375]
  report.json    클립 수, 못 만든 단어, 고른 화자, seed, 체크포인트 해시
"""
import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np

from common.data import apply_split
from gen.vocab import read_json

CONDITIONS = ("B1", "Ours-H")
FEAT = 375


def read_meta(data_dir):
    with (Path(data_dir) / "meta.jsonl").open(encoding="utf-8-sig") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def test_clips(metas, recog_split, classes):
    """eval.compare가 받는 클립: 채점관 split의 test 화자 + 채점관이 아는 단어."""
    if not recog_split or recog_split.get("mode") != "signer":
        raise ValueError("채점관 체크포인트에 표현자 분할(mode=signer)이 없습니다.")
    words = [m for m in metas if m.get("type") == "WORD"]
    _, _, test = apply_split(words, recog_split)
    return sorted((m for m in test if m["item"] in classes), key=lambda m: m["clip"])


def b1_candidates(train_rows, items, per_word=32, seed=17):
    """item -> train 클립(토큰 열이 있는 것) 최대 per_word개. 문장 기준선 build_baseline과 같은 뽑기."""
    by = {}
    for r in sorted(train_rows, key=lambda r: r["clip"]):
        if r["item"] in items:
            by.setdefault(r["item"], []).append(r)
    rng = np.random.default_rng(seed)
    out = {}
    for item in sorted(by):
        rows = by[item]
        if len(rows) > per_word:
            rows = [rows[i] for i in sorted(rng.choice(len(rows), per_word, replace=False))]
        out[item] = rows
    return out


def b1_medoid(rows, decode):
    """후보 토큰 열을 자모표로 복원해 대표(medoid) 하나. → (동작 [T,375], 고른 clip)"""
    from gen.sentence_motion import medoid_of
    motions = [np.asarray(decode(r["tokens"]), dtype=np.float32).reshape(-1, FEAT) for r in rows]
    i = medoid_of(motions)
    return motions[i], rows[i]["clip"]


def pick_signers(trained, forbidden, count, seed):
    """학습 화자 중 count명(NO_SIGNER · 채점관 val/test 화자 제외), seed 고정."""
    from gen.training import NULL_SIGNER
    pool = sorted(s for s in trained if s != NULL_SIGNER and s not in forbidden)
    if len(pool) < count:
        raise ValueError(f"고를 수 있는 학습 화자가 {len(pool)}명뿐입니다.")
    rng = np.random.default_rng(seed)
    return sorted(rng.choice(pool, size=count, replace=False).tolist())


def generate_oursh(adapter, items, signers, seed, batch_words=100):
    """item -> [동작 [T,375]] (signers 순서). 서비스 adapter의 샘플링 설정을 그대로 쓴다."""
    import torch
    out = {}
    devices = adapter._cuda_devices
    with torch.random.fork_rng(devices=devices), torch.inference_mode():
        torch.manual_seed(seed)
        adapter.model.eval()
        adapter.decoder.eval()
        sig_ids = [adapter.signers[s] for s in signers]
        for start in range(0, len(items), batch_words):
            chunk = items[start:start + batch_words]
            cond = torch.tensor([adapter.classes[i] for i in chunk for _ in signers],
                                dtype=torch.long, device=adapter.device)
            sig = torch.tensor(sig_ids * len(chunk), dtype=torch.long, device=adapter.device)
            seqs = adapter.model.generate(cond, sig, top_k=adapter.top_k, temperature=adapter.temperature,
                                          min_len=adapter.min_len, guidance=adapter.guidance)
            for n, item in enumerate(chunk):
                motions = []
                for tokens in seqs[n * len(signers):(n + 1) * len(signers)]:
                    if not adapter.min_len <= len(tokens) <= adapter.max_len:
                        raise ValueError(f"{item}: 생성 토큰 길이 {len(tokens)}")
                    idx = torch.tensor([tokens], dtype=torch.long, device=adapter.device)
                    x = adapter._motion(adapter.decoder.decode(idx), len(tokens) * adapter.down)
                    motions.append(x.reshape(-1, FEAT).astype(np.float32))
                out[item] = motions
    return out


def build_manifest(clips, b1_files, oursh_files):
    """두 조건이 다 있는 단어의 클립만 record로. (records, 빠진 클립)"""
    records, dropped = [], []
    for m in clips:
        item = m["item"]
        if item in b1_files and item in oursh_files:
            records.append({"clip": m["clip"], "item": item, "signer": m["signer"],
                            "conditions": {"B1": {"motions": [b1_files[item]]},
                                           "Ours-H": {"motions": list(oursh_files[item])}}})
        else:
            dropped.append(m["clip"])
    return records, dropped


def check_manifest(out_dir, records, allowed_clips, oursh_count):
    """eval.compare가 거부하는 경우를 미리 막는다."""
    if not records:
        raise ValueError("record가 없습니다.")
    if len({r["clip"] for r in records}) != len(records):
        raise ValueError("clip이 중복됩니다.")
    for r in records:
        if r["clip"] not in allowed_clips:
            raise ValueError(f"{r['clip']}: 채점관 test 클립이 아닙니다.")
        if tuple(sorted(r["conditions"])) != tuple(sorted(CONDITIONS)):
            raise ValueError(f"{r['clip']}: 조건 구성이 다릅니다.")
        counts = {"B1": 1, "Ours-H": oursh_count}
        for cond, spec in r["conditions"].items():
            if len(spec["motions"]) != counts[cond]:
                raise ValueError(f"{r['clip']} {cond}: 동작 {len(spec['motions'])}개")
            for name in spec["motions"]:
                x = np.load(Path(out_dir) / name, allow_pickle=False)
                if x.ndim != 2 or x.shape[1] != FEAT or len(x) < 2 or x.dtype != np.float32 \
                        or not np.isfinite(x).all():
                    raise ValueError(f"{name}: 모양 {x.shape} {x.dtype}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("bundle", "recog", "data", "train-data", "tokens", "split-file", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--signers", type=int, default=5, help="Ours-H 단어당 개수 = 학습 화자 수")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    ap.add_argument("--classes-json", help="채점관 classes.json과 단어 목록이 같은지 확인(선택)")
    args = ap.parse_args(argv)

    from gen.artifacts import code_revision, sha256_file
    from gen.infer import Generator
    from recog.model import load_recognizer

    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out}가 비어 있지 않습니다. 새 폴더를 쓰세요.")

    # 1. 채점관 test 클립
    _, rck = load_recognizer(Path(args.recog) / "model.pt")
    classes = set(rck["classes"])
    if args.classes_json:
        listed = read_json(args.classes_json)
        listed = set(listed if isinstance(listed, list) else listed.keys())
        if listed != classes:
            raise SystemExit(f"classes.json과 체크포인트 단어가 다릅니다: {len(listed ^ classes)}개 차이")
    metas = read_meta(args.data)
    clips = test_clips(metas, rck.get("split"), classes)
    rsig = rck["split"]["signers"]
    forbidden = set(rsig.get("val", [])) | set(rsig.get("test", []))
    print(json.dumps({"test_clips": len(clips), "words": len({m["item"] for m in clips}),
                      "per_signer": Counter(m["signer"] for m in clips)}, ensure_ascii=False), flush=True)

    # 2. 생성 모델
    gen = Generator(args.bundle, args.device)
    if gen.kind != "word_gpt":
        raise SystemExit(f"단어 GPT 묶음이 아닙니다: {gen.kind}")
    adapter = gen._adapter
    items = sorted({m["item"] for m in clips})
    no_model = [i for i in items if i not in adapter.classes]
    not_in_service = sorted(i for i in items if i in adapter.classes and i not in set(gen.mapping.values()))

    # 3. B1 (train 클립만, 자모표로 복원한 대표)
    import torch
    from gen.data import select_data
    sel = select_data(args.tokens, str(Path(args.train_data) / "meta.jsonl"), args.split_file, mode="formal")
    candidates = b1_candidates(sel.train, set(items))
    leaked = sorted({r["clip"] for rows in candidates.values() for r in rows if r["signer"] in forbidden})
    if leaked:
        raise SystemExit(f"B1 원재료에 채점관 val/test 화자가 섞였습니다: {leaked[:5]}")
    no_b1 = [i for i in items if i not in candidates]

    def decode(tokens):
        with torch.inference_mode():
            idx = torch.tensor([tokens], dtype=torch.long, device=adapter.device)
            return adapter._motion(adapter.decoder.decode(idx), len(tokens) * adapter.down)

    (out / "b1").mkdir(parents=True)
    (out / "oursh").mkdir()
    b1_files, b1_source = {}, {}
    for item, rows in candidates.items():
        x, clip = b1_medoid(rows, decode)
        name = f"b1/{item}.npy"
        np.save(out / name, x)
        b1_files[item], b1_source[item] = name, {"clip": clip, "candidates": len(rows)}

    # 4. Ours-H
    signers = pick_signers(adapter.signers, forbidden, args.signers, args.seed)
    gen_items = [i for i in items if i in adapter.classes]
    motions = generate_oursh(adapter, gen_items, signers, args.seed)
    oursh_files = {}
    for item, xs in motions.items():
        names = []
        for k, x in enumerate(xs):
            name = f"oursh/{item}_{k}.npy"
            np.save(out / name, x)
            names.append(name)
        oursh_files[item] = names

    # 5. manifest
    records, dropped = build_manifest(clips, b1_files, oursh_files)
    check_manifest(out, records, {m["clip"] for m in clips}, args.signers)
    commit, dirty = code_revision()
    provenance = {
        "conditions": list(CONDITIONS), "seed": args.seed, "code_commit": commit, "code_dirty": dirty,
        "recog": str(Path(args.recog).resolve()), "data": str(Path(args.data).resolve()),
        "train_data": str(Path(args.train_data).resolve()), "tokens": str(Path(args.tokens).resolve()),
        "split_file": str(Path(args.split_file).resolve()),
        "bundle": str(Path(args.bundle).resolve()),
        "generator_sha256": sha256_file(Path(args.bundle) / read_json(Path(args.bundle) / "generator.json")["generator_checkpoint"]),
        "b1_rule": "생성 split train 클립 최대 32개(seed 17)를 E5로 복원, 32프레임 55점 거리 합 최소인 대표 (문장 B1과 같음)",
        "oursh_rule": "서비스 단어 GPT 샘플링 설정, 학습 화자 조건 하나씩, 대표 고르기 없음",
        "oursh_signers": signers,
        "sampling": {"top_k": adapter.top_k, "temperature": adapter.temperature,
                     "min_len": adapter.min_len, "guidance": adapter.guidance},
        "shared_between_test_signers": True,
    }
    manifest = {"records": records, "provenance": provenance}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    report = {
        "test_clips": len(clips), "records": len(records), "dropped_clips": dropped,
        "words": len(items), "words_in_records": len({r["item"] for r in records}),
        "per_signer": Counter(r["signer"] for r in records),
        "no_model_words": no_model, "no_b1_words": no_b1,
        "model_ok_but_not_in_service_vocab": not_in_service,
        "b1_source": b1_source, "b1_train_rows": len(sel.train),
        "files": {"b1": len(b1_files), "oursh": sum(len(v) for v in oursh_files.values())},
        "oursh_token_frames_mean": float(np.mean([len(x) for xs in motions.values() for x in xs])) if motions else None,
        **{k: provenance[k] for k in ("oursh_signers", "seed", "code_commit", "code_dirty", "generator_sha256")},
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("test_clips", "records", "words_in_records", "per_signer",
                                             "no_model_words", "no_b1_words", "files", "oursh_signers")},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
