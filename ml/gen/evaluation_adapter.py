"""Connect B's word generator to A's ``gen.evaluate`` factory contract.

Set GEN_EVALUATION_BUNDLE to a separate, immutable bundle directory containing
generator.json and vocab_map.json. The checkpoint and E5 paths passed by A's
CLI must resolve to the exact files named by that bundle. No training-run files
are created or modified here.
"""
import json
import os
from pathlib import Path

from gen.artifacts import sha256_file


BUNDLE_ENV = "GEN_EVALUATION_BUNDLE"
SAMPLING = {"top_k": 10, "temperature": 1.0, "min_len": 2, "signer": "REAL01"}
BEST_SHA256 = "3308e6aa3c0a4be46b94961fa6d139833b5e879a15134d133095a0d9cee21bbb"


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate bundle JSON key: {key}")
        result[key] = value
    return result


def _read_json(path):
    with path.open(encoding="utf-8-sig") as stream:
        return json.load(stream, object_pairs_hook=_unique_object)


def _bundle_file(bundle, value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"bundle {field} is required")
    return (bundle / value).resolve(strict=True)


def _require_sampling(sampling, *, from_manifest=False):
    if not isinstance(sampling, dict) or any(sampling.get(k) != v for k, v in SAMPLING.items()):
        raise ValueError("evaluation sampling mismatch")
    expected_keys = set(SAMPLING)
    if from_manifest:
        expected_keys |= {"seeds", "fps"}
        if sampling.get("seeds") != [17, 18, 19] or sampling.get("fps") != 30:
            raise ValueError("evaluation seeds or fps mismatch")
    if set(sampling) != expected_keys:
        raise ValueError("evaluation sampling keys mismatch")


def _load_generator(bundle, device):
    # Keep this import lazy so factory validation tests need no Torch/NumPy.
    from gen.infer import Generator
    return Generator(bundle, device=device)


class EvaluationAdapter:
    """A's required fields plus callbacks for one WORD ID at a time."""

    def __init__(self, generator, decoder_info):
        self._generator = generator
        core = generator._adapter
        self.checkpoint = core.checkpoint
        self.decoder_info = decoder_info
        self.model = core.model
        self.decoder_model = core.decoder

    def generate(self, word, seed, sampling):
        _require_sampling(sampling, from_manifest=True)
        return self._generator.generate_word_id(word, seed)

    def decode(self, tokens):
        return self._generator.decode_reference_tokens(tokens)


def factory(checkpoint_path, vq_path, device):
    """A ``--adapter gen.evaluation_adapter:factory`` entry point."""
    bundle_name = os.environ.get(BUNDLE_ENV)
    if not bundle_name:
        raise ValueError(f"{BUNDLE_ENV} must name the separate bundle directory")
    bundle = Path(bundle_name).resolve(strict=True)
    if not bundle.is_dir():
        raise ValueError("evaluation bundle is not a directory")
    config_path = bundle / "generator.json"
    config_hash = sha256_file(config_path)
    config = _read_json(config_path)
    if not isinstance(config, dict) or config.get("schema_version") != 1 or config.get("kind") != "word_gpt":
        raise ValueError("evaluation requires a schema 1 word_gpt bundle")
    mode = config.get("data_mode", "formal")
    if mode not in ("formal", "smoke"):
        raise ValueError("invalid evaluation data_mode")
    _require_sampling(config.get("sampling"))
    if config.get("expected_generation_signer") != SAMPLING["signer"]:
        raise ValueError("bundle must require checkpoint generation_signer REAL01")
    if config.get("blend") != 0 or config.get("max_words") != 1:
        raise ValueError("evaluation requires blend=0 and max_words=1")
    checkpoint = Path(checkpoint_path).resolve(strict=True)
    vq = Path(vq_path).resolve(strict=True)
    if checkpoint.name.lower() == "latest.pt" or _bundle_file(bundle, config.get("generator_checkpoint"),
            "generator_checkpoint") != checkpoint:
        raise ValueError("evaluation checkpoint path differs from bundle")
    if _bundle_file(bundle, config.get("vq_checkpoint"), "vq_checkpoint") != vq:
        raise ValueError("evaluation E5 path differs from bundle")
    checkpoint_hash = sha256_file(checkpoint)
    vq_hash = sha256_file(vq)
    if checkpoint_hash != config.get("generator_sha256"):
        raise ValueError("evaluation checkpoint hash differs from bundle")
    if mode == "formal":
        from gen.verify_bundle import KNOWN_SHA256
        if checkpoint_hash != BEST_SHA256 or vq_hash != KNOWN_SHA256["model"]:
            raise ValueError("evaluation requires the documented best model and E5")
        if config.get("vq_version") != "v0.3-e5":
            raise ValueError("evaluation E5 version mismatch")
    sidecar = vq.parent / "config.json"
    sidecar_hash = sha256_file(sidecar)
    sidecar_config = _read_json(sidecar)
    if not isinstance(sidecar_config, dict):
        raise ValueError("E5 config.json must contain an object")
    if mode == "formal" and sidecar_hash != KNOWN_SHA256["config"]:
        raise ValueError("evaluation E5 config hash mismatch")

    generator = _load_generator(bundle, device)
    core = generator._adapter
    if generator.kind != "word_gpt" or core.checkpoint.get("generation_signer") != SAMPLING["signer"]:
        raise ValueError("loaded generator kind or signer mismatch")
    if core.decoder_config != sidecar_config:
        raise ValueError("E5 sidecar differs from loaded checkpoint config")
    actual_version = core.decoder_config.get("vq_version")
    if actual_version is None and mode == "formal":
        actual_version = "v0.3-e5"  # authenticated by the fixed E5 model hash above
    if actual_version != config.get("vq_version") or core.manifest.get("vq_sha256") != vq_hash:
        raise ValueError("loaded E5 version or provenance mismatch")
    info = {"nb_code": core.decoder.quantizer.nb_code, "down": core.decoder.down,
            "parts": core.decoder.parts}
    if (core.checkpoint.get("nb_code") != info["nb_code"] or core.manifest.get("down") != info["down"]
            or core.manifest.get("parts") != info["parts"]):
        raise ValueError("loaded checkpoint and E5 dimensions mismatch")
    policy = generator.connection_policy
    if any(policy.get(k) != v for k, v in SAMPLING.items()) or policy.get("checkpoint_generation_signer") != "REAL01":
        raise ValueError("loaded sampling differs from evaluation settings")
    if mode == "formal" and (policy.get("max_len"), info["nb_code"], info["down"], info["parts"]) != (
            54, 512, 4, "body_hand"):
        raise ValueError("loaded best model/E5 dimensions mismatch")
    if (sha256_file(config_path) != config_hash or sha256_file(checkpoint) != checkpoint_hash
            or sha256_file(vq) != vq_hash or sha256_file(sidecar) != sidecar_hash):
        raise ValueError("evaluation bundle inputs changed during load")
    return EvaluationAdapter(generator, info)
