"""Frozen, val-only diagnostic for the WORD GPT. Run from ``ml``.

The CLI has two evaluation phases. ``--prepare`` hashes selected val coordinate
files and freezes a manifest; ``--run`` verifies it before generation.
``--summarize`` writes aggregate-only numbers after a completed run. A B-owned
adapter supplies model and decoder calls.
"""
import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import importlib
import inspect
import json
import math
import os
from pathlib import Path
import random
import re
import statistics
import sys

from gen.artifacts import sha256_file, write_json_atomic
from gen.data import select_data


BEST_SHA256 = "3308e6aa3c0a4be46b94961fa6d139833b5e879a15134d133095a0d9cee21bbb"
SEEDS = (17, 18, 19)
SAMPLING = {"top_k": 10, "temperature": 1.0, "min_len": 2, "signer": "REAL01"}
FPS = 30
JOINTS = 125
METRIC_JOINTS = 55
WRISTS = (13, 34)
EXPECTED_COUNTS = {"train": 34501, "val": 5453, "test": 5907}
INFERENCE_FILES = (
    "gen/__init__.py", "gen/evaluation_adapter.py", "gen/infer.py", "gen/infer_models.py",
    "gen/verify_bundle.py", "gen/vocab.py", "gen/baselines.py", "gen/train_word.py",
    "gen/training.py", "gen/model.py", "gen/artifacts.py", "gen/data.py",
    "vq/__init__.py", "vq/model.py", "common/__init__.py", "common/data.py",
    "common/skeleton.py",
)


class EvaluationError(ValueError):
    def __init__(self, code, detail):
        self.code = code
        super().__init__(f"{code}: {detail}")


def require(condition, code, detail):
    if not condition:
        raise EvaluationError(code, detail)


def select_words(selection, classes, count=30):
    """SHA256(word-val-v1|17|WORD_ID), then WORD ID, ascending."""
    require(selection.report["data_mode"] == "formal", "formal_required", "selection")
    require(type(count) is int and count > 0, "invalid_count", str(count))
    by_word = {}
    for row in selection.partitions["val"]:
        if row["item"] in classes:
            by_word.setdefault(row["item"], []).append(row)
    ranked = sorted(by_word, key=lambda word: (
        hashlib.sha256(f"word-val-v1|17|{word}".encode("utf-8")).hexdigest(), word))
    require(len(ranked) >= count, "insufficient_words", f"eligible={len(ranked)} required={count} missing={count-len(ranked)}")
    return ranked[:count], {w: sorted(by_word[w], key=lambda r: r["clip"]) for w in ranked[:count]}


def _inputs(paths):
    return {key: sha256_file(value) for key, value in sorted(paths.items())}


def make_manifest(selection, checkpoint, paths, *, count=30, device="cpu", decoder_info=None,
                  adapter_sha256=None, expected_counts=None, evaluation_spec=None, model_key=None):
    """Pure metadata phase; paths are checkpoint/tokens/meta/split/vq files."""
    required = {"checkpoint", "tokens", "meta", "split", "vq", "vq_config"}
    require(set(paths) == required, "input_paths", str(sorted(paths)))
    require(Path(paths["vq_config"]).resolve() == Path(paths["vq"]).resolve().parent / "config.json",
            "vq_config_path", "config.json must accompany E5 model.pt")
    for bucket, expected in (expected_counts or {}).items():
        actual = selection.report["counts"].get(bucket)
        require(actual == expected, "selection_count", f"{bucket}: actual={actual} expected={expected}")
    hashes = _inputs(paths)
    require(checkpoint.get("kind") == "gpt", "checkpoint_kind", "gpt required")
    registered = None
    if evaluation_spec is None:
        require(hashes["checkpoint"] == BEST_SHA256, "checkpoint_hash", hashes["checkpoint"])
        require(checkpoint.get("global_step", checkpoint.get("best_step")) == 2280, "checkpoint_step", "best 2280 required")
    else:
        from gen.evaluation_spec import check_model, SHARED_INPUTS
        registered = check_model(evaluation_spec, model_key, checkpoint, paths["checkpoint"])
        require(all(evaluation_spec["shared_input_sha256"][k] == hashes[k] for k in SHARED_INPUTS),
                "evaluation_spec_inputs", "E5/tokens/meta/split differ")
    classes, signers = checkpoint.get("classes"), checkpoint.get("signers")
    require(isinstance(classes, dict) and classes and all(type(v) is int for v in classes.values()), "classes", "invalid")
    require(classes == selection.classes, "classes", "checkpoint and train selection differ")
    require(isinstance(signers, dict) and SAMPLING["signer"] in signers, "signer", "REAL01 absent from train")
    require(signers == selection.signers, "signer", "checkpoint and train selection differ")
    require(checkpoint.get("generation_signer") == SAMPLING["signer"], "signer", "checkpoint generation signer")
    nb, max_len = checkpoint.get("nb_code"), checkpoint.get("max_len")
    require(type(nb) is int and nb == selection.tokens["nb_code"] == 512, "nb_code", "checkpoint/token/expected mismatch")
    require(type(max_len) is int and max_len == 54, "max_len", "checkpoint/expected mismatch")
    artifact = checkpoint.get("artifact_manifest")
    require(isinstance(artifact, dict) and artifact.get("data_mode") == "formal", "artifact_manifest", "formal required")
    for field, key in (("tokens_sha256", "tokens"), ("split_sha256", "split"), ("vq_sha256", "vq")):
        require(artifact.get(field) == hashes[key], "artifact_hash", field)
    require(artifact.get("meta_sha256", {}).get("word") == hashes["meta"], "artifact_hash", "meta")
    selection_bytes = (json.dumps(selection.report, ensure_ascii=False, sort_keys=True, indent=2,
                                  allow_nan=False) + "\n").encode("utf-8")
    require(artifact.get("selection_sha256") == hashlib.sha256(selection_bytes).hexdigest(),
            "artifact_hash", "selection")
    require(artifact.get("nb_code") == nb and artifact.get("down") == selection.tokens["down"], "artifact_dimension", "nb_code/down")
    require(artifact.get("parts") == "body_hand", "artifact_parts", "body_hand expected")
    if decoder_info is not None:
        require(isinstance(decoder_info, dict) and all(decoder_info.get(k) == v for k, v in
                (("nb_code", nb), ("down", selection.tokens["down"]), ("parts", artifact["parts"]))),
                "decoder_dimension", "loaded E5 config differs")
    if evaluation_spec is None:
        words, refs = select_words(selection, classes, count)
    else:
        words = evaluation_spec["cohort"]["words"]
        refs = {w: sorted((r for r in selection.partitions["val"] if r["item"] == w), key=lambda r: r["clip"]) for w in words}
        require(len(words) == count == 30 and all(w in classes for w in words) and
                {w: [r["clip"] for r in refs[w]] for w in words} == evaluation_spec["cohort"]["references"],
                "evaluation_spec_cohort", "all val references must match fixed cohort")
    selected = [{"word_id": word, "rank_sha256": hashlib.sha256(f"word-val-v1|17|{word}".encode("utf-8")).hexdigest(),
                 "references": [{"clip": row["clip"], "frames": row["frames"],
                                  "total_frames": row["total_frames"], "signer": row["signer"]}
                                 for row in refs[word]]} for word in words]
    val_words = {r["item"] for r in selection.partitions["val"]}
    reasons = {w: ("selected" if w in words else "eligible_not_selected" if w in val_words else "no_eligible_val_reference")
               for w in sorted(classes)}
    result = {"schema_version": 1, "purpose": "WORD GPT val diagnostic; no semantic or product verdict",
            "selection_rule": f"SHA256 UTF-8 word-val-v1|17|<WORD_ID>; sort (hash, WORD_ID); first {count}",
            "selected": selected, "candidate_count": len(val_words & classes.keys()),
            "selection_reasons": reasons, "excluded_val_oov_words": sorted(val_words - classes.keys()),
            "val_clip_ids": selection.report["clips"]["val"],
            "filter_exclusions": selection.report["excluded_clips"],
            "selection_counts": selection.report["counts"], "input_sha256": hashes,
            "evaluator_sha256": sha256_file(__file__), "adapter_sha256": adapter_sha256,
            "selector_sha256": sha256_file(inspect.getfile(select_data)),
            "artifact_code_sha256": sha256_file(inspect.getfile(sha256_file)),
            "selection_sources": selection.report["sources"],
            "checkpoint": {"step": checkpoint.get("global_step", checkpoint.get("best_step")), "sha256": hashes["checkpoint"], "nb_code": nb, "max_len": max_len,
                           "artifact_manifest": artifact, "best_validation": checkpoint.get("best_validation"),
                           "artifact_role": checkpoint.get("artifact_role", "legacy_validation_best")},
            "decoder": {"down": selection.tokens["down"], "parts": artifact["parts"]},
            "sampling": {**SAMPLING, "seeds": list(SEEDS), "fps": FPS}, "device_requested": device}
    if registered is not None:
        result.update(registered_model=registered, model_key=model_key, cohort_name=evaluation_spec["cohort"]["name"],
                      selection_rule="explicit frozen evaluation spec; all val references")
    return result


def _safe_clip_path(data_dir, clip, allowed):
    require(clip in allowed, "coordinate_not_allowed", clip)
    require(isinstance(clip, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", clip) and clip not in (".", ".."),
            "invalid_clip_path", str(clip))
    root = (Path(data_dir) / "npy").resolve()
    path = (root / f"{clip}.npy").resolve()
    require(path.parent == root, "coordinate_not_allowed", clip)
    return path


def reference_hashes(manifest, data_dir):
    """Hash selected val files only, before their contents are decoded."""
    allowed = {r["clip"] for item in manifest["selected"] for r in item["references"]}
    return {clip: sha256_file(_safe_clip_path(data_dir, clip, allowed)) for clip in sorted(allowed)}


def workload_estimate(manifest, data_dir, paths):
    """Frame/cell/byte counts for planning; never a measured runtime."""
    references = [r for item in manifest["selected"] for r in item["references"]]
    lengths = [r["frames"][1] - r["frames"][0] for r in references]
    allowed = {r["clip"] for r in references}
    max_generated = manifest["checkpoint"]["max_len"] * manifest["decoder"]["down"]
    gen_ref_cells = len(SEEDS) * max_generated * sum(lengths)
    recon_cells = sum(length * length for length in lengths)
    diversity_cells = len(manifest["selected"]) * 3 * max_generated * max_generated
    largest_pair = max(max_generated * max_generated,
                       max_generated * max(lengths, default=0),
                       max((length * length for length in lengths), default=0))
    return {"kind": "upper_bound_from_frozen_frames_not_timing",
            "reference_count": len(references), "reference_frames_total": sum(lengths),
            "reference_frames_max": max(lengths, default=0),
            "reference_file_bytes_total": sum(_safe_clip_path(data_dir, clip, allowed).stat().st_size
                                              for clip in allowed),
            "other_input_file_bytes_total": sum(Path(path).stat().st_size for path in paths.values()),
            "expected_generations": len(manifest["selected"]) * len(SEEDS),
            "max_generated_frames": max_generated,
            "dtw_cells_upper": {"generated_vs_reference": gen_ref_cells,
                                "reference_reconstruction": recon_cells,
                                "within_word_diversity": diversity_cells},
            "single_numpy_broadcast_bytes_estimate": largest_pair * METRIC_JOINTS * 3 * 4}


def dependency_hashes(code_root, adapter_sha256, *, adapter_relative="gen/evaluation_adapter.py", extra_files=()):
    """Freeze the explicit transitive B inference source inventory."""
    root = Path(code_root).resolve(strict=True)
    require(root.is_dir(), "inference_code_root", str(root))
    files = {}
    for relative in (*INFERENCE_FILES, *extra_files):
        path = (root / relative).resolve(strict=True)
        require(path.is_file() and path.is_relative_to(root), "inference_code_path", relative)
        files[relative] = {"path": str(path), "sha256": sha256_file(path)}
    require(files[adapter_relative]["sha256"] == adapter_sha256,
            "adapter_source", "loaded factory differs from inference code root")
    return files


def bundle_hashes():
    """Resolve B's selected bundle and its declared vocab_map file."""
    value = os.environ.get("GEN_EVALUATION_BUNDLE")
    require(isinstance(value, str) and value.strip(), "bundle_env", "GEN_EVALUATION_BUNDLE required")
    bundle = Path(value).resolve(strict=True)
    require(bundle.is_dir(), "bundle_path", str(bundle))
    config = (bundle / "generator.json").resolve(strict=True)
    require(config.is_file(), "bundle_path", str(config))
    raw = config.read_bytes()
    try:
        def unique(pairs):
            result = {}
            for key, item in pairs:
                require(key not in result, "bundle_duplicate_key", key)
                result[key] = item
            return result
        settings = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise EvaluationError("bundle_json", str(config)) from exc
    value = settings.get("vocab_map") if isinstance(settings, dict) else None
    require(isinstance(value, str) and value.strip(), "bundle_vocab_map", "vocab_map required")
    vocab = (bundle / value).resolve(strict=True)
    require(vocab.is_file(), "bundle_vocab_map", str(vocab))
    return {"directory": str(bundle),
            "generator": {"path": str(config), "sha256": hashlib.sha256(raw).hexdigest()},
            "vocab_map": {"path": str(vocab), "sha256": sha256_file(vocab)}}


def _shape(motion):
    shape = getattr(motion, "shape", None)
    if shape is not None:
        return tuple(shape)
    try:
        return (len(motion), len(motion[0]), len(motion[0][0]))
    except (IndexError, TypeError):
        return None


def check_motion(motion, *, expected_frames=None):
    shape = _shape(motion)
    require(shape is not None and len(shape) == 3 and shape[0] > 0 and shape[1:] == (JOINTS, 3),
            "motion_shape", str(shape))
    if expected_frames is not None:
        require(shape[0] == expected_frames, "motion_length", f"{shape[0]} != {expected_frames}")
    dtype = getattr(motion, "dtype", None)
    require(str(dtype) == "float32", "motion_dtype", str(dtype))
    for frame in motion:
        for joint in frame:
            require(all(math.isfinite(float(x)) for x in joint), "motion_nonfinite", "coordinate")
    return shape[0]


def load_reference(data_dir, row, allowed, loader=None):
    path = _safe_clip_path(data_dir, row["clip"], allowed)
    if loader is None:
        import numpy as np
        loader = lambda p: np.load(p, allow_pickle=False)
    full = loader(path)
    if getattr(full, "shape", None) is not None and len(full.shape) == 2 and full.shape[1] == 375:
        full = full.reshape(-1, JOINTS, 3)
    check_motion(full, expected_frames=row["total_frames"])
    start, end = row["frames"]
    require(0 <= start < end <= len(full), "reference_frames", row["clip"])
    return full[start:end]


def check_tokens(tokens, nb_code, max_len):
    require(isinstance(tokens, list) and 2 <= len(tokens) <= max_len and
            all(type(t) is int and 0 <= t < nb_code for t in tokens), "generated_tokens", str(tokens)[:80])


def _distance(a, b):
    return sum(math.dist(a[j], b[j]) for j in range(METRIC_JOINTS)) / METRIC_JOINTS


def dtw(a, b):
    """Mean joint Euclidean local cost, min accumulated path / path length.

    Exact ties prefer diagonal, then upward (advance a), then leftward.
    """
    check_motion(a)
    check_motion(b)
    np = sys.modules.get("numpy")
    if np is not None and isinstance(a, np.ndarray) and isinstance(b, np.ndarray):
        costs = np.linalg.norm(a[:, None, :METRIC_JOINTS] - b[None, :, :METRIC_JOINTS], axis=-1).mean(axis=-1)
        cost = lambda i, j: float(costs[i, j])
    else:
        cost = lambda i, j: _distance(a[i], b[j])
    previous = [None] * (len(b) + 1)
    previous[0] = (0.0, 0)
    for i in range(len(a)):
        current = [None] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            choices = ((previous[j-1], 0), (previous[j], 1), (current[j-1], 2))
            best = min(((v[0], tie, v[1]) for v, tie in choices if v is not None))
            current[j] = (best[0] + cost(i, j-1), best[2] + 1)
        previous = current
    total, length = previous[-1]
    return total / length


def wrist_metrics(motion):
    n = check_motion(motion)
    paths, speeds, jerks = {}, {}, {}
    for joint in WRISTS:
        points = [frame[joint] for frame in motion]
        path = sum(math.dist(points[i], points[i-1]) for i in range(1, n))
        paths[str(joint)] = path
        speeds[str(joint)] = path * FPS / (n-1) if n > 1 else None
        jerks[str(joint)] = (statistics.mean(math.sqrt(sum((points[i+3][k] - 3*points[i+2][k]
                    + 3*points[i+1][k] - points[i][k])**2 for k in range(3))) * FPS**3
                    for i in range(n-3)) if n >= 4 else None)
    return {"wrist_path": paths, "wrist_speed_per_second": speeds, "wrist_jerk_per_second_cubed": jerks}


def finger_relative_metrics(motion):
    """Mean path of 20 fingers per hand after subtracting its wrist each frame."""
    count = check_motion(motion)
    result = {}
    for name, wrist in (("left", 13), ("right", 34)):
        paths = []
        for joint in range(wrist+1, wrist+21):
            points = [[float(frame[joint][k])-float(frame[wrist][k]) for k in range(3)] for frame in motion]
            paths.append(sum(math.dist(points[i], points[i-1]) for i in range(1, count)))
        value = statistics.mean(paths)
        result[name] = {"path": value, "speed_per_second": value * FPS / (count-1) if count > 1 else None}
    return result


@contextmanager
def isolated_rng(seed, device="cpu"):
    """Restore Python, NumPy and Torch RNG states; no global seed leakage."""
    py_state = random.getstate()
    np = sys.modules.get("numpy")
    np_state = np.random.get_state() if np is not None else None
    torch = sys.modules.get("torch")
    devices = []
    if torch is not None and str(device).startswith("cuda"):
        devices = list(range(torch.cuda.device_count()))
    guard = torch.random.fork_rng(devices=devices) if torch is not None else nullcontext()
    try:
        with guard:
            random.seed(seed)
            if np is not None:
                np.random.seed(seed)
            if torch is not None:
                torch.random.default_generator.manual_seed(seed)
                if devices:
                    torch.cuda.manual_seed_all(seed)
            yield
    finally:
        random.setstate(py_state)
        if np is not None:
            np.random.set_state(np_state)


def _average(values):
    return statistics.mean(values) if values else None


def _no_grad():
    torch = sys.modules.get("torch")
    return torch.no_grad() if torch is not None else nullcontext()


def _distribution(values):
    return {"count": len(values), "mean": _average(values), "median": statistics.median(values) if values else None,
            "min": min(values) if values else None, "max": max(values) if values else None}


def evaluate_frozen(manifest, selection, data_dir, *, generate, decode, load_motion=None,
                    device="cpu", runtime=None, progress=None):
    """Callbacks: generate(word_id, seed, sampling)->dict(tokens,motion,fps[,eos]);
    decode(tokens)->float32 [T,125,3]. Missing/corrupt val refs abort before generation.
    """
    val = {r["clip"]: r for r in selection.partitions["val"]}
    allowed = {r["clip"] for item in manifest["selected"] for r in item["references"]}
    require(allowed <= val.keys(), "manifest_split", "non-val clip")
    refs = {}
    for item in manifest["selected"]:
        for desc in item["references"]:
            clip = desc["clip"]
            require(clip not in refs and val[clip]["item"] == item["word_id"] and
                    list(val[clip]["frames"]) == desc["frames"], "manifest_reference", clip)
            refs[clip] = load_reference(data_dir, val[clip], allowed, load_motion)
    if progress is not None:
        progress({"phase": "references_loaded", "reference_count": len(refs)})
    recon = {}
    for clip, motion in refs.items():
        tokens = val[clip]["tokens"]
        check_tokens(tokens, manifest["checkpoint"]["nb_code"], max(len(tokens), manifest["checkpoint"]["max_len"]))
        with _no_grad():
            decoded = decode(tokens)
        check_motion(decoded, expected_frames=len(motion))
        recon[clip] = {"clip": clip, "dtw": dtw(decoded, motion), "frames": len(motion)}
    if progress is not None:
        progress({"phase": "references_reconstructed", "reference_count": len(recon)})
    rows, generated = [], {}
    successes = 0
    for item in manifest["selected"]:
        word = item["word_id"]
        ref_clips = [r["clip"] for r in item["references"]]
        for seed in manifest["sampling"]["seeds"]:
            row = {"word_id": word, "seed": seed, "reference_count": len(ref_clips), "reference_clips": ref_clips}
            try:
                with isolated_rng(seed, device), _no_grad():
                    output = generate(word, seed, dict(manifest["sampling"]))
                require(isinstance(output, dict), "generation_output", word)
                tokens = output["tokens"]
                check_tokens(tokens, manifest["checkpoint"]["nb_code"], manifest["checkpoint"]["max_len"])
                require(output.get("fps") == FPS, "generation_fps", word)
                motion = output["motion"]
                frames = check_motion(motion)
                require(frames == len(tokens) * manifest["decoder"]["down"], "generation_length", word)
                distances = {clip: dtw(motion, refs[clip]) for clip in ref_clips}
                paths = wrist_metrics(motion)
                ref_paths = {clip: wrist_metrics(refs[clip])["wrist_path"] for clip in ref_clips}
                ratios = {str(j): [paths["wrist_path"][str(j)] / ref_paths[clip][str(j)]
                                   for clip in ref_clips if ref_paths[clip][str(j)] > 0] for j in WRISTS}
                row.update({"status": "ok", "tokens": tokens, "token_length": len(tokens), "frames": frames,
                            "seconds": frames / FPS, "max_len_reached": len(tokens) == manifest["checkpoint"]["max_len"],
                            "eos": output.get("eos"), "dtw_by_reference": distances,
                            "dtw_mean_all_references": _average(list(distances.values())), **paths,
                            "finger_relative": finger_relative_metrics(motion),
                            "wrist_path_ratio_to_references": {j: _distribution(v) for j, v in ratios.items()},
                            "zero_reference_path_count": {str(j): len(ref_clips)-len(ratios[str(j)]) for j in WRISTS}})
                generated[(word, seed)] = motion
            except Exception as exc:
                code = getattr(exc, "code", type(exc).__name__)
                if (isinstance(exc, (MemoryError, OSError)) or "out of memory" in str(exc).lower()
                        or code in {"hash_mismatch", "manifest_mismatch", "decoder_mismatch",
                                    "selection_mismatch", "artifact_hash", "artifact_dimension"}):
                    raise
                row.update({"status": "failed", "error_code": getattr(exc, "code", type(exc).__name__),
                            "error": str(exc)[:300]})
            rows.append(row)
            successes += row["status"] == "ok"
            if progress is not None:
                progress({"phase": "generation", "attempted": len(rows), "successes": successes,
                          "failures": len(rows) - successes})
    words = {}
    for item in manifest["selected"]:
        word = item["word_id"]
        its = [r for r in rows if r["word_id"] == word]
        ok = [r for r in its if r["status"] == "ok"]
        pairs = [dtw(generated[(word, a)], generated[(word, b)]) for a, b in ((17,18),(17,19),(18,19))
                 if (word,a) in generated and (word,b) in generated]
        words[word] = {"attempts": len(its), "successes": len(ok), "dtw_seed_mean": _average([r["dtw_mean_all_references"] for r in ok]),
                       "diversity_pairwise_dtw": _distribution(pairs)}
    complete = [v["dtw_seed_mean"] for v in words.values() if v["successes"] == len(SEEDS)]
    ok_rows = [r for r in rows if r["status"] == "ok"]
    cross = [(a["tokens"] == b["tokens"]) for i, a in enumerate(ok_rows) for b in ok_rows[i+1:]
             if a["word_id"] != b["word_id"]]
    wrist_summary = {}
    for j in map(str, WRISTS):
        ratios = [r["wrist_path_ratio_to_references"][j]["mean"] for r in ok_rows
                  if r["wrist_path_ratio_to_references"][j]["mean"] is not None]
        wrist_summary[j] = {"path": _distribution([r["wrist_path"][j] for r in ok_rows]),
                            "speed_per_second": _distribution([r["wrist_speed_per_second"][j] for r in ok_rows
                                                                 if r["wrist_speed_per_second"][j] is not None]),
                            "jerk_per_second_cubed": _distribution([r["wrist_jerk_per_second_cubed"][j] for r in ok_rows
                                                                    if r["wrist_jerk_per_second_cubed"][j] is not None]),
                            "path_ratio": _distribution(ratios),
                            "zero_reference_path_count": sum(r["zero_reference_path_count"][j] for r in ok_rows)}
    summary = {"schema_version": 1, "interpretation": "diagnostic only; no sign semantic accuracy or product verdict",
               "runtime": runtime or {}, "expected_generations": len(manifest["selected"])*len(SEEDS),
               "attempted": len(rows), "successes": len(ok_rows), "failures": len(rows)-len(ok_rows),
               "failure_codes": {c: sum(r.get("error_code") == c for r in rows) for c in sorted({r.get("error_code") for r in rows if r["status"] == "failed"})},
               "complete_word_count": len(complete), "dtw_macro_complete_words": _average(complete),
               "dtw_generation_distribution": _distribution([r["dtw_mean_all_references"] for r in ok_rows]),
               "length_tokens": _distribution([r["token_length"] for r in ok_rows]),
               "length_frames": _distribution([r["frames"] for r in ok_rows]),
               "max_len_reached_count": sum(r["max_len_reached"] for r in ok_rows),
               "eos_telemetry": "unmeasured" if all(r.get("eos") is None for r in ok_rows) else "adapter supplied",
               "reference_reconstruction": {"count": len(recon), "dtw": _distribution([r["dtw"] for r in recon.values()])},
               "wrist": wrist_summary,
               "finger_relative": {hand: {metric: _distribution([r["finger_relative"][hand][metric] for r in ok_rows
                                                            if r["finger_relative"][hand][metric] is not None])
                                             for metric in ("path", "speed_per_second")} for hand in ("left", "right")},
               "diversity_word_means": _distribution([v["diversity_pairwise_dtw"]["mean"] for v in words.values()
                                                      if v["diversity_pairwise_dtw"]["count"] == 3]),
               "cross_word_identical_token_pairs": {"identical": sum(cross), "pairs": len(cross),
                                                      "ratio": sum(cross)/len(cross) if cross else None},
               "words": words}
    return rows, list(recon.values()), summary


def _adapter(spec, checkpoint, vq, device):
    require(":" in spec, "adapter_spec", "use module:function")
    module, name = spec.split(":", 1)
    factory = getattr(importlib.import_module(module), name)
    source = Path(inspect.getfile(factory)).resolve(strict=True)
    return factory(checkpoint, vq, device), sha256_file(source), source


def preflight_frozen(frozen, paths, code_root, device, *, adapter_relative="gen/evaluation_adapter.py", extra_files=()):
    """Reject changed source/config before importing or loading B's adapter."""
    require(isinstance(frozen, dict) and frozen.get("schema_version") == 1,
            "manifest_schema", "frozen manifest required")
    for field in ("evaluator_sha256", "selector_sha256", "artifact_code_sha256",
                  "adapter_sha256", "inference_code_sha256", "bundle_sha256", "input_sha256"):
        require(field in frozen, "manifest_field", field)
    require(frozen["device_requested"] == device, "manifest_changed", "device")
    require(frozen["evaluator_sha256"] == sha256_file(__file__) and
            frozen["selector_sha256"] == sha256_file(inspect.getfile(select_data)) and
            frozen["artifact_code_sha256"] == sha256_file(inspect.getfile(sha256_file)),
            "manifest_changed", "A evaluator/selector/artifacts code")
    require(frozen["inference_code_sha256"] == dependency_hashes(code_root, frozen["adapter_sha256"],
            adapter_relative=adapter_relative, extra_files=extra_files),
            "manifest_changed", "B inference code")
    require(frozen["bundle_sha256"] == bundle_hashes(), "manifest_changed", "bundle configuration")
    require(frozen["input_sha256"] == _inputs(paths), "manifest_changed", "checkpoint/E5/data inputs")


def numeric_summary(summary, run_status):
    """Only aggregate diagnostics; never copy words, clips, tokens or coordinates."""
    require(run_status.get("phase") in ("complete", "partial"), "run_status", "completed run required")
    expected = summary.get("expected_generations")
    require(type(expected) is int and expected == 90 and summary.get("attempted") == expected,
            "run_counts", "90 attempts required")
    require(summary.get("successes", 0) + summary.get("failures", 0) == expected and
            run_status.get("successes") == summary["successes"] and
            run_status.get("failures") == summary["failures"] and
            run_status.get("attempted") == expected and
            run_status.get("complete_word_count") == summary["complete_word_count"],
            "run_counts", "status/summary mismatch")
    complete = (summary["successes"] == 90 and summary["failures"] == 0 and
                summary["complete_word_count"] == 30)
    require(run_status["phase"] == ("complete" if complete else "partial"),
            "run_status", "phase/count mismatch")
    return {"schema_version": 1, "status": run_status["phase"],
            "interpretation": "diagnostic only; no sign semantic accuracy or product verdict",
            "generations": {"expected": expected, "attempted": summary["attempted"],
                            "successes": summary["successes"], "failures": summary["failures"],
                            "failure_codes": summary["failure_codes"],
                            "complete_word_count": summary["complete_word_count"]},
            "dtw_macro_complete_words": summary["dtw_macro_complete_words"],
            "dtw_generation_distribution": summary["dtw_generation_distribution"],
            "reference_reconstruction": summary["reference_reconstruction"],
            "length_tokens": summary["length_tokens"], "length_frames": summary["length_frames"],
            "max_len_reached_count": summary["max_len_reached_count"],
            "eos_telemetry": summary["eos_telemetry"], "wrist": summary["wrist"],
            "finger_relative": summary.get("finger_relative"),
            "diversity_word_means": summary["diversity_word_means"],
            "cross_word_identical_token_pairs": summary["cross_word_identical_token_pairs"],
            "runtime": summary["runtime"]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    phase = ap.add_mutually_exclusive_group(required=True)
    phase.add_argument("--prepare", action="store_true", help="hash selected val .npy and freeze manifest; no decoding or generation")
    phase.add_argument("--run", action="store_true", help="verify existing manifest then evaluate")
    phase.add_argument("--summarize", action="store_true", help="write aggregate-only numeric_summary.json from a completed run")
    for flag in ("checkpoint", "vq", "vq-config", "tokens", "data", "split", "out", "adapter"):
        ap.add_argument(f"--{flag}")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--inference-code-root", default=str(Path(__file__).resolve().parents[1]),
                    help="ml directory containing the B inference source files (default: this evaluator's ml)")
    ap.add_argument("--evaluation-spec", help="explicit model SHA/step/parent and frozen cohort JSON; enables registered candidates")
    ap.add_argument("--model-key", help="model entry in --evaluation-spec (requires gen.spec_adapter:factory)")
    args = ap.parse_args(argv)
    if not args.out:
        ap.error("--out is required")
    out = Path(args.out)
    if args.summarize:
        run_status = json.loads((out / "run_status.json").read_text(encoding="utf-8"))
        require(run_status.get("summary_sha256") == sha256_file(out / "summary.json"),
                "run_status", "summary hash mismatch")
        summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        safe = numeric_summary(summary, run_status)
        write_json_atomic(out / "numeric_summary.json", safe)
        print(json.dumps(safe, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return
    for field in ("checkpoint", "vq", "vq_config", "tokens", "data", "split", "adapter"):
        if not getattr(args, field):
            ap.error(f"--{field.replace('_', '-')} is required with --prepare/--run")
    spec = None
    spec_before = None
    adapter_relative, extras = "gen/evaluation_adapter.py", ()
    if args.evaluation_spec:
        require(args.model_key and args.adapter == "gen.spec_adapter:factory", "evaluation_spec_adapter", "registered spec adapter required")
        require(os.environ.get("GEN_EVALUATION_SPEC") and
                Path(os.environ["GEN_EVALUATION_SPEC"]).resolve() == Path(args.evaluation_spec).resolve() and
                os.environ.get("GEN_EVALUATION_MODEL") == args.model_key, "evaluation_spec_environment", "CLI/env differ")
        from gen.evaluation_spec import validate_spec
        spec_before = sha256_file(args.evaluation_spec)
        spec = validate_spec(json.loads(Path(args.evaluation_spec).read_text(encoding="utf-8")))
        adapter_relative, extras = "gen/spec_adapter.py", ("gen/spec_adapter.py", "gen/evaluation_spec.py")
    else:
        require(args.model_key is None, "evaluation_spec_required", "model-key")
    paths = {"checkpoint": args.checkpoint, "vq": args.vq, "vq_config": args.vq_config, "tokens": args.tokens,
             "meta": str(Path(args.data) / "meta.jsonl"), "split": args.split}
    frozen = None
    if args.run:
        manifest_path = out / "manifest.json"
        prepared = json.loads((out / "prepare_status.json").read_text(encoding="utf-8"))
        require(prepared.get("phase") == "prepared" and
                prepared.get("manifest_sha256") == sha256_file(manifest_path),
                "manifest_changed", "prepare completion marker")
        frozen = json.loads(manifest_path.read_text(encoding="utf-8"))
        if args.evaluation_spec:
            require(frozen.get("evaluation_spec_sha256") == sha256_file(args.evaluation_spec), "manifest_changed", "evaluation spec")
        preflight_frozen(frozen, paths, args.inference_code_root, args.device, adapter_relative=adapter_relative, extra_files=extras)
    source_path = Path(args.inference_code_root) / adapter_relative
    source_before = dependency_hashes(args.inference_code_root, sha256_file(source_path), adapter_relative=adapter_relative, extra_files=extras)
    bundle_before = bundle_hashes()
    adapter, adapter_hash, loaded_factory_path = _adapter(args.adapter, args.checkpoint, args.vq, args.device)
    require(loaded_factory_path == source_path.resolve(strict=True), "adapter_source",
            "loaded factory path differs from inference code root")
    for field in ("model", "decoder_model", "checkpoint", "decoder_info", "generate", "decode"):
        require(hasattr(adapter, field), "adapter_field", field)
    for component in (adapter.model, adapter.decoder_model):
        component.eval()
    selection = select_data(args.tokens, paths["meta"], args.split, kind="WORD", mode="formal")
    manifest = make_manifest(selection, adapter.checkpoint, paths, device=args.device,
                             decoder_info=adapter.decoder_info, adapter_sha256=adapter_hash,
                             expected_counts=EXPECTED_COUNTS, evaluation_spec=spec, model_key=args.model_key)
    if args.evaluation_spec:
        require(sha256_file(args.evaluation_spec) == spec_before, "input_changed_during_load", "evaluation spec")
        manifest["evaluation_spec_sha256"] = spec_before
    manifest["inference_code_sha256"] = dependency_hashes(args.inference_code_root, adapter_hash, adapter_relative=adapter_relative, extra_files=extras)
    manifest["bundle_sha256"] = bundle_hashes()
    require(manifest["inference_code_sha256"] == source_before and manifest["bundle_sha256"] == bundle_before,
            "input_changed_during_load", "B code or bundle configuration")
    manifest["reference_sha256"] = reference_hashes(manifest, args.data)
    manifest["workload_estimate"] = workload_estimate(manifest, args.data, paths)
    if args.prepare:
        require(not out.exists() or not any(out.iterdir()), "output_not_empty", str(out))
        write_json_atomic(out / "manifest.json", manifest)
        write_json_atomic(out / "prepare_status.json", {"schema_version": 1, "phase": "prepared",
                         "manifest_sha256": sha256_file(out / "manifest.json"),
                         "expected_generations": manifest["workload_estimate"]["expected_generations"],
                         "reference_count": manifest["workload_estimate"]["reference_count"]})
        print(json.dumps({"manifest": str(out / "manifest.json"), "words": len(manifest["selected"]),
                          "references": sum(len(x["references"]) for x in manifest["selected"])}, ensure_ascii=False))
        return
    require(frozen == manifest, "manifest_changed", "selection/config/input hash differs")
    require(not any((out / name).exists() for name in ("per_sample.json", "summary.json", "reference_reconstruction.json",
                                                  "run_status.json", "numeric_summary.json", "progress.jsonl")),
            "output_exists", str(out))
    runtime = {"python": sys.version, "device": args.device}
    for name in ("numpy", "torch"):
        module = sys.modules.get(name)
        runtime[name] = getattr(module, "__version__", None)
    def progress(event):
        with (out / "progress.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    try:
        rows, recon, summary = evaluate_frozen(frozen, selection, args.data, generate=adapter.generate,
                                               decode=adapter.decode, device=args.device, runtime=runtime,
                                               progress=progress)
    except Exception as exc:
        write_json_atomic(out / "failure.json", {"code": getattr(exc, "code", type(exc).__name__), "detail": str(exc)[:300]})
        raise
    write_json_atomic(out / "per_sample.json", rows)
    write_json_atomic(out / "reference_reconstruction.json", recon)
    write_json_atomic(out / "summary.json", summary)
    phase = "complete" if (summary["expected_generations"] == summary["attempted"] == 90 and
                           summary["successes"] == 90 and summary["failures"] == 0 and
                           summary["complete_word_count"] == 30) else "partial"
    write_json_atomic(out / "run_status.json", {"schema_version": 1, "phase": phase,
                      "expected_generations": 90, "attempted": summary["attempted"],
                      "successes": summary["successes"], "failures": summary["failures"],
                      "complete_word_count": summary["complete_word_count"],
                      "summary_sha256": sha256_file(out / "summary.json")})
    print(json.dumps({"summary": str(out / "summary.json"), "successes": summary["successes"],
                      "failures": summary["failures"]}, ensure_ascii=False))
    if phase == "partial":
        raise SystemExit(3)


if __name__ == "__main__":
    main()
