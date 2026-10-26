"""Freeze and score WORD GPT label/condition diagnostics; never generate or train.

--prepare fixes original30 + hash-ranked extra30, all their val references,
at most four train clips per word, and a cyclic wrong-word assignment.
--run compares correct/wrong conditions on identical clean teacher-forced
histories. Coordinates and test performance are never read.
"""
import argparse
from collections import Counter, defaultdict
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import statistics
import sys

from gen.artifacts import sha256_file, write_json_atomic
from gen.data import select_data
from gen.evaluate import BEST_SHA256, SAMPLING, SEEDS, isolated_rng, make_manifest, require


CODE_FILES = ("diagnose_gpt.py", "data.py", "model.py", "training.py", "train_word.py", "artifacts.py", "evaluate.py")


def rank(rule, value):
    return hashlib.sha256(f"{rule}|17|{value}".encode("utf-8")).hexdigest()


def codes_hash(tokens):
    return hashlib.sha256(json.dumps(tokens, separators=(",", ":")).encode("utf-8")).hexdigest()


def code_hashes():
    return {name: sha256_file(Path(__file__).with_name(name)) for name in CODE_FILES}


def describe(row):
    return {k: row[k] for k in ("clip", "item", "signer", "frames", "total_frames")} | {
        "tokens_sha256": codes_hash(row["tokens"])}


def prepare_manifest(selection, checkpoint, paths, original):
    base_paths = {k: paths[k] for k in ("checkpoint", "vq", "vq_config", "tokens", "meta", "split")}
    base = make_manifest(selection, checkpoint, base_paths)
    require(base["selected"] == original.get("selected"), "original_cohort", "original30/all val references differ")
    for key, value in base["input_sha256"].items():
        require(original.get("input_sha256", {}).get(key) == value, "original_input", key)
    classes, signers = checkpoint["classes"], checkpoint["signers"]
    require(sorted(classes.values()) == list(range(len(classes))) and
            sorted(signers.values()) == list(range(len(signers))), "mapping_indices", "dense unique indices required")
    old = [item["word_id"] for item in base["selected"]]
    eligible = {r["item"] for r in selection.partitions["val"] if r["item"] in classes}
    extra = sorted(eligible - set(old), key=lambda w: (rank("word-val-extra-v1", w), w))[:30]
    require(len(extra) == 30, "insufficient_extra_words", f"available={len(extra)} required=30")
    words = old + extra
    cycle = sorted(words)
    derangement = {w: cycle[(i + 1) % len(cycle)] for i, w in enumerate(cycle)}
    val_by, train_by = defaultdict(list), defaultdict(list)
    for row in selection.partitions["val"]:
        if row["item"] in words:
            val_by[row["item"]].append(row)
    for row in selection.train:
        if row["item"] in words:
            train_by[row["item"]].append(row)
    cohorts, records, distribution = {}, {"train": [], "val": []}, {}
    for cohort, chosen in (("original30", old), ("extra30", extra)):
        cohorts[cohort] = {"words": chosen, "references": {w: [r["clip"] for r in sorted(val_by[w], key=lambda r: r["clip"])]
                                                          for w in chosen}}
        for word in chosen:
            train = sorted(train_by[word], key=lambda r: (rank("word-train-diag-v1", f"{word}|{r['clip']}"), r["clip"]))[:4]
            for split, rows in (("train", train), ("val", sorted(val_by[word], key=lambda r: r["clip"]))):
                records[split].extend({**describe(r), "cohort": cohort} for r in rows)
            distribution[word] = {"train_total": len(train_by[word]), "train_selected": len(train),
                "train_REAL01_total": sum(r["signer"] == "REAL01" for r in train_by[word]),
                "train_REAL01_selected": sum(r["signer"] == "REAL01" for r in train), "val_all": len(val_by[word])}
    return {"schema_version": 1, "purpose": "condition diagnostic, not semantic accuracy or test performance",
        "inputs": {k: {"path": str(Path(v).resolve()), "sha256": sha256_file(v)} for k, v in paths.items()},
        "code_sha256": code_hashes(), "cohorts": cohorts, "records": records, "distribution": distribution,
        "derangement": derangement, "checkpoint_classes": classes, "checkpoint_signers": signers,
        "checkpoint": {k: checkpoint.get(k) for k in ("kind", "global_step", "config", "nb_code", "max_len", "generation_signer")},
        "mapping_audit": {"classes_equal_train": classes == selection.classes, "signers_equal_train": signers == selection.signers,
                          "class_count": len(classes), "signer_count": len(signers),
                          "formal_counts": selection.report["counts"]},
        "rules": {"extra": "SHA256(word-val-extra-v1|17|WORD_ID), exclude original30, first30",
                  "train": "SHA256(word-train-diag-v1|17|WORD_ID|CLIP_ID), first4 per word",
                  "wrong_word": "sorted 60 WORD IDs, rotate by one; no fixed points",
                  "signer": {"train": "actual train signer", "val": "REAL01"},
                  "history": "clean/eval/no_grad, same history and signer for correct/wrong",
                  "clean_train": "diagnostic-only corrupt=0 with model.eval; original training configuration is preserved",
                  "stage": "position0; remaining token positions by thirds of token length; END separately"},
        "sampling": {**SAMPLING, "seeds": list(SEEDS)}, "new_generation_calls": 0}


def stage(position, length):
    if position == length:
        return "END"
    if position == 0:
        return "position0"
    return "early" if 3 * position < length else "middle" if 3 * position < 2 * length else "late"


def distribution(values):
    return {"count": len(values), "mean": statistics.mean(values) if values else None,
            "median": statistics.median(values) if values else None,
            "min": min(values) if values else None, "max": max(values) if values else None,
            "positive": sum(x > 0 for x in values), "negative": sum(x < 0 for x in values),
            "zero": sum(x == 0 for x in values)}


def aggregate(records):
    groups = defaultdict(list)
    for row in records:
        for value in row["positions"]:
            entry = {**value, "word": row["word_id"]}
            splits = [row["split"]]
            if row["split"] == "train":
                splits.append("train_REAL01" if row.get("actual_signer") == "REAL01" else "train_other_signer")
            for split in splits:
                for section in ("all", value["stage"]):
                    groups[(split, row["cohort"], section)].append(entry)
    result = {}
    metrics = ("nll_correct", "nll_wrong", "top1_correct", "top5_correct", "top1_wrong", "top5_wrong", "top1_changed")
    for key, entries in sorted(groups.items()):
        by_word = defaultdict(list)
        for value in entries:
            by_word[value["word"]].append(value)
        token_weighted = {m: statistics.mean(v[m] for v in entries) for m in metrics}
        macro = {m: statistics.mean(statistics.mean(v[m] for v in word) for word in by_word.values()) for m in metrics}
        deltas = [v["nll_wrong"] - v["nll_correct"] for v in entries]
        word_deltas = [statistics.mean(v["nll_wrong"] - v["nll_correct"] for v in word) for word in by_word.values()]
        result["/".join(key)] = {"tokens_including_END": len(entries), "words": len(by_word),
            "token_weighted": token_weighted, "word_macro": macro,
            "delta_NLL_wrong_minus_correct_tokens": distribution(deltas),
            "delta_NLL_wrong_minus_correct_word_means": distribution(word_deltas)}
    return result


def stored_generation_stats(rows, manifest):
    expected = {(w, seed) for w in manifest["cohorts"]["original30"]["words"] for seed in SEEDS}
    indexed = {}
    for row in rows:
        key = (row.get("word_id"), row.get("seed"))
        require(key in expected and key not in indexed and row.get("status") == "ok", "stored_samples", "missing/duplicate/failed sample")
        ts = row.get("tokens")
        require(isinstance(ts, list) and 2 <= len(ts) <= 54 and all(type(t) is int and 0 <= t < 512 for t in ts),
                "stored_tokens", "invalid token sequence")
        indexed[key] = ts
    require(set(indexed) == expected, "stored_samples", "all original90 required")
    pairs, equal = [], 0
    items = list(indexed.items())
    for i, (ka, a) in enumerate(items):
        for kb, b in items[i+1:]:
            if ka[0] == kb[0]:
                continue
            prefix = 0
            for x, y in zip(a, b):
                if x != y:
                    break
                prefix += 1
            pairs.append(prefix)
            equal += a == b
    adjacent = [sum(a == b for a, b in zip(ts, ts[1:])) / (len(ts)-1) for ts in indexed.values()]
    return {"samples": len(indexed), "words": 30, "length_tokens": distribution([len(t) for t in indexed.values()]),
        "cross_word_pairs": len(pairs), "cross_word_identical_sequences": equal,
        "cross_word_common_prefix_length": distribution(pairs),
        "adjacent_repeat_fraction": distribution(adjacent),
        "most_common_prefix_counts": {str(n): max(Counter(tuple(ts[:n]) for ts in indexed.values() if len(ts) >= n).values(), default=0)
                                      for n in (1, 2, 4, 8)}, "EOS": "unmeasured; END/PAD already removed",
        "new_generation_calls": 0}


def torch_scorer(model, checkpoint, selection, device):
    import numpy as np
    import torch
    from gen.training import Trainer, TrainingConfig
    trainer = Trainer.__new__(Trainer)
    trainer.model, trainer.selection, trainer.kind, trainer.device = model.eval(), selection, "gpt", torch.device(device)
    trainer.generation_signer = checkpoint["generation_signer"]
    trainer.config = replace(TrainingConfig(**checkpoint["config"]), corrupt=0.0)
    trainer.rng = np.random.default_rng(17)

    def score(rows, split, wrong):
        trace = {}
        with isolated_rng(17, device), torch.no_grad():
            trainer.loss(rows, training=split == "train", trace=trace)
            for i, row in enumerate(rows):
                tokens, length = row["tokens"], trace["inputs"].shape[1]
                require(trace["condition"][i].item() == checkpoint["classes"][row["item"]], "condition_mapping", row["clip"])
                signer = row["signer"] if split == "train" else "REAL01"
                require(trace["signers"][i].item() == checkpoint["signers"][signer], "signer_mapping", row["clip"])
                require(trace["inputs"][i].tolist() == tokens + [model.pad]*(length-len(tokens)) and
                        trace["targets"][i].tolist() == tokens + [model.end] + [-100]*(length-len(tokens)),
                        "batch_alignment", row["clip"])
            changed = torch.tensor([checkpoint["classes"][wrong[r["item"]]] for r in rows], device=trainer.device)
            require(bool((changed != trace["condition"]).all()), "derangement", "condition IDs must differ")
            wrong_logits = model(changed, trace["inputs"], trace["signers"])
            require(bool(torch.isfinite(trace["logits"]).all() and torch.isfinite(wrong_logits).all()),
                    "nonfinite_logits", "correct/wrong condition")
            correct, incorrect = trace["logits"].log_softmax(-1), wrong_logits.log_softmax(-1)
            output = []
            for i, row in enumerate(rows):
                positions = []
                for p in range(len(row["tokens"]) + 1):
                    target = int(trace["targets"][i, p])
                    a, b = correct[i, p], incorrect[i, p]
                    positions.append({"stage": stage(p, len(row["tokens"])), "position": p,
                        "nll_correct": float(-a[target]), "nll_wrong": float(-b[target]),
                        "top1_correct": int(a.argmax().item() == target), "top1_wrong": int(b.argmax().item() == target),
                        "top5_correct": int(target in a.topk(min(5, len(a))).indices.tolist()),
                        "top5_wrong": int(target in b.topk(min(5, len(b))).indices.tolist()),
                        "top1_changed": int(a.argmax().item() != b.argmax().item())})
                output.append({"word_id": row["item"], "clip": row["clip"], "split": split,
                    "alignment_verified": True, "condition_id": int(trace["condition"][i]),
                    "wrong_condition_id": int(changed[i]), "signer_index": int(trace["signers"][i]),
                    "actual_batch_input_sha256": codes_hash(trace["inputs"][i].tolist()),
                    "actual_batch_target_sha256": codes_hash(trace["targets"][i].tolist()),
                    "ignored_PAD_target_count": int((trace["targets"][i] == -100).sum()), "positions": positions})
        return output
    return score


def run_diagnostic(manifest, selection, scorer, *, batch=16):
    require(type(batch) is int and batch > 0, "batch", "positive required")
    results = []
    for split in ("train", "val"):
        allowed = {r["clip"]: r for r in (selection.train if split == "train" else selection.partitions["val"])}
        fixed = manifest["records"][split]
        for start in range(0, len(fixed), batch):
            descriptions = fixed[start:start+batch]
            rows = []
            for desc in descriptions:
                require(desc["clip"] in allowed and describe(allowed[desc["clip"]]) == {k: v for k, v in desc.items() if k != "cohort"},
                        "diagnostic_allowlist", desc["clip"])
                rows.append(allowed[desc["clip"]])
            scored = scorer(rows, split, manifest["derangement"])
            require(len(scored) == len(rows), "scorer_count", split)
            for desc, row, result in zip(descriptions, rows, scored):
                require(result["word_id"] == row["item"] and result["clip"] == row["clip"] and
                        len(result["positions"]) == len(row["tokens"])+1, "scorer_identity", row["clip"])
                results.append({**result, "cohort": desc["cohort"], "actual_signer": row["signer"]})
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    phase = ap.add_mutually_exclusive_group(required=True)
    phase.add_argument("--prepare", action="store_true")
    phase.add_argument("--run", action="store_true")
    for name in ("checkpoint", "vq", "vq-config", "tokens", "data", "split", "original-manifest", "stored-samples", "out"):
        ap.add_argument(f"--{name}", required=True)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    ap.add_argument("--batch", type=int, default=16)
    args = ap.parse_args(argv)
    paths = {"checkpoint": args.checkpoint, "vq": args.vq, "vq_config": args.vq_config, "tokens": args.tokens,
             "meta": str(Path(args.data)/"meta.jsonl"), "split": args.split,
             "original_manifest": args.original_manifest, "stored_samples": args.stored_samples}
    out = Path(args.out)
    frozen = None
    if args.run:
        frozen = json.loads((out/"manifest.json").read_text(encoding="utf-8"))
        require(frozen["code_sha256"] == code_hashes(), "diagnostic_code_changed", "source")
        require(all(v["sha256"] == sha256_file(paths[k]) and v["path"] == str(Path(paths[k]).resolve())
                    for k, v in frozen["inputs"].items()), "diagnostic_input_changed", "inputs")
        require(frozen["device"] == args.device and frozen["batch"] == args.batch, "diagnostic_settings", "device/batch")
    from gen.train_word import load_generator
    model, checkpoint = load_generator(args.checkpoint, args.device)
    selection = select_data(args.tokens, paths["meta"], args.split, mode="formal")
    original = json.loads(Path(args.original_manifest).read_text(encoding="utf-8"))
    manifest = prepare_manifest(selection, checkpoint, paths, original) | {"device": args.device, "batch": args.batch}
    if args.prepare:
        require(not out.exists() or not any(out.iterdir()), "output_not_empty", str(out))
        write_json_atomic(out/"manifest.json", manifest)
        print(json.dumps({"words": 60, "train_records": len(manifest["records"]["train"]),
                          "val_records": len(manifest["records"]["val"]), "new_generation_calls": 0}))
        return
    require(manifest == frozen, "diagnostic_manifest_changed", "selection/config")
    require(not any((out/name).exists() for name in ("summary.json", "per_clip.json", "stored_generation.json")),
            "output_exists", str(out))
    stored = json.loads(Path(args.stored_samples).read_text(encoding="utf-8"))
    stored_stats = stored_generation_stats(stored, manifest)
    write_json_atomic(out/"stored_generation.json", stored_stats)
    results = run_diagnostic(manifest, selection, torch_scorer(model, checkpoint, selection, args.device), batch=args.batch)
    summary = {"schema_version": 1, "mapping_audit": manifest["mapping_audit"], "teacher_forced": aggregate(results),
               "stored_generation": stored_stats,
               "runtime": {"device": args.device, "python": sys.version,
                           **{name: str(getattr(sys.modules.get(name), "__version__", "unavailable")) for name in ("torch", "numpy")}},
               "delta_sign": "wrong NLL - correct NLL: positive favors correct WORD condition",
               "limits": "train is diagnostic, both cohorts are val; no semantic verdict or automatic training decision"}
    write_json_atomic(out/"per_clip.json", results)
    write_json_atomic(out/"summary.json", summary)
    print(json.dumps({"records_scored": len(results), "alignment_failures": 0, "new_generation_calls": 0}))


if __name__ == "__main__":
    main()
