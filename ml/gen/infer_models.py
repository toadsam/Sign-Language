"""Word-only model adapter; imported lazily by gen.infer.Generator.

Both kinds require generator_checkpoint, generator_sha256, vocab_map,
vq_checkpoint and vq_version in generator.json. The decoder identifies training
provenance for both kinds, but only word_gpt calls decode. data_mode defaults to
formal; synthetic checkpoints require explicit data_mode="smoke". A recovery or
legacy file without an artifact_manifest is never an inference bundle.

Models decode each known word separately, in request order, and concatenate the
motion (optional blend transition frames, default 0). GPT tokens are the flat
lexical token stream, excluding END/PAD and blend frames. Decoding that flattened
stream in one pass need not reproduce the independently decoded word boundaries.
This is word concatenation, not a sentence model. Nonmanual is not conditioned.

max_words defaults to 128 and max_frames to 1800 (C defaults). A request must fit
the conservative per-word upper bound: GPT max_len*down or regression length,
plus blend frames. Sampling settings are top_k=10, temperature=1, min_len=2,
guidance=1, samples=1 and signer=checkpoint.generation_signer unless overridden
with a trained signer. guidance != 1 needs a null-condition GPT (cond_drop > 0).
samples > 1 generates that many sequences per word and returns the medoid: the
one with the smallest summed body+hands distance to the others after the same
active-span trim and 32-frame resample as gen.word_accuracy. No reference
motion is consulted.

All adapters share an RNG lock, compatible with C's serialized worker. Seeded
requests use isolated Torch states; unseeded requests advance private states
initialized from OS entropy. Caller CPU/CUDA RNG states are restored. This lock
does not synchronize unrelated third-party threads that use global Torch RNGs.
"""
import math
import re
import secrets
import threading

import numpy as np
import torch

from gen.artifacts import sha256_file, validate_artifact_manifest
from gen.train_word import load_generator
from gen.training import resolve_device
from gen.verify_bundle import KNOWN_SHA256
from gen.word_accuracy import prepare
from gen.word_test_eval import medoid
from vq.model import load_vqvae


_RNG_LOCK = threading.RLock()
MAX_SAMPLES = 32
BODY_HANDS = slice(0, 55)


def _positive_integer(value, name):
    if type(value) is not int or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _dictionary(value, name):
    if (not isinstance(value, dict) or not value
            or any(not isinstance(k, str) or not k.strip() or type(v) is not int for k, v in value.items())
            or set(value.values()) != set(range(len(value)))):
        raise ValueError(f"invalid checkpoint {name} dictionary")
    return value


def _check_device(model, device):
    if any(t.device != device for t in (*model.parameters(), *model.buffers())):
        raise ValueError("model/decoder device mismatch")


class WordModelAdapter:
    def __init__(self, config, path, mapping, device, blend):
        self.kind, self.mapping, self.blend = config["kind"], dict(mapping), blend
        self.data_mode = config.get("data_mode", "formal")
        if self.data_mode not in ("formal", "smoke"):
            raise ValueError("data_mode must be formal or explicit smoke")
        self.device = resolve_device(device)
        if self.device.type == "cuda":
            self.device = torch.device("cuda", torch.cuda.current_device())
        self._cuda_devices = [self.device.index] if self.device.type == "cuda" else []
        self.max_words = _positive_integer(config.get("max_words", 128), "max_words")
        self.max_frames = _positive_integer(config.get("max_frames", 1800), "max_frames")
        checkpoint_path, decoder_path = path("generator_checkpoint"), path("vq_checkpoint")
        if checkpoint_path.name.lower() == "latest.pt":
            raise ValueError("recovery latest.pt is not an inference checkpoint")
        expected_hash = config.get("generator_sha256")
        if not isinstance(expected_hash, str) or re.fullmatch(r"[0-9a-f]{64}", expected_hash) is None:
            raise ValueError("generator_sha256 is required")
        if sha256_file(checkpoint_path) != expected_hash:
            raise ValueError("generator checkpoint hash mismatch")
        declared_version = config.get("vq_version")
        if not isinstance(declared_version, str) or not declared_version.strip():
            raise ValueError("vq_version is required")

        # A constructors initialize weights before restoring state; isolate this
        # startup RNG consumption too. No model is loaded again during requests.
        with _RNG_LOCK, torch.random.fork_rng(devices=self._cuda_devices):
            self.model, checkpoint = load_generator(checkpoint_path, self.device.type)
            if (type(checkpoint.get("checkpoint_schema_version")) is not int
                    or checkpoint["checkpoint_schema_version"] != 1
                    or checkpoint.get("checkpoint_type") != "inference"):
                raise ValueError("schema 1 inference checkpoint required")
            if checkpoint.get("kind") != {"word_gpt": "gpt", "word_regress": "regress"}[self.kind]:
                raise ValueError("generator kind/checkpoint mismatch")
            self.classes = _dictionary(checkpoint.get("classes"), "classes")
            self.signers = _dictionary(checkpoint.get("signers"), "signers")
            if any(not word.startswith("WORD") for word in self.classes):
                raise ValueError("word checkpoint classes must be WORD IDs")
            if set(mapping.values()) - self.classes.keys():
                raise ValueError("vocab mapping references unsupported checkpoint classes")
            self.manifest = validate_artifact_manifest(checkpoint.get("artifact_manifest"),
                expected={"data_mode": self.data_mode, "nb_code": checkpoint["nb_code"],
                          "vq_version": declared_version}, allow_smoke=self.data_mode == "smoke")
            # Even regression must identify the decoder used by its training
            # selection, without interpreting regression output as VQ tokens.
            validate_artifact_manifest(self.manifest, files={"vq_sha256": decoder_path},
                                       allow_smoke=self.data_mode == "smoke")
            decoder_hash = sha256_file(decoder_path)
            if declared_version == "v0.3-e5" and decoder_hash != KNOWN_SHA256["model"]:
                raise ValueError("decoder does not match the documented E5 hash")
            decoder, decoder_config = load_vqvae(decoder_path)
            actual_version = decoder_config.get("vq_version")
            if actual_version is None and decoder_hash == KNOWN_SHA256["model"]:
                actual_version = "v0.3-e5"
            if actual_version is not None and actual_version != declared_version:
                raise ValueError("actual decoder version mismatch")
            if actual_version is None and self.data_mode == "formal":
                raise ValueError("formal decoder version cannot be verified")
            self.nb_code = _positive_integer(checkpoint["nb_code"], "nb_code")
            self.down = _positive_integer(decoder.down, "down")
            if decoder_config["nb_code"] != decoder.quantizer.nb_code:
                raise ValueError("actual decoder code count mismatch")
            validate_artifact_manifest(self.manifest,
                expected={"nb_code": decoder.quantizer.nb_code, "down": self.down, "parts": decoder.parts},
                allow_smoke=self.data_mode == "smoke")
            if "down_t" in decoder_config and (type(decoder_config["down_t"]) is not int
                                                  or 2 ** decoder_config["down_t"] != self.down):
                raise ValueError("decoder configuration down mismatch")
            self.decoder = decoder.to(self.device).eval()
            _check_device(self.model, self.device)
            _check_device(self.decoder, self.device)
            if sha256_file(checkpoint_path) != expected_hash or sha256_file(decoder_path) != decoder_hash:
                raise ValueError("model/decoder changed during load")

        sampling = config.get("sampling", {})
        if not isinstance(sampling, dict):
            raise ValueError("sampling must be an object")
        saved_signer = checkpoint.get("generation_signer")
        if not isinstance(saved_signer, str) or saved_signer not in self.signers:
            raise ValueError("checkpoint generation_signer is not trained")
        self.signer = sampling.get("signer", saved_signer)
        if not isinstance(self.signer, str) or self.signer not in self.signers:
            raise ValueError("sampling signer is not trained")
        self.top_k, self.temperature = sampling.get("top_k", 10), sampling.get("temperature", 1.0)
        if type(self.top_k) is not int or self.top_k < 0:
            raise ValueError("top_k must be a nonnegative integer")
        if (type(self.temperature) not in (int, float) or not math.isfinite(self.temperature)
                or self.temperature <= 0):
            raise ValueError("temperature must be finite and positive")
        self.max_len = _positive_integer(checkpoint["max_len"], "max_len")
        self.min_len = _positive_integer(sampling.get("min_len", 2), "min_len")
        if self.min_len > self.max_len:
            raise ValueError("min_len exceeds checkpoint max_len")
        self.guidance = sampling.get("guidance", 1.0)
        if (type(self.guidance) not in (int, float) or not math.isfinite(self.guidance)
                or self.guidance <= 0):
            raise ValueError("guidance must be finite and positive")
        if self.guidance != 1 and getattr(self.model, "null", None) is None:
            raise ValueError("guidance requires a null-condition GPT checkpoint")
        self.samples = _positive_integer(sampling.get("samples", 1), "samples")
        if self.samples > MAX_SAMPLES or (self.samples > 1 and self.kind != "word_gpt"):
            raise ValueError(f"samples must be 1..{MAX_SAMPLES} and GPT only")
        if self.kind == "word_gpt":
            if self.model.nb_code != self.nb_code or self.model.max_len != self.max_len:
                raise ValueError("GPT model metadata mismatch")
            self.frames_per_word = self.max_len * self.down
        else:
            self.frames_per_word = _positive_integer(checkpoint["config"]["length"], "regression length")
            if self.model.length != self.frames_per_word:
                raise ValueError("regression model length mismatch")
        if self.frames_per_word > self.max_frames:
            raise ValueError("one word exceeds max_frames")
        self.connection_policy = {"kind": self.kind, "data_mode": self.data_mode,
            "decode": "per_word" if self.kind == "word_gpt" else "direct_coordinates",
            "blend": blend, "max_words": self.max_words, "max_frames": self.max_frames,
            "frames_per_word_upper_bound": self.frames_per_word, "signer": self.signer,
            "top_k": self.top_k, "temperature": self.temperature, "min_len": self.min_len,
            "guidance": self.guidance, "samples": self.samples,
            "pick": "medoid_body_hands55" if self.samples > 1 else "single",
            "sentence_model": False, "nonmanual_supported": False}
        entropy = secrets.randbits(63)
        self._cpu_rng = torch.Generator(device="cpu").manual_seed(entropy).get_state()
        self._device_rng = (torch.Generator(device=self.device).manual_seed(entropy).get_state()
                            if self._cuda_devices else None)

    def _motion(self, value, frames):
        if not isinstance(value, torch.Tensor) or value.device != self.device:
            raise ValueError("motion output device mismatch")
        if tuple(value.shape) != (1, frames, 375) or value.dtype != torch.float32:
            raise ValueError("model/decoder output shape or dtype mismatch")
        if not bool(torch.isfinite(value).all()):
            raise ValueError("nonfinite model/decoder output")
        return value[0].cpu().numpy().copy().reshape(frames, 125, 3)

    def _word(self, item):
        condition = torch.tensor([self.classes[item]], dtype=torch.long, device=self.device)
        signer = torch.tensor([self.signers[self.signer]], dtype=torch.long, device=self.device)
        if self.kind == "word_regress":
            return self._motion(self.model(condition, signer), self.frames_per_word), []
        sequences = self.model.generate(condition.repeat(self.samples), signer.repeat(self.samples),
                                        top_k=self.top_k, temperature=self.temperature,
                                        min_len=self.min_len, guidance=self.guidance)
        if not isinstance(sequences, list) or len(sequences) != self.samples:
            raise ValueError("GPT output must contain one token sequence per sample")
        motions = []
        for tokens in sequences:
            if (not isinstance(tokens, list) or not self.min_len <= len(tokens) <= self.max_len
                    or any(type(t) is not int or not 0 <= t < self.nb_code for t in tokens)):
                raise ValueError("invalid generated token range or length")
            indices = torch.tensor([tokens], dtype=torch.long, device=self.device)
            motions.append(self._motion(self.decoder.decode(indices), len(tokens) * self.down))
        # Several samples: keep the one closest to the others (never sees a reference motion).
        pick = 0 if self.samples == 1 else medoid([prepare(m.reshape(len(m), 375)) for m in motions], BODY_HANDS)
        return motions[pick], sequences[pick]

    def generate(self, gloss, seed):
        if len(gloss) > self.max_words:
            raise ValueError("input exceeds max_words")
        if seed is not None and not 0 <= seed < 2**63:
            raise ValueError("model seed must be in [0, 2**63)")
        items, unknown = [], []
        for word in gloss:
            if word in self.mapping:
                items.append(self.mapping[word])
            else:
                unknown.append(word)
        bound = len(items) * self.frames_per_word + max(0, len(items) - 1) * self.blend
        if bound > self.max_frames:
            raise ValueError("request output upper bound exceeds max_frames")
        if not items:
            return {"fps": 30, "motion": np.empty((0, 125, 3), dtype=np.float32),
                    "tokens": [], "unknown": unknown, "source": "model"}
        segments, tokens = [], []
        with _RNG_LOCK, torch.random.fork_rng(devices=self._cuda_devices), torch.inference_mode():
            _check_device(self.model, self.device)
            _check_device(self.decoder, self.device)
            self.model.eval()
            self.decoder.eval()
            cpu_state = (self._cpu_rng if seed is None else
                         torch.Generator(device="cpu").manual_seed(seed).get_state())
            torch.set_rng_state(cpu_state)
            if self._cuda_devices:
                state = (self._device_rng if seed is None else
                         torch.Generator(device=self.device).manual_seed(seed).get_state())
                torch.cuda.set_rng_state(state, self.device)
            for item in items:
                motion, codes = self._word(item)
                if segments and self.blend:
                    weights = np.linspace(0, 1, self.blend + 2)[1:-1, None, None]
                    segments.append((segments[-1][-1] * (1 - weights) + motion[0] * weights).astype(np.float32))
                segments.append(motion)
                tokens.extend(codes)
            if seed is None:
                self._cpu_rng = torch.get_rng_state()
                if self._cuda_devices:
                    self._device_rng = torch.cuda.get_rng_state(self.device)
        motion = np.concatenate(segments, axis=0)
        if len(motion) > self.max_frames or not np.isfinite(motion).all():
            raise ValueError("invalid combined model motion")
        return {"fps": 30, "motion": motion, "tokens": tokens, "unknown": unknown, "source": "model"}
