"""Read-only E5 handoff audit; prints aggregate results, never motion or tokens.

Run from ml: python -m vq.audit_handoff --tokens PATH --model PATH
    --word DATA_DIR --sen DATA_DIR
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from common.data import apply_split
from gen.tokenize import segment
from vq.model import load_vqvae


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path):
    with Path(path).open(encoding="utf-8") as f:
        return json.load(f)


def read_lines(path):
    with Path(path).open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--word", required=True)
    ap.add_argument("--sen", required=True)
    args = ap.parse_args()
    torch.set_num_threads(2)
    root = Path(__file__).resolve().parents[1]
    files = {"tokens": Path(args.tokens), "model": Path(args.model),
             "config": Path(args.model).with_name("config.json"),
             "word_meta": Path(args.word) / "meta.jsonl",
             "sen_meta": Path(args.sen) / "meta.jsonl",
             "sentences": Path(args.sen) / "sentences.jsonl"}
    files.update({name: root / "splits" / f"{name}.json"
                  for name in ("full", "full_sen", "full_all")})
    before = {k: digest(p) for k, p in files.items()}
    tk = read_json(files["tokens"])
    metas = read_lines(files["word_meta"]) + read_lines(files["sen_meta"])
    by_clip = {m["clip"]: m for m in metas}
    assert len(by_clip) == len(metas) == 80000
    assert set(by_clip) == set(tk["clips"])
    vq, cfg = load_vqvae(args.model)
    assert cfg == read_json(files["config"])
    assert tk["nb_code"] == cfg["nb_code"] == 512
    assert tk["down"] == vq.down == 4
    assert tk["vq_version"] == "v0.3-e5"
    assert cfg["parts"] == "body_hand"
    lengths = {"WORD": [], "SEN": []}
    used = set()
    for key, c in tk["clips"].items():
        m = by_clip[key]
        assert all(c[k] == m[k] for k in ("item", "signer", "type"))
        ts = c["tokens"]
        assert ts and all(type(t) is int and 0 <= t < tk["nb_code"] for t in ts)
        s, e = c["frames"]
        assert 0 <= s < e <= m["frames"] and e - s == len(ts) * vq.down
        expected = segment({**m, "x": range(m["frames"])}, vq.down)
        assert (s, e) == expected
        lengths[c["type"]].append(len(ts))
        used.update(ts)
    splits = {n: read_json(files[n]) for n in ("full", "full_sen", "full_all")}
    allsp = splits["full_all"]
    assert all(sp["signers"] == allsp["signers"] for sp in splits.values())
    signer_sets = [set(v) for v in allsp["signers"].values()]
    assert sum(map(len, signer_sets)) == len(set.union(*signer_sets)) == 16
    union = set(splits["full"]["exclude"]["clips"]) | set(splits["full_sen"]["exclude"]["clips"])
    assert union == set(allsp["exclude"]["clips"])
    assert union <= set(by_clip)
    assert splits["full_sen"]["heldout_sentences"] == allsp["heldout_sentences"]
    report = {"version": tk["vq_version"], "vq_path_hint": tk["vq"],
              "sha256": before, "bytes": {k: p.stat().st_size for k, p in files.items()},
              "tokens": {k: {"clips": len(v), "min": min(v), "max": max(v),
                             "mean": sum(v) / len(v)} for k, v in lengths.items()},
              "codes_used": len(used), "splits": {}}
    for name, sp in splits.items():
        subset = [m for m in metas if name == "full_all" or m["type"] == ("WORD" if name == "full" else "SEN")]
        parts = dict(zip(("train", "val", "test"), apply_split(subset, sp)))
        counts = {k: len(v) for k, v in parts.items()}
        assert counts == sp["counts"]
        assert len(subset) == sum(counts.values()) + len(sp["exclude"]["clips"])
        report["splits"][name] = {"counts": counts, "excluded": len(sp["exclude"]["clips"]),
            "label_duration_ok": {k: sum(m.get("label") == "ok" and 0.85 <= m.get("dur_ratio", 0) < 1.5 for m in v)
                                  for k, v in parts.items()}}
    senparts = dict(zip(("train", "val", "test"), apply_split([m for m in metas if m["type"] == "SEN"], splits["full_sen"])))
    held = allsp["heldout_sentences"]
    seqs = set(map(tuple, held["sequences"]))
    items = set(held["items"]) | set(held["question_items"])
    def is_held(m):
        return tuple(m.get("gloss", [])) in seqs or m["item"] in items
    valid = {k: [m for m in v if m.get("label") == "ok" and 0.85 <= m.get("dur_ratio", 0) < 1.5] for k, v in senparts.items()}
    train = [m for m in valid["train"] if not is_held(m)]
    evaluation = [m for m in valid["test"] if is_held(m)]
    assert not any(is_held(m) for m in train)
    bags = {tuple(sorted(s)) for s in seqs}
    assert not any(tuple(sorted(m["gloss"])) in bags for m in train)
    sentences = read_lines(files["sentences"])
    sentence_map = {s["clip"]: s for s in sentences}
    assert len(sentence_map) == len(sentences)
    assert set(sentence_map) <= set(by_clip)
    for m in train + evaluation:
        assert m["clip"] in sentence_map
        assert sentence_map[m["clip"]]["gloss"] == m["gloss"]
    report["sentence"] = {"rows": len(sentences), "sequences": len(seqs), "items": len(held["items"]),
        "question_items": len(held["question_items"]), "train_after_filters": len(train),
        "train_held_removed": len(valid["train"]) - len(train), "held_test": len(evaluation),
        "held_question_test": sum(m["item"] in held["question_items"] for m in evaluation),
        "val_held": sum(is_held(m) for m in valid["val"])}
    # One real clip per type/signer plus token-length extremes, bounded CPU inference only.
    selected = {}
    for key in sorted(by_clip):
        m = by_clip[key]
        selected.setdefault((m["type"], m["signer"]), key)
    sample = set(selected.values())
    for kind in lengths:
        keys = [k for k, v in tk["clips"].items() if v["type"] == kind]
        sample.add(min(keys, key=lambda k: len(tk["clips"][k]["tokens"])))
        sample.add(max(keys, key=lambda k: len(tk["clips"][k]["tokens"])))
    with torch.inference_mode():
        for key in sorted(sample):
            m, c = by_clip[key], tk["clips"][key]
            directory = Path(args.word if m["type"] == "WORD" else args.sen)
            x = np.load(directory / "npy" / f"{key}.npy", allow_pickle=False).reshape(-1, 375)
            assert len(x) == m["frames"] and np.isfinite(x).all()
            s, e = c["frames"]
            idx = torch.tensor([c["tokens"]], dtype=torch.long)
            assert torch.equal(vq.encode(torch.from_numpy(x[s:e])[None]), idx)
            decoded = vq.decode(idx)
            assert tuple(decoded.shape) == (1, e - s, 375)
            assert decoded.dtype == torch.float32 and torch.isfinite(decoded).all()
            assert torch.equal(decoded[..., 165:], vq.rest[165:].expand(1, e - s, -1))
    assert before == {k: digest(p) for k, p in files.items()}
    report["sample_reencode_decode"] = {"clips": len(sample), "passed": True,
        "scope": "one per type/signer and min/max token length; not all-clip re-encoding"}
    report["input_files_unchanged"] = True
    report["passed"] = True
    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
