"""Tiny CPU artifacts made here with A's public APIs; no gen.tests imports.

Training outputs and deployment bundles are deliberately separate directories.
All checkpoints/data are disposable and explicitly smoke, never real sign motion.
"""
import base64
import json
from pathlib import Path
import random

import numpy as np
import torch

from gen.artifacts import sha256_file
from gen.data import select_data
from gen.train_word import load_generator
from gen.training import TrainingConfig, train
from vq.model import MotionVQVAE

from ml.serve.tests.baseline_fixture import make_baseline_bundle, write_json, WORDS


KINDS = ("word_gpt", "word_regress")
VERSION, NB_CODE, DOWN = "service-synthetic-v1", 8, 4
MAX_LEN, REGRESS_LENGTH = 3, 6
FAILURES = ("checkpoint", "hash", "version", "recovery", "schema", "vq_hash", "actual_vq_version")


def read_config(bundle):
    return json.loads((Path(bundle) / "generator.json").read_text(encoding="utf-8"))


def make_model_bundles(root: Path) -> dict[str, Path]:
    root = Path(root)
    python_rng, numpy_rng = random.getstate(), np.random.get_state()
    deterministic = torch.are_deterministic_algorithms_enabled()
    benchmark = torch.backends.cudnn.benchmark
    cudnn_deterministic = torch.backends.cudnn.deterministic
    try:
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(71)
            return _make_bundles(root)
    finally:
        random.setstate(python_rng)
        np.random.set_state(numpy_rng)
        torch.use_deterministic_algorithms(deterministic)
        torch.backends.cudnn.benchmark = benchmark
        torch.backends.cudnn.deterministic = cudnn_deterministic


def _make_bundles(root):
    make_baseline_bundle(root / "inputs")
    data = root / "inputs/data"
    metas = [json.loads(line) for line in (data / "meta.jsonl").read_text(encoding="utf-8").splitlines()]
    tokens = root / "tokens.json"
    write_json(tokens, {"nb_code": NB_CODE, "down": DOWN, "vq_version": VERSION, "clips": {
        meta["clip"]: {key: meta[key] for key in ("item", "signer", "type")} |
        {"frames": [2, 14], "tokens": [0, 1, 7]} for meta in metas}})
    vq_path = root / "vq/model.pt"
    vq_path.parent.mkdir()
    decoder = MotionVQVAE(width=8, code_dim=4, nb_code=NB_CODE, depth=1, parts="body_hand")
    with torch.no_grad():
        decoder.quantizer.codebook.normal_()
        decoder.rest[165:] = 0.25
    torch.save({"config": {"width": 8, "code_dim": 4, "nb_code": NB_CODE, "depth": 1,
                           "parts": "body_hand", "vq_version": VERSION},
                "model": decoder.state_dict()}, vq_path)
    selection = select_data(tokens, data / "meta.jsonl", root / "inputs/split.json", mode="smoke")
    bundles = {}
    for kind in KINDS:
        training_run = root / "training" / kind
        train(selection, training_run, kind=kind.removeprefix("word_"),
              config=TrainingConfig(iters=4, batch=2, d=8, layers=1, length=REGRESS_LENGTH,
                                    max_len=MAX_LEN, device="cpu", seed=17, eval_every=2, save_every=2),
              data_dir=data, vq_path=vq_path, vq_version=VERSION)
        bundle = root / "bundles" / kind
        bundle.mkdir(parents=True)
        write_json(bundle / "vocab_map.json", {"schema_version": 1,
                   "mapping": {word: item for word, (item, _) in WORDS.items()},
                   "unmapped": ["미등록"], "ambiguous": {}})
        write_json(bundle / "generator.json", {"schema_version": 1, "kind": kind,
                   "data_mode": "smoke", "vocab_map": "vocab_map.json",
                   "generator_checkpoint": f"../../training/{kind}/model.pt",
                   "generator_sha256": sha256_file(training_run / "model.pt"),
                   "vq_checkpoint": "../../vq/model.pt", "vq_version": VERSION, "blend": 0,
                   "sampling": {"top_k": 0, "temperature": 1.0, "min_len": MAX_LEN}})
        bundles[kind] = bundle
    return bundles


def regression_oracle(bundle) -> dict[str, str]:
    """Independent A forward passes, bypassing B/HTTP only for the test oracle."""
    bundle = Path(bundle)
    config = read_config(bundle)
    model, checkpoint = load_generator(bundle / config["generator_checkpoint"], device="cpu")
    oracle = {}
    with torch.inference_mode():
        for word, (item, _) in WORDS.items():
            cond = torch.tensor([checkpoint["classes"][item]], dtype=torch.long)
            signer = torch.tensor([checkpoint["signers"][checkpoint["generation_signer"]]], dtype=torch.long)
            motion = model(cond, signer)[0].numpy().astype("<f4")
            oracle[word] = base64.b64encode(motion.tobytes(order="C")).decode("ascii")
    return oracle


def variant_bundle(root: Path, original: Path, failure: str) -> Path:
    """Faults affect only disposable files. Production validation stays enabled."""
    root.mkdir(parents=True)
    config = read_config(original)
    for key in ("vocab_map", "generator_checkpoint", "vq_checkpoint"):
        config[key] = str((original / config[key]).resolve())
    checkpoint_path = Path(config["generator_checkpoint"])
    if failure == "checkpoint":
        checkpoint_path = root / "invalid.pt"
        checkpoint_path.write_bytes(b"synthetic invalid checkpoint")
        config["generator_checkpoint"] = str(checkpoint_path)
        config["generator_sha256"] = sha256_file(checkpoint_path)
    elif failure == "hash":
        config["generator_sha256"] = "0" * 64
    elif failure == "version":
        config["vq_version"] = "synthetic-wrong-version"
    elif failure == "recovery":
        config["generator_checkpoint"] = str(checkpoint_path.with_name("latest.pt"))
        config["generator_sha256"] = sha256_file(config["generator_checkpoint"])
    elif failure in ("schema", "vq_hash", "actual_vq_version"):
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        if failure == "schema":
            checkpoint["checkpoint_schema_version"] = 99
        elif failure == "vq_hash":
            checkpoint["artifact_manifest"]["vq_sha256"] = "0" * 64
        else:
            vq = torch.load(config["vq_checkpoint"], map_location="cpu", weights_only=True)
            vq["config"]["vq_version"] = "synthetic-wrong-actual-version"
            vq_path = root / "vq.pt"
            torch.save(vq, vq_path)
            config["vq_checkpoint"] = str(vq_path)
            checkpoint["artifact_manifest"]["vq_sha256"] = sha256_file(vq_path)
        changed = root / "model.pt"
        torch.save(checkpoint, changed)
        config["generator_checkpoint"] = str(changed)
        config["generator_sha256"] = sha256_file(changed)
    elif failure == "frame_limit":
        config["max_frames"] = MAX_LEN * DOWN if config["kind"] == "word_gpt" else REGRESS_LENGTH
    else:
        raise ValueError("Unknown synthetic fault")
    write_json(root / "generator.json", config)
    return root
