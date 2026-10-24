"""Exact dictionary -> eligible train WORD mapping (no fuzzy substitutions).

From ml: python -m gen.vocab --dictionary PATH --data PATH --split PATH
    --out runs/baseline/vocab_map.json
Real derived vocabularies must be written to an ignored/local data directory.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path

from common.data import apply_split


def read_json(path):
    with Path(path).open(encoding="utf-8-sig") as stream:
        return json.load(stream)


def select_train(data_dir, split_path, *, data_mode="formal"):
    """B1 minimum selection; returns metadata only and exclusion counts.

    Does not load coordinate arrays. Replace/reconcile with A1's selection API
    when that API is integrated; common.data.apply_split alone is insufficient.
    """
    if data_mode not in ("formal", "smoke"):
        raise ValueError("data_mode must be formal or smoke")
    split = read_json(split_path)
    if not isinstance(split, dict):
        raise ValueError("split must be a JSON object")
    mode = split.get("mode")
    if mode not in ("signer", "item") or (mode == "item" and data_mode != "smoke"):
        raise ValueError("formal selection requires a fixed signer split")
    if mode == "signer":
        groups = split.get("signers", {})
        seen = set()
        for part in ("train", "val", "test"):
            values = groups.get(part)
            if not isinstance(values, list) or any(not isinstance(s, str) or not s for s in values):
                raise ValueError("split requires train/val/test signer lists")
            if len(set(values)) != len(values) or seen.intersection(values):
                raise ValueError("split signer assignments overlap or repeat")
            seen.update(values)
    elif not isinstance(split.get("test_items"), list):
        raise ValueError("item smoke split requires test_items")
    excluded = split.get("exclude", {}).get("clips", [])
    if not isinstance(excluded, list) or any(not isinstance(c, str) for c in excluded):
        raise ValueError("exclude.clips must be a list of clip names")
    records, seen = [], set()
    with (Path(data_dir) / "meta.jsonl").open(encoding="utf-8-sig") as stream:
        for line in stream:
            if not line.strip():
                continue
            meta = json.loads(line)
            if not isinstance(meta, dict):
                raise ValueError("metadata row must be a JSON object")
            for key in ("clip", "item", "signer", "type"):
                if not isinstance(meta.get(key), str) or not meta[key]:
                    raise ValueError(f"metadata requires nonempty {key}")
            if meta["clip"] in seen:
                raise ValueError("duplicate metadata clip")
            seen.add(meta["clip"])
            if meta["clip"] != f"{meta['item']}_{meta['signer']}":
                raise ValueError("clip/item/signer identity mismatch")
            if meta["type"] not in ("WORD", "SEN") or not meta["item"].startswith(meta["type"]):
                raise ValueError("metadata item/type mismatch")
            records.append(meta)
    train, _, _ = apply_split(records, split)
    train_keys = {m["clip"] for m in train}
    counts, selected = Counter(), []
    for meta in records:
        if meta["type"] != "WORD":
            counts["not_word"] += 1
        elif meta["clip"] in excluded:
            counts["quality_excluded"] += 1
        elif meta["clip"] not in train_keys:
            counts["not_train"] += 1
        elif meta.get("label") != "ok":
            counts["label"] += 1
        else:
            ratio = meta.get("dur_ratio")
            if type(ratio) not in (int, float) or not math.isfinite(ratio) or not 0.85 <= ratio < 1.5:
                counts["duration"] += 1
            else:
                selected.append(meta)
    counts["selected"] = len(selected)
    counts["total"] = len(records)
    return sorted(selected, key=lambda m: m["clip"]), dict(counts)


def build_vocab(dictionary, train_metas):
    """Only whole, single-gloss WORD labels are exact matches.

    Duplicate recordings of one WORD ID do not create ambiguity. Multiple WORD
    IDs for the same label do; those entries remain outside mapping.
    """
    if not isinstance(dictionary, list):
        raise ValueError("dictionary must be a list of entries with a word field")
    words = set()
    for entry in dictionary:
        word = entry.get("word") if isinstance(entry, dict) else None
        if not isinstance(word, str) or not word.strip():
            raise ValueError("dictionary entry requires a nonempty word")
        words.add(word)
    candidates = {}
    for meta in train_metas:
        labels = meta.get("gloss")
        if isinstance(labels, list) and len(labels) == 1 and isinstance(labels[0], str):
            candidates.setdefault(labels[0], set()).add(meta["item"])
    mapping, unmapped, ambiguous = {}, [], {}
    for word in sorted(words):
        ids = sorted(candidates.get(word, ()))
        if len(ids) == 1:
            mapping[word] = ids[0]
        elif ids:
            ambiguous[word] = ids
        else:
            unmapped.append(word)
    return {"schema_version": 1, "mapping": mapping, "unmapped": unmapped, "ambiguous": ambiguous}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("dictionary", "data", "split", "out"):
        parser.add_argument(f"--{flag}", required=True)
    parser.add_argument("--data-mode", choices=("formal", "smoke"), default="formal")
    args = parser.parse_args()
    metas, counts = select_train(args.data, args.split, data_mode=args.data_mode)
    result = build_vocab(read_json(args.dictionary), metas)
    # Exclusive creation protects an existing reviewed mapping from replacement.
    with Path(args.out).open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"selection": counts, "exact": len(result["mapping"]),
                      "unmapped": len(result["unmapped"]), "ambiguous": len(result["ambiguous"])},
                     ensure_ascii=True))


if __name__ == "__main__":
    main()
