"""Formal B-generator adapter for explicitly registered parent/warm-start models.

The original B evaluation_adapter remains unchanged and best2280-only. This
entrypoint requires GEN_EVALUATION_SPEC and GEN_EVALUATION_MODEL as well as the
usual GEN_EVALUATION_BUNDLE. No smoke fallback or arbitrary-checkpoint loading.
"""
import json
import os
from pathlib import Path

from gen.artifacts import sha256_file
from gen import evaluation_spec as S
from gen.evaluation_adapter import (_read_json, _bundle_file, _require_sampling,
                                     _load_generator, EvaluationAdapter, SAMPLING)


def factory(checkpoint_path, vq_path, device):
    spec_path = Path(os.environ["GEN_EVALUATION_SPEC"]).resolve(strict=True)
    spec_hash = sha256_file(spec_path)
    spec = S.validate_spec(json.loads(spec_path.read_text(encoding="utf-8")))
    key = os.environ["GEN_EVALUATION_MODEL"]
    S.check(key in spec["models"], "unregistered model")
    entry = spec["models"][key]
    checkpoint, vq = Path(checkpoint_path).resolve(strict=True), Path(vq_path).resolve(strict=True)
    S.check(checkpoint == Path(entry["path"]).resolve() and sha256_file(checkpoint) == entry["sha256"], "model path/hash")
    S.check(checkpoint.name.lower() != "latest.pt", "recovery checkpoint forbidden")
    S.check(sha256_file(vq) == S.E5_SHA256 and sha256_file(vq.parent/"config.json") == S.E5_CONFIG_SHA256, "fixed E5 hashes")
    bundle = Path(os.environ["GEN_EVALUATION_BUNDLE"]).resolve(strict=True)
    config_path = bundle/"generator.json"
    config_hash = sha256_file(config_path)
    config = _read_json(config_path)
    S.check(config.get("schema_version") == 1 and config.get("kind") == "word_gpt" and
            config.get("data_mode", "formal") == "formal", "formal WORD GPT bundle required")
    _require_sampling(config.get("sampling"))
    S.check(config.get("expected_generation_signer") == "REAL01" and config.get("blend") == 0 and
            config.get("max_words") == 1 and config.get("vq_version") == "v0.3-e5", "fixed generation policy")
    S.check(_bundle_file(bundle, config.get("generator_checkpoint"), "generator_checkpoint") == checkpoint and
            _bundle_file(bundle, config.get("vq_checkpoint"), "vq_checkpoint") == vq and
            config.get("generator_sha256") == entry["sha256"], "bundle model registration")
    generator = _load_generator(bundle, device)
    core = generator._adapter
    S.check_model(spec, key, core.checkpoint, checkpoint)
    S.check(core.decoder_config == _read_json(vq.parent/"config.json"), "loaded E5/sidecar config differs")
    info = {"nb_code": core.decoder.quantizer.nb_code, "down": core.decoder.down, "parts": core.decoder.parts}
    S.check(info == {"nb_code": 512, "down": 4, "parts": "body_hand"} and
            core.manifest["vq_sha256"] == S.E5_SHA256 and core.manifest["vq_version"] == "v0.3-e5",
            "fixed E5 provenance/dimensions")
    S.check(all(generator.connection_policy.get(k) == v for k, v in SAMPLING.items()) and
            generator.connection_policy.get("max_len") == 54 and
            generator.connection_policy.get("checkpoint_generation_signer") == "REAL01", "loaded generation policy")
    S.check(sha256_file(spec_path) == spec_hash and sha256_file(config_path) == config_hash and
            sha256_file(checkpoint) == entry["sha256"] and sha256_file(vq) == S.E5_SHA256,
            "inputs changed during load")
    return EvaluationAdapter(generator, info)
