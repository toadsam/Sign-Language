"""Shared word GPT / coordinate B2 / sentence training and exact resume.

``latest.pt`` is recovery state; ``model.pt`` is the best ordinary-validation
inference artifact. Train-only smoke runs explicitly label their last artifact
as unvalidated. ``stop_after`` pauses a run without changing its total schedule.
No test or sentence holdout data is used for model selection.

API: ``train(selection, new_run, kind="gpt"|"regress"|"sentence",
config=TrainingConfig(device="cpu", seed=17, iters=4), ...)``. Regress also
requires data_dir; formal runs require the real vq_path and vq_version. Resume
the same run with resume=True and the original total iters; stop_after controls
only an absolute interruption point. CLI entrypoints expose --resume,
--stop-after, --eval-every, --save-every and --generation-signer.

``load_trained_model(path, device="cpu")`` returns (eval model, inference
dictionary). Existing word keys remain present; sentence adds kind="sentence",
vocab and max_src. generation_signer always names a trained embedding. The
dictionary's artifact_manifest follows schema_version=1; B must compare that
manifest with its actual decoder, including SHA-256, dimensions and version.
Legacy word dictionaries remain loadable, but have no provenance guarantee.

Recovery schema 1 includes optimizer, scheduler, global_step, Python/NumPy/
Torch RNGs, best_validation, best_step, best_artifact, config, manifest and a
strict resume signature. The signature checks source/selection hashes, decoder,
model/config, schedule, implementation, Torch/device/CPU threads and (for B2)
coordinate file size/mtime inventory. Same-content files with forged identical
timestamps are beyond that inventory check; it is not a coordinate content hash.
"""
from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import random
import tempfile

import numpy as np
import torch
import torch.nn.functional as F

from gen.artifacts import (create_artifact_manifest, decoder_parts, prepare_run,
                           sha256_file, validate_artifact_manifest, write_json_atomic)
from gen.data import source_symbols
from gen.model import MotionGPT, MotionRegressor, SentenceToMotion


class TrainingError(ValueError):
    def __init__(self, code, field):
        self.code, self.field = code, field
        super().__init__(f"{code}: {field}")


@dataclass(frozen=True)
class TrainingConfig:
    iters: int = 3000
    batch: int = 32
    lr: float = 3e-4
    d: int = 256
    layers: int = 4
    corrupt: float = 0.3
    length: int = 64
    seed: int = 0
    device: str = "auto"
    eval_every: int = 100
    save_every: int = 100
    max_src: int = 64
    max_len: int | None = None
    deterministic: bool = True
    generation_signer: str | None = None

    def validate(self):
        for field in ("iters", "batch", "d", "layers", "eval_every", "save_every", "max_src"):
            if type(getattr(self, field)) is not int or getattr(self, field) <= 0:
                raise TrainingError("invalid_config", field)
        if self.d % 4 or type(self.length) is not int or self.length < 2:
            raise TrainingError("invalid_config", "d/length")
        if self.max_len is not None and (type(self.max_len) is not int or self.max_len < 2):
            raise TrainingError("invalid_config", "max_len")
        for field, low, high in (("lr", 0, math.inf), ("corrupt", 0, 1)):
            value = getattr(self, field)
            if (type(value) not in (int, float) or not math.isfinite(value)
                    or not low <= value <= high or (field == "lr" and value == 0)):
                raise TrainingError("invalid_config", field)
        if type(self.seed) is not int or not 0 <= self.seed < 2**32:
            raise TrainingError("invalid_config", "seed")
        if type(self.deterministic) is not bool:
            raise TrainingError("invalid_config", "deterministic")


def resolve_device(requested="auto"):
    if requested not in ("auto", "cpu", "cuda"):
        raise TrainingError("invalid_device", requested)
    available = torch.cuda.is_available()
    if requested == "cuda" and not available:
        raise TrainingError("cuda_unavailable", "device")
    return torch.device("cuda" if requested == "cuda" or (requested == "auto" and available) else "cpu")


def seed_run(seed, deterministic=True):
    if deterministic:
        os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(deterministic)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = deterministic


def atomic_torch_save(value, path):
    """Publish a complete checkpoint by same-directory atomic replacement."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            torch.save(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _cpu_state(model):
    return {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}


def capture_rng(rng):
    name, keys, position, has_gauss, cached = np.random.get_state()
    return {"python": random.getstate(), "numpy": [name, keys.tolist(), position, has_gauss, cached],
            "sampler": rng.bit_generator.state, "torch_cpu": torch.get_rng_state(),
            "torch_cuda": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else []}


def restore_rng(state, rng):
    random.setstate(state["python"])
    name, keys, position, has_gauss, cached = state["numpy"]
    np.random.set_state((name, np.asarray(keys, dtype=np.uint32), position, has_gauss, cached))
    rng.bit_generator.state = state["sampler"]
    torch.set_rng_state(state["torch_cpu"].cpu())
    if state["torch_cuda"]:
        torch.cuda.set_rng_state_all([s.cpu() for s in state["torch_cuda"]])


class MotionSegments:
    """No array cache: map one selected clip, copy only its interval, close it.

    File size/mtime inventory is included in the resume identity and checked on
    every access. Token/meta hashes establish dataset provenance; this inventory
    also detects ordinary changes to coordinate files without eagerly reading
    the entire coordinate dataset. It is not a content hash of those files.
    """

    def __init__(self, data_dir, rows, length):
        from recog.features import resample
        self.resample, self.length = resample, length
        self.root = Path(data_dir).resolve()
        self.inventory = {}
        for row in rows:
            path = self.root / "npy" / f"{row['clip']}.npy"
            stat = path.stat()
            self.inventory[row["clip"]] = [stat.st_size, stat.st_mtime_ns]

    def read(self, row):
        path = self.root / "npy" / f"{row['clip']}.npy"
        stat = path.stat()
        if [stat.st_size, stat.st_mtime_ns] != self.inventory[row["clip"]]:
            raise TrainingError("motion_changed", row["clip"])
        mapped = np.load(path, mmap_mode="r", allow_pickle=False)
        try:
            if (mapped.shape not in ((row["total_frames"], 375), (row["total_frames"], 125, 3))
                    or mapped.dtype.kind != "f"):
                raise TrainingError("invalid_motion", row["clip"])
            start, end = row["frames"]
            segment = np.array(mapped[start:end], dtype=np.float32, copy=True).reshape(-1, 375)
            if not len(segment) or not np.isfinite(segment).all():
                raise TrainingError("invalid_motion", row["clip"])
            return self.resample(segment, self.length).astype(np.float32)
        finally:
            mapped._mmap.close()


def _source_ids(row, vocab, max_src):
    symbols = source_symbols(row)
    if not symbols or len(symbols) > max_src:
        raise TrainingError("source_length", row.get("clip", "source"))
    if any(symbol not in vocab or vocab[symbol] == 0 for symbol in symbols):
        raise TrainingError("source_oov", row.get("clip", "source"))
    return [vocab[symbol] for symbol in symbols]


def build_model(checkpoint):
    """Construct an unchanged model architecture from inference metadata."""
    c = checkpoint["config"]
    common = {"d": c["d"], "layers": c["layers"], "n_signer": len(checkpoint["signers"])}
    kind = checkpoint["kind"]
    if kind == "gpt":
        return MotionGPT(len(checkpoint["classes"]), checkpoint["nb_code"], max_len=checkpoint["max_len"], **common)
    if kind == "regress":
        return MotionRegressor(len(checkpoint["classes"]), 375, c["length"], **common)
    if kind == "sentence":
        return SentenceToMotion(len(checkpoint["vocab"]), checkpoint["nb_code"], max_src=checkpoint["max_src"],
                                max_len=checkpoint["max_len"], **common)
    raise TrainingError("invalid_kind", str(kind))


def load_trained_model(path, device="cpu"):
    """Return (eval model, checkpoint) for gpt/regress/sentence, CPU by default.

    Reads inference files with weights_only=True. Recovery files are rejected.
    Legacy word inference dictionaries remain supported; B must still enforce
    its explicit smoke policy and compare manifest with the actual decoder.
    """
    target = resolve_device(device)
    ck = torch.load(path, map_location="cpu", weights_only=True)
    if ck.get("checkpoint_type", "inference") != "inference":
        raise TrainingError("inference_required", "checkpoint_type")
    if "artifact_manifest" in ck:
        validate_artifact_manifest(ck["artifact_manifest"], allow_smoke=True,
                                   expected={"nb_code": ck["nb_code"]})
    model = build_model(ck)
    model.load_state_dict(ck["model"])
    return model.to(target).eval(), ck


class Trainer:
    def __init__(self, selection, kind, config, data_dir=None):
        config.validate()
        if kind not in ("gpt", "regress", "sentence"):
            raise TrainingError("invalid_kind", str(kind))
        if not selection.train:
            raise TrainingError("empty_train", "train")
        if not selection.signers:
            raise TrainingError("empty_signers", "signers")
        self.selection, self.kind, self.config = selection, kind, config
        self.device = resolve_device(config.device)
        self.generation_signer = config.generation_signer or selection.report["generation_signer"]
        if self.generation_signer not in selection.signers:
            raise TrainingError("untrained_signer", "generation_signer")
        self.max_len = config.max_len or max(len(r["tokens"]) for r in selection.train) + 8
        for row in selection.train:
            if len(row["tokens"]) > self.max_len:
                raise TrainingError("target_length", row["clip"])
            if kind == "sentence":
                _source_ids(row, selection.vocab, config.max_src)
        self.val, self.val_skipped = [], Counter()
        # Only the ordinary validation bucket is considered here.
        for row in selection.partitions["val"]:
            if kind != "sentence" and row["item"] not in selection.classes:
                self.val_skipped["class_oov"] += 1
                continue
            if kind != "regress" and len(row["tokens"]) > self.max_len:
                self.val_skipped["target_length"] += 1
                continue
            if kind == "sentence":
                try:
                    _source_ids(row, selection.vocab, config.max_src)
                except TrainingError as exc:
                    self.val_skipped[exc.code] += 1
                    continue
            self.val.append(row)
        if not self.val and selection.report["data_mode"] == "formal":
            raise TrainingError("validation_required", "ordinary val has no supported clips")
        self.motion = None
        if kind == "regress":
            if data_dir is None:
                raise TrainingError("motion_required", "data_dir")
            self.motion = MotionSegments(data_dir, selection.train + self.val, config.length)
        seed_run(config.seed, config.deterministic)
        self.rng = np.random.default_rng(config.seed)
        self.metadata = {"checkpoint_schema_version": 1, "checkpoint_type": "inference", "kind": kind,
                         "classes": selection.classes, "vocab": selection.vocab, "signers": selection.signers,
                         "nb_code": selection.tokens["nb_code"], "max_len": self.max_len,
                         "max_src": config.max_src, "config": asdict(config),
                         "generation_signer": self.generation_signer}
        self.model = build_model(self.metadata).to(self.device)
        self.weights = None
        if kind == "regress":
            from vq.train import joint_weights
            self.weights = joint_weights(1.0, 2.0, 0.5).to(self.device)
        self.optimizer = torch.optim.AdamW(self.model.parameters(), lr=config.lr, weight_decay=1e-2)
        # Keep OneCycleLR, avoiding a zero-length warm-up for tiny totals / 10 steps.
        self.pct_start = max(0.1, min(0.3, 2.0 / config.iters))
        self.scheduler = torch.optim.lr_scheduler.OneCycleLR(
            self.optimizer, max_lr=config.lr, total_steps=config.iters, pct_start=self.pct_start)

    def loss(self, rows, *, training, trace=None):
        device, model, sel = self.device, self.model, self.selection
        signers = [sel.signers[r["signer"]] if training else sel.signers[self.generation_signer] for r in rows]
        sig = torch.tensor(signers, dtype=torch.long, device=device)
        if self.kind == "sentence":
            sources = [_source_ids(r, sel.vocab, self.config.max_src) for r in rows]
            condition = torch.zeros((len(rows), max(map(len, sources))), dtype=torch.long, device=device)
            for i, ids in enumerate(sources):
                condition[i, :len(ids)] = torch.tensor(ids, dtype=torch.long, device=device)
        else:
            condition = torch.tensor([sel.classes[r["item"]] for r in rows], dtype=torch.long, device=device)
        if self.kind == "regress":
            from vq.train import losses
            targets = torch.from_numpy(np.stack([self.motion.read(r) for r in rows])).to(device)
            pos, vel, hand = losses(targets, model(condition, sig), self.weights, 0.02)
            return pos + 0.5 * vel + hand, len(rows)
        length = max(len(r["tokens"]) for r in rows)
        inputs = torch.full((len(rows), length), model.pad, dtype=torch.long, device=device)
        targets = torch.full((len(rows), length + 1), -100, dtype=torch.long, device=device)
        for i, row in enumerate(rows):
            tokens = torch.tensor(row["tokens"], dtype=torch.long, device=device)
            if training:
                rate = self.rng.uniform(0, self.config.corrupt)
                inputs[i, :len(tokens)] = torch.where(torch.rand(len(tokens), device=device) < rate,
                    torch.randint(0, sel.tokens["nb_code"], (len(tokens),), device=device), tokens)
            else:
                inputs[i, :len(tokens)] = tokens
            targets[i, :len(tokens)] = tokens
            targets[i, len(tokens)] = model.end
        logits = model(condition, inputs, sig)
        if trace is not None:
            trace.update(condition=condition.detach(), inputs=inputs.detach(), targets=targets.detach(),
                         signers=sig.detach(), logits=logits.detach())
        return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), ignore_index=-100), \
            sum(len(r["tokens"]) + 1 for r in rows)

    def validate(self):
        if not self.val:
            return None
        self.model.eval()
        total, weight = 0.0, 0
        with torch.inference_mode():
            for start in range(0, len(self.val), self.config.batch):
                loss, count = self.loss(self.val[start:start + self.config.batch], training=False)
                total += float(loss) * count
                weight += count
        value = total / weight
        if not math.isfinite(value):
            raise TrainingError("nonfinite_validation", "loss")
        return value

    def signature(self, manifest):
        stable_manifest = {k: v for k, v in manifest.items() if k not in ("code_commit", "code_dirty")}
        return {"schema_version": 1, "kind": self.kind, "config": asdict(self.config),
                "manifest": stable_manifest, "device": str(self.device), "torch_version": str(torch.__version__),
                "cpu_threads": torch.get_num_threads(),
                "model_metadata": {k: v for k, v in self.metadata.items() if k not in ("artifact_manifest", "tokens")},
                "scheduler": {"kind": "OneCycleLR", "pct_start": self.pct_start},
                "implementation": {name: sha256_file(Path(__file__).with_name(name))
                                   for name in ("model.py", "training.py")},
                "motion_root": str(self.motion.root) if self.motion else None,
                "motion_files": self.motion.inventory if self.motion else None}


def train(selection, run_dir, *, kind, config, data_dir=None, vq_path=None,
          vq_version=None, resume=False, stop_after=None, tokens_path=None,
          warm_start=None, parent_sha256=None):
    """Train or resume the same run, returning step/best/LR/coverage metadata.

    ``stop_after`` is an absolute step for interruption tests; config.iters must
    remain the original total. Checkpoints contain Python/NumPy/Torch RNG state
    and are loaded with weights_only=True. No real dataset is needed for smoke.
    warm_start requires an explicit parent SHA and a new run. It copies only
    strict GPT weights, evaluates/saves the full ordinary val baseline at step0,
    and starts a new optimizer/schedule/RNG. Resume remains exact recovery only.
    """
    if resume and warm_start is not None:
        raise TrainingError("initialization_conflict", "resume/warm_start")
    if warm_start is None and parent_sha256 is not None:
        raise TrainingError("parent_required", "warm_start")
    trainer = Trainer(selection, kind, config, data_dir)
    end_step = config.iters if stop_after is None else stop_after
    if type(end_step) is not int or not 1 <= end_step <= config.iters:
        raise TrainingError("invalid_config", "stop_after")
    run = Path(run_dir)
    step, best, best_step, best_artifact = 0, None, None, None
    parent = None
    if resume:
        saved_training = json.loads((run / "training.json").read_text(encoding="utf-8"))
        parent = saved_training.get("parent_provenance")
        if parent is not None:
            if sha256_file(parent["path"]) != parent["sha256"]:
                raise TrainingError("warm_start_parent", "parent changed before pilot resume")
            trainer.metadata["parent_provenance"] = parent
        parts = decoder_parts(selection, vq_path=vq_path, vq_version=vq_version)
        manifest = create_artifact_manifest(selection, run / "selection.json", vq_path=vq_path,
                                            vq_version=vq_version, parts=parts)
        saved_manifest = json.loads((run / "artifact_manifest.json").read_text(encoding="utf-8"))
        if trainer.signature(manifest) != trainer.signature(saved_manifest):
            raise TrainingError("resume_mismatch", "artifact_manifest")
        recovery = torch.load(run / "latest.pt", map_location="cpu", weights_only=True)
        if recovery.get("checkpoint_schema_version") != 1 or recovery.get("checkpoint_type") != "recovery":
            raise TrainingError("invalid_recovery", "checkpoint_schema_version/checkpoint_type")
        if recovery["signature"] != trainer.signature(manifest):
            raise TrainingError("resume_mismatch", "signature")
        step = recovery["global_step"]
        if step > end_step:
            raise TrainingError("invalid_config", "stop_after precedes saved step")
        trainer.model.load_state_dict(recovery["model"])
        trainer.optimizer.load_state_dict(recovery["optimizer"])
        trainer.scheduler.load_state_dict(recovery["scheduler"])
        best, best_step, best_artifact = recovery["best_validation"], recovery["best_step"], recovery["best_artifact"]
        if recovery.get("parent_provenance") != parent:
            raise TrainingError("resume_mismatch", "parent_provenance")
        # Restore RNG last, after initialization and optimizer/scheduler loading.
        restore_rng(recovery["rng"], trainer.rng)
        # Keep the original run's provenance, even if unrelated Git state changed.
        manifest = saved_manifest
    else:
        if warm_start is not None:
            if kind != "gpt" or not isinstance(parent_sha256, str) or len(parent_sha256) != 64:
                raise TrainingError("warm_start_parent", "gpt and explicit SHA256 required")
            parent_path = Path(warm_start).resolve(strict=True)
            if run.resolve().is_relative_to(parent_path.parent) or sha256_file(parent_path) != parent_sha256:
                raise TrainingError("warm_start_parent", "path/hash")
            if len(trainer.val) != len(selection.partitions["val"]) or not trainer.val:
                raise TrainingError("warm_start_validation", "all ordinary val clips must be eligible")
            checkpoint = torch.load(parent_path, map_location="cpu", weights_only=True)
            if (checkpoint.get("checkpoint_schema_version") != 1 or
                    checkpoint.get("checkpoint_type") != "inference" or checkpoint.get("kind") != "gpt"):
                raise TrainingError("warm_start_parent", "inference GPT schema 1 required")
            for field in ("classes", "signers", "nb_code", "max_len", "generation_signer"):
                if checkpoint.get(field) != trainer.metadata[field]:
                    raise TrainingError("warm_start_mismatch", field)
            for field in ("d", "layers", "corrupt"):
                if checkpoint.get("config", {}).get(field) != asdict(config)[field]:
                    raise TrainingError("warm_start_mismatch", f"config.{field}")
            parts = decoder_parts(selection, vq_path=vq_path, vq_version=vq_version)
            artifact = checkpoint.get("artifact_manifest")
            validate_artifact_manifest(artifact, allow_smoke=selection.report["data_mode"] == "smoke")
            for field, expected in {**selection.report["sources"], "data_mode": selection.report["data_mode"],
                                    "nb_code": selection.tokens["nb_code"], "down": selection.tokens["down"],
                                    "parts": parts, "vq_version": vq_version,
                                    "vq_sha256": sha256_file(vq_path) if vq_path else None}.items():
                if artifact.get(field) != expected:
                    raise TrainingError("warm_start_mismatch", f"artifact.{field}")
            selection_raw = (json.dumps(selection.report, ensure_ascii=False, sort_keys=True,
                                        indent=2, allow_nan=False) + "\n").encode("utf-8")
            if artifact["selection_sha256"] != hashlib.sha256(selection_raw).hexdigest():
                raise TrainingError("warm_start_mismatch", "selection_sha256")
            trainer.model.load_state_dict(checkpoint["model"], strict=True)
            parent = {"path": str(parent_path), "sha256": parent_sha256,
                      "global_step": checkpoint["global_step"], "kind": "gpt"}
            trainer.metadata["parent_provenance"] = parent
            if trainer.optimizer.state:
                raise TrainingError("warm_start_optimizer", "new optimizer must have no state")
            if sha256_file(parent_path) != parent_sha256:
                raise TrainingError("warm_start_parent", "changed during load")
        manifest = prepare_run(selection, run, vq_path=vq_path, vq_version=vq_version)
        write_json_atomic(run / "training.json", {"schema_version": 1, "signature": trainer.signature(manifest),
            "validation": {"eligible": len(trainer.val), "skipped": dict(trainer.val_skipped)},
            "selection_metric": "ordinary_val_loss" if trainer.val else "smoke_unvalidated",
            "generation_signer": trainer.generation_signer, "parent_provenance": parent})
    trainer.metadata.update(artifact_manifest=manifest, tokens=str(tokens_path) if tokens_path else None)

    def inference_artifact(current_step, metric):
        return {**trainer.metadata, "model": _cpu_state(trainer.model), "global_step": current_step,
                "best_validation": metric, "best_step": best_step,
                "artifact_role": "warm_start_step0" if parent is not None and current_step == 0 else "validation_best",
                "selection_metric": "ordinary_val_loss" if trainer.val else "smoke_unvalidated"}

    def save_latest():
        recovery = {"checkpoint_schema_version": 1, "checkpoint_type": "recovery",
                    "model": _cpu_state(trainer.model), "optimizer": trainer.optimizer.state_dict(),
                    "scheduler": trainer.scheduler.state_dict(), "global_step": step,
                    "rng": capture_rng(trainer.rng), "best_validation": best, "best_step": best_step,
                    "best_artifact": best_artifact, "config": asdict(config), "artifact_manifest": manifest,
                    "parent_provenance": parent,
                    "signature": trainer.signature(manifest)}
        atomic_torch_save(recovery, run / "latest.pt")
        if best_artifact is not None:
            atomic_torch_save(best_artifact, run / "model.pt")

    if warm_start is not None:
        state = capture_rng(trainer.rng)
        baseline = trainer.validate()
        restore_rng(state, trainer.rng)
        if baseline is None:
            raise TrainingError("warm_start_validation", "full ordinary val required at step0")
        best, best_step = baseline, 0
        best_artifact = inference_artifact(0, baseline)
        atomic_torch_save(best_artifact, run / "baseline.pt")
        write_json_atomic(run / "baseline.json", {"schema_version": 1, "global_step": 0,
            "ordinary_val_loss": baseline, "validation_clips": len(trainer.val),
            "validation_skipped": dict(trainer.val_skipped), "parent_provenance": parent,
            "interpretation": "parent weights measured under this new run; not pilot improvement"})
        save_latest()
    starting_step = step
    with open(run / "log.jsonl", "a", encoding="utf-8") as log:
        while step < end_step:
            trainer.model.train()
            rows = [selection.train[i] for i in trainer.rng.integers(len(selection.train), size=config.batch)]
            loss, _ = trainer.loss(rows, training=True)
            if not torch.isfinite(loss):
                raise TrainingError("nonfinite_training", "loss")
            trainer.optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainer.model.parameters(), 1.0, error_if_nonfinite=True)
            trainer.optimizer.step()
            trainer.scheduler.step()
            step += 1
            if step % config.eval_every == 0 or step == config.iters:
                metric = trainer.validate()
                if metric is not None and (best is None or metric < best):
                    best, best_step = metric, step
                    best_artifact = inference_artifact(step, metric)
                log.write(json.dumps({"step": step, "train_loss": float(loss.detach()), "val_loss": metric,
                                      "best_validation": best, "lr": trainer.optimizer.param_groups[0]["lr"]}) + "\n")
                log.flush()
            if not trainer.val:
                best_artifact = inference_artifact(step, None)
            if step % config.save_every == 0 or step == end_step:
                save_latest()
        # A no-op resume can repair an inference file from recovery as well.
        if step == starting_step:
            save_latest()
    if parent is not None and sha256_file(parent["path"]) != parent["sha256"]:
        raise TrainingError("warm_start_parent", "parent changed during pilot")
    return {"global_step": step, "best_validation": best, "best_step": best_step,
            "lr": trainer.optimizer.param_groups[0]["lr"], "device": str(trainer.device),
            "validation_clips": len(trainer.val), "validation_skipped": dict(trainer.val_skipped),
            "generation_signer": trainer.generation_signer, "run_dir": str(run),
            "parent_provenance": parent, "step0_baseline_file": str(run/"baseline.json") if parent else None}


def config_from_args(args):
    return TrainingConfig(**{key: getattr(args, key) for key in TrainingConfig.__dataclass_fields__ if hasattr(args, key)})
