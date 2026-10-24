"""Read-only E5 receipt checks; all received paths are explicit.

From ml: python -m gen.verify_bundle --tokens PATH --model PATH --config PATH
    --full PATH --full-sen PATH --full-all PATH --word-meta PATH
    --sen-meta PATH --sentences PATH

Omitted/missing files are reported separately. This is a receipt/format/decoder
smoke check, NOT vq.audit_handoff's metadata join and 36-clip re-encoding audit.
No downloads, transfers, original-file writes, or quality evaluation are done.
"""
import argparse
import hashlib
import json
from pathlib import Path

from gen.vocab import read_json


KNOWN_SHA256 = {
    "tokens": "0ace9fd00ed814aa2bfaf2de4930081a95c73324fe7462d697f1504e5c7d0639",
    "model": "939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38",
    "config": "d652055f41f973fb56fed84d84e009c8f747cc58f9ac1f7ccdb29467117ec574",
    "full": "7fbabab8daa8621dc602790ca0591c355ba629eb01271d3b44f1c8251632869f",
    "full_sen": "40fc852d470f26127a4416e29535999aca188c6132c867785da4302b8fa8d9a3",
    "full_all": "6cfc5d3601c3cd6a0a1d26d382839d1e7be55e7a9f726c823cecf4c52f5849c0",
    "word_meta": "a3cf1e2b974ca8e940f2f6eb3f8f90cf5d0fe3f814d9f267eb5e85fc7a72bb24",
    "sen_meta": "b65bb8d16d4685f1423bb822c54964733532a4cce289fc97d3c6810d929d1240",
    "sentences": "0909250841dc3ba930ff511049e9e87d7f53716c69af168ab0f15ee43807cb9a",
}
KNOWN_BYTES = {"tokens": 19997667, "model": 16526148}
REFERENCE = "docs/handoff/jaehun-to-jiheon-e5.md (2026-10-18, v0.3-e5)"


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def decoder_smoke(model_path, config):
    """Only called after model and config match the documented receipt hashes."""
    import torch
    from vq.model import load_vqvae

    model, checkpoint_config = load_vqvae(str(model_path))
    if checkpoint_config != config:
        raise ValueError("checkpoint_config_mismatch")
    if model.down != 4 or model.parts != "body_hand" or model.quantizer.nb_code != 512:
        raise ValueError("decoder_dimensions_mismatch")
    with torch.inference_mode():
        motion = model.decode(torch.tensor([[0, 1, 2]], dtype=torch.long))
    if tuple(motion.shape) != (1, 12, 375):
        raise ValueError("decoder_shape_mismatch")
    if motion.dtype != torch.float32 or not bool(torch.isfinite(motion).all()):
        raise ValueError("decoder_values_invalid")
    return {"status": "passed", "shape": [1, 12, 375], "dtype": "float32",
            "scope": "format only; facial expression and sign quality not evaluated"}


def _check_tokens(tokens):
    if tokens.get("vq_version") != "v0.3-e5":
        raise ValueError("version_mismatch")
    if type(tokens.get("nb_code")) is not int or tokens["nb_code"] != 512:
        raise ValueError("nb_code_mismatch")
    if type(tokens.get("down")) is not int or tokens["down"] != 4:
        raise ValueError("down_mismatch")
    clips = tokens.get("clips")
    if not isinstance(clips, dict) or not clips:
        raise ValueError("empty_or_invalid_clips")
    for clip, entry in clips.items():
        if not isinstance(entry, dict):
            raise ValueError("invalid_clip_entry")
        if entry.get("type") not in ("WORD", "SEN"):
            raise ValueError("invalid_clip_type")
        if not all(isinstance(entry.get(k), str) and entry[k] for k in ("item", "signer")):
            raise ValueError("invalid_clip_identity")
        if clip != f"{entry['item']}_{entry['signer']}":
            raise ValueError("clip_identity_mismatch")
        ids, frames = entry.get("tokens"), entry.get("frames")
        if not isinstance(ids, list) or not ids or any(type(t) is not int or not 0 <= t < 512 for t in ids):
            raise ValueError("token_range_invalid")
        if (not isinstance(frames, list) or len(frames) != 2 or any(type(t) is not int for t in frames)
                or not 0 <= frames[0] < frames[1] or frames[1] - frames[0] != len(ids) * 4):
            raise ValueError("token_frame_shape_invalid")
    return {"clips": len(clips), "nb_code": 512, "down": 4, "version": "v0.3-e5"}


def verify_bundle(paths):
    """Return an aggregate report without echoing tokens, coordinates, or paths.

    passed means all nine receipt hashes and decoder smoke passed, never that
    the separate full audit, coordinate receipt, or team version approval passed.
    """
    report = {"reference": REFERENCE, "files": {}, "checks": {}, "errors": [],
              "decoder": {"status": "not_run"}, "full_audit": {"status": "not_run"},
              "coordinates": "not_checked", "passed": False}
    existing = {}
    for name, expected in KNOWN_SHA256.items():
        supplied = paths.get(name)
        if supplied is None:
            report["files"][name] = {"status": "not_supplied"}
            continue
        path = Path(supplied)
        try:
            if not path.is_file():
                report["files"][name] = {"status": "missing"}
                report["errors"].append({"file": name, "code": "missing"})
                continue
            actual, size = digest(path), path.stat().st_size
            existing[name] = (path, actual)
            match = actual == expected
            result = {"status": "matched" if match else "hash_mismatch", "sha256": actual,
                      "expected_sha256": expected, "bytes": size}
            if name in KNOWN_BYTES:
                result["expected_bytes"] = KNOWN_BYTES[name]
                result["size_matches"] = size == KNOWN_BYTES[name]
                if not result["size_matches"]:
                    report["errors"].append({"file": name, "code": "size_mismatch"})
            report["files"][name] = result
            if not match:
                report["errors"].append({"file": name, "code": "hash_mismatch"})
        except OSError:
            report["files"][name] = {"status": "unreadable"}
            report["errors"].append({"file": name, "code": "unreadable"})
    parsed = {}
    for name in ("tokens", "config"):
        if name not in existing:
            continue
        try:
            value = read_json(existing[name][0])
            if not isinstance(value, dict):
                raise ValueError("invalid_json_object")
            if name == "tokens":
                details = _check_tokens(value)
            else:
                if type(value.get("nb_code")) is not int or value["nb_code"] != 512:
                    raise ValueError("nb_code_mismatch")
                if value.get("parts") != "body_hand":
                    raise ValueError("parts_mismatch")
                # load_vqvae uses two downsampling stages; checkpoint decode is
                # authoritative. Reject an explicitly conflicting config too.
                if "down_t" in value and (type(value["down_t"]) is not int or value["down_t"] != 2):
                    raise ValueError("down_mismatch")
                details = {"nb_code": 512, "parts": "body_hand"}
            parsed[name] = value
            report["checks"][name] = {"status": "passed", **details}
        except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
            code = str(error) if type(error) is ValueError else "invalid_format"
            if code not in {"version_mismatch", "nb_code_mismatch", "down_mismatch", "parts_mismatch",
                            "empty_or_invalid_clips", "invalid_clip_entry", "invalid_clip_type",
                            "invalid_clip_identity", "clip_identity_mismatch", "token_range_invalid",
                            "token_frame_shape_invalid", "invalid_json_object"}:
                code = "invalid_format"
            report["checks"][name] = {"status": "failed", "code": code}
            report["errors"].append({"file": name, "code": code})
    if ("config" in parsed and all(report["files"][name]["status"] == "matched"
                                   for name in ("model", "config"))):
        try:
            report["decoder"] = decoder_smoke(existing["model"][0], parsed["config"])
        except ImportError:
            report["decoder"] = {"status": "unavailable", "code": "torch_dependency_required"}
        except Exception:
            # Checkpoint errors can embed local paths; keep user-facing output aggregate.
            report["decoder"] = {"status": "failed", "code": "decoder_smoke_failed"}
            report["errors"].append({"file": "model", "code": "decoder_smoke_failed"})
    for name, (path, before) in existing.items():
        try:
            if digest(path) != before:
                report["errors"].append({"file": name, "code": "changed_during_check"})
        except OSError:
            report["errors"].append({"file": name, "code": "unreadable_after_check"})
    complete = all(info["status"] == "matched" for info in report["files"].values())
    report["passed"] = complete and not report["errors"] and report["decoder"]["status"] == "passed"
    report["status"] = "failed" if report["errors"] else ("receipt_checks_passed" if report["passed"] else "pending")
    report["full_audit"]["requirements"] = ["all nine files", "WORD and SEN npy coordinates",
                                                "matching source and Python dependencies"]
    report["full_audit"]["command_template"] = (
        "python -m vq.audit_handoff --tokens <tokens_e5.json> --model <E5/model.pt> "
        "--word <WORD_DATA_DIR> --sen <SEN_DATA_DIR>")
    report["full_audit"]["notes"] = (
        "Run from ml without -O; config.json must be beside model.pt; "
        "the audit reads this repository's full/full_sen/full_all splits. "
        "It re-encodes 36 reference clips, not all 80000 clips.")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in KNOWN_SHA256:
        parser.add_argument("--" + name.replace("_", "-"))
    args = parser.parse_args()
    report = verify_bundle(vars(args))
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 1 if report["errors"] else (0 if report["passed"] else 2)


if __name__ == "__main__":
    raise SystemExit(main())
