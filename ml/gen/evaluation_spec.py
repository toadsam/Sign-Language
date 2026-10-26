"""Explicit model registration and fixed val cohorts for parent/pilot evaluation."""
import argparse
import json
from pathlib import Path

from gen.artifacts import sha256_file, write_json_atomic


PARENT_SHA256 = "3308e6aa3c0a4be46b94961fa6d139833b5e879a15134d133095a0d9cee21bbb"
E5_SHA256 = "939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38"
E5_CONFIG_SHA256 = "d652055f41f973fb56fed84d84e009c8f747cc58f9ac1f7ccdb29467117ec574"
SHARED_INPUTS = ("tokens", "meta", "split", "vq", "vq_config")


def check(condition, detail):
    if not condition:
        raise ValueError(f"evaluation_spec: {detail}")


def validate_spec(spec):
    check(isinstance(spec, dict) and spec.get("schema_version") == 1, "schema")
    shared = spec.get("shared_input_sha256", {})
    check(set(shared) == set(SHARED_INPUTS) and shared["vq"] == E5_SHA256 and
          shared["vq_config"] == E5_CONFIG_SHA256, "fixed E5/shared inputs")
    check(spec.get("sampling") == {"top_k": 10, "temperature": 1.0, "min_len": 2,
          "signer": "REAL01", "seeds": [17, 18, 19]}, "fixed sampling")
    cohort = spec.get("cohort", {})
    check(cohort.get("name") in ("original30", "extra30"), "cohort name")
    words, refs = cohort.get("words"), cohort.get("references")
    check(isinstance(words, list) and len(words) == len(set(words)) == 30 and isinstance(refs, dict)
          and set(refs) == set(words) and all(isinstance(r, list) and r == sorted(set(r)) and r for r in refs.values()), "cohort30/all refs")
    models = spec.get("models")
    check(isinstance(models, dict) and models, "models")
    for key, model in models.items():
        check(isinstance(key, str) and isinstance(model, dict), "model entry")
        check(isinstance(model.get("path"), str) and Path(model["path"]).is_absolute(), "absolute model path")
        digest, step, parent = model.get("sha256"), model.get("expected_step"), model.get("parent_sha256")
        check(isinstance(digest, str) and len(digest) == 64 and all(c in "0123456789abcdef" for c in digest), "model SHA256")
        check(type(step) is int and step >= 0, "expected step")
        check((digest == PARENT_SHA256 and step == 2280 and parent is None) or parent == PARENT_SHA256,
              "documented parent or explicit warm-start child required")
    return spec


def build_spec(diagnostic, models, cohort):
    check(cohort in ("original30", "extra30"), "cohort name")
    for entry in models.values():
        check(sha256_file(entry["path"]) == entry["sha256"], "registered model bytes differ")
    return validate_spec({"schema_version": 1,
        "shared_input_sha256": {k: diagnostic["inputs"][k]["sha256"] for k in SHARED_INPUTS},
        "cohort": {"name": cohort, **diagnostic["cohorts"][cohort]},
        "sampling": diagnostic["sampling"], "models": models,
        "purpose": "new generation manifest per registered model; immutable cohort; not independent test"})


def check_model(spec, key, checkpoint, path):
    validate_spec(spec)
    check(key in spec["models"], "unregistered model")
    entry = spec["models"][key]
    check(Path(entry["path"]).resolve() == Path(path).resolve() and sha256_file(path) == entry["sha256"], "model path/hash")
    check(checkpoint.get("checkpoint_schema_version") == 1 and checkpoint.get("kind") == "gpt" and checkpoint.get("checkpoint_type") == "inference" and
          checkpoint.get("global_step") == entry["expected_step"], "model kind/type/step")
    parent = checkpoint.get("parent_provenance")
    check((parent is None and entry["parent_sha256"] is None) or
          (isinstance(parent, dict) and parent.get("sha256") == entry["parent_sha256"]), "parent provenance")
    return entry


def cohort_identity(manifest):
    return {"selected": manifest["selected"], "reference_sha256": manifest["reference_sha256"],
            "shared_input_sha256": {k: manifest["input_sha256"][k] for k in SHARED_INPUTS},
            "sampling": manifest["sampling"], "decoder": manifest["decoder"]}


def compare_runs(parent_manifest, parent_summary, candidate_manifest, candidate_summary, *, parent_motion=None, baseline=None):
    check(cohort_identity(parent_manifest) == cohort_identity(candidate_manifest), "comparison cohort/reference/E5/sampling differs")
    parent_sha = parent_manifest["checkpoint"]["sha256"]
    check(parent_sha == PARENT_SHA256, "baseline must be documented parent")
    child = candidate_manifest.get("registered_model", {})
    check(child.get("parent_sha256") == parent_sha, "candidate parent differs")
    complete = all(s["successes"] == s["attempted"] == 90 and s["failures"] == 0 and
                   s["complete_word_count"] == 30 for s in (parent_summary, candidate_summary))
    metrics = {}
    values = {"dtw_macro": (parent_summary["dtw_macro_complete_words"], candidate_summary["dtw_macro_complete_words"])}
    for wrist in ("13", "34"):
        for metric in ("path", "speed_per_second", "jerk_per_second_cubed"):
            values[f"wrist{wrist}_{metric}"] = (parent_summary["wrist"][wrist][metric]["mean"],
                                                  candidate_summary["wrist"][wrist][metric]["mean"])
    for hand in ("left", "right"):
        for metric, old_key in (("path", "finger_relative_path"), ("speed_per_second", "finger_relative_speed")):
            old = parent_summary.get("finger_relative", {}).get(hand, {}).get(metric, {}).get("mean")
            if old is None and parent_motion is not None:
                old = parent_motion["aggregate"]["gpt_e5"][hand][old_key]
            new = candidate_summary.get("finger_relative", {}).get(hand, {}).get(metric, {}).get("mean")
            values[f"{hand}_finger_relative_{metric}"] = (old, new)
    for name, (old, new) in values.items():
        metrics[name] = {"parent": old, "candidate": new, "candidate_minus_parent": new-old if old is not None and new is not None else None}
    baseline_loss = baseline["ordinary_val_loss"] if baseline is not None else None
    candidate_loss = candidate_manifest["checkpoint"].get("best_validation")
    return {"schema_version": 1, "cohort_identical": True, "all_90_complete_both": complete,
            "parent_sha256": parent_sha, "candidate_sha256": candidate_manifest["checkpoint"]["sha256"],
            "candidate_is_step0_baseline": candidate_manifest["checkpoint"]["step"] == 0,
            "ordinary_val_loss": {"parent_historical": parent_manifest["checkpoint"].get("best_validation"),
                                  "pilot_step0": baseline_loss, "candidate_best": candidate_loss,
                                  "candidate_minus_step0": candidate_loss-baseline_loss if candidate_loss is not None and baseline_loss is not None else None},
            "counts": {"parent": {k: parent_summary[k] for k in ("attempted", "successes", "failures", "complete_word_count")},
                       "candidate": {k: candidate_summary[k] for k in ("attempted", "successes", "failures", "complete_word_count")}},
            "metrics": metrics, "automatic_improvement_verdict": None,
            "unmeasured": ["sign semantic accuracy", "one-hand word preservation", "per-hand relative finger quality/visual review"],
            "interpretation": "paired numeric diagnostics only; incomplete words must not be presented as full cohort quality"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    phase = ap.add_mutually_exclusive_group(required=True)
    phase.add_argument("--build", action="store_true")
    phase.add_argument("--compare", action="store_true")
    ap.add_argument("--diagnostic-manifest")
    ap.add_argument("--models-json", help="explicit paths/SHA256/expected_step/parent_sha256 registry JSON")
    ap.add_argument("--cohort", choices=("original30", "extra30"))
    ap.add_argument("--parent-run")
    ap.add_argument("--candidate-run")
    ap.add_argument("--parent-motion-dir", help="reuse completed three-way summary+receipt; never decode/regenerate")
    ap.add_argument("--pilot-training-run", help="read saved full ordinary-val step0 baseline.json for loss comparison")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    read = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
    if args.build:
        if not all((args.diagnostic_manifest, args.models_json, args.cohort)):
            ap.error("--build requires --diagnostic-manifest --models-json --cohort")
        result = build_spec(read(args.diagnostic_manifest), read(args.models_json), args.cohort)
        result["diagnostic_manifest_sha256"] = sha256_file(args.diagnostic_manifest)
    else:
        if not args.parent_run or not args.candidate_run:
            ap.error("--compare requires --parent-run --candidate-run")
        p, c = Path(args.parent_run), Path(args.candidate_run)
        for directory in (p, c):
            status = read(directory/"run_status.json")
            prepared = read(directory/"prepare_status.json")
            check(status.get("phase") in ("complete", "partial") and
                  status.get("summary_sha256") == sha256_file(directory/"summary.json") and
                  prepared.get("phase") == "prepared" and
                  prepared.get("manifest_sha256") == sha256_file(directory/"manifest.json"), "run status/manifest/summary hash")
        pm, cm = read(p/"manifest.json"), read(c/"manifest.json")
        motion = None
        if args.parent_motion_dir:
            directory = Path(args.parent_motion_dir)
            receipt = read(directory/"receipt.json")
            check(receipt["manifest_sha256"] == sha256_file(p/"manifest.json") and
                  receipt["per_sample_sha256"] == sha256_file(p/"per_sample.json") and
                  receipt["input_sha256"] == pm["input_sha256"] and
                  receipt["reference_coordinates_sha256"] == pm["reference_sha256"] and
                  receipt["files"]["summary.json"] == sha256_file(directory/"summary.json"), "parent motion receipt linkage")
            motion = read(directory/"summary.json")
            check(motion["counts"]["gpt_e5_unique"] == 90 and
                  set(motion["words"]) == {item["word_id"] for item in pm["selected"]}, "parent motion cohort")
        baseline = None
        if args.pilot_training_run:
            training_run = Path(args.pilot_training_run).resolve()
            baseline = read(training_run/"baseline.json")
            check(Path(cm["registered_model"]["path"]).resolve().parent == training_run and
                  baseline["global_step"] == 0 and baseline["parent_provenance"]["sha256"] == PARENT_SHA256 and
                  baseline["validation_clips"] == pm["selection_counts"]["val"] and
                  not baseline["validation_skipped"], "pilot step0 full-val provenance")
        result = compare_runs(pm, read(p/"summary.json"), cm, read(c/"summary.json"), parent_motion=motion, baseline=baseline)
    write_json_atomic(args.out, result)
    print(json.dumps({"output": args.out, "automatic_improvement_verdict": None}))


if __name__ == "__main__":
    main()
