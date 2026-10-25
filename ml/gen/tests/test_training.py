"""CPU training/recovery tests use only tiny invented data and model weights."""
from dataclasses import replace
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import unittest
from unittest.mock import patch

import numpy as np

from gen.artifacts import ArtifactValidationError
from gen.tests.test_data import Fixture
from gen.train_sentence import build_pairs, encode_src

HAS_TORCH = importlib.util.find_spec("torch") is not None
if HAS_TORCH:
    import torch
    from gen.training import (MotionSegments, Trainer, TrainingConfig, TrainingError,
                              atomic_torch_save, capture_rng, load_trained_model,
                              resolve_device, restore_rng, train)
    from gen.train_word import load_generator
    from gen.train_sentence import load_sentence_generator


@unittest.skipUnless(HAS_TORCH, "Torch absent: actual CPU training/resume NOT verified")
class TrainingTests(Fixture):
    @classmethod
    def setUpClass(cls):
        cls.previous_threads = torch.get_num_threads()
        torch.set_num_threads(1)

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.previous_threads)

    def config(self, **kwargs):
        return replace(TrainingConfig(iters=4, batch=2, d=8, layers=1, length=8, seed=17,
                                      device="cpu", eval_every=1, save_every=1, max_src=8), **kwargs)

    def word_selection(self):
        self.add("WORD_A")
        self.add("WORD_B")
        self.add("WORD_A", "V")
        self.add("WORD_A", "E")
        selection = self.select(mode="smoke")
        (self.root / "npy").mkdir(exist_ok=True)
        for row in selection.train + selection.partitions["val"]:
            motion = np.arange(12 * 375, dtype=np.float32).reshape(12, 125, 3) / 4500
            np.save(self.root / "npy" / f"{row['clip']}.npy", motion)
        # No test npy: reading it during training would fail immediately.
        return selection

    def assert_state_equal(self, first, second):
        if isinstance(first, torch.Tensor):
            self.assertTrue(torch.equal(first, second))
        elif isinstance(first, dict):
            self.assertEqual(first.keys(), second.keys())
            for key in first:
                self.assert_state_equal(first[key], second[key])
        elif isinstance(first, (tuple, list)):
            self.assertEqual(len(first), len(second))
            for a, b in zip(first, second):
                self.assert_state_equal(a, b)
        else:
            self.assertEqual(first, second)

    def read_checkpoint(self, run, name="latest.pt"):
        return torch.load(self.root / run / name, map_location="cpu", weights_only=True)

    def test_word_gpt_train_save_load_infer_without_npy(self):
        selection = self.word_selection()
        with patch("numpy.load", side_effect=AssertionError("token GPT opened npy")):
            result = train(selection, self.root / "gpt", kind="gpt", config=self.config())
        self.assertEqual(result["global_step"], 4)
        self.assertIsNotNone(result["best_validation"])
        model, ck = load_generator(self.root / "gpt/model.pt")
        self.assertFalse(model.training)
        self.assertEqual(ck["signers"], {"T": 0})
        self.assertEqual(ck["generation_signer"], "T")
        with torch.inference_mode():
            out = model.generate(torch.tensor([0]), torch.tensor([0]), top_k=2)
        self.assertTrue(out[0])
        self.assertTrue(all(0 <= code < 8 for code in out[0]))
        latest = self.read_checkpoint("gpt")
        for field in ("optimizer", "scheduler", "global_step", "rng", "best_validation", "config", "artifact_manifest"):
            self.assertIn(field, latest)
        self.assertNotIn("optimizer", ck)

    def test_regressor_batch_only_reads_and_inference(self):
        selection = self.word_selection()
        real_load, paths = np.load, []
        def load(path, **kwargs):
            self.assertEqual(kwargs, {"mmap_mode": "r", "allow_pickle": False})
            paths.append(Path(path).stem)
            return real_load(path, **kwargs)
        with patch("numpy.load", side_effect=load):
            result = train(selection, self.root / "reg", kind="regress", config=self.config(), data_dir=self.root)
        self.assertIsNotNone(result["best_validation"])
        self.assertTrue(paths)
        self.assertLessEqual(set(paths), {r["clip"] for r in selection.train + selection.partitions["val"]})
        model, _ = load_generator(self.root / "reg/model.pt")
        with torch.inference_mode():
            motion = model(torch.tensor([0]), torch.tensor([0]))
        self.assertEqual(tuple(motion.shape), (1, 8, 375))
        self.assertEqual(motion.dtype, torch.float32)
        self.assertTrue(torch.isfinite(motion).all())

    def test_uninterrupted_and_resumed_are_bitwise_equal_for_both_word_models(self):
        selection = self.word_selection()
        for kind in ("gpt", "regress"):
            with self.subTest(kind=kind):
                options = {"kind": kind, "config": self.config(eval_every=3, save_every=3), "data_dir": self.root}
                train(selection, self.root / f"{kind}-full", **options)
                train(selection, self.root / f"{kind}-resume", stop_after=2, **options)
                # A new caller may have consumed unrelated global RNGs meanwhile.
                random.random()
                np.random.random()
                torch.rand(7)
                train(selection, self.root / f"{kind}-resume", resume=True, **options)
                full = self.read_checkpoint(f"{kind}-full")
                resumed = self.read_checkpoint(f"{kind}-resume")
                for field in ("global_step", "model", "optimizer", "scheduler", "rng", "best_validation", "best_step"):
                    self.assert_state_equal(full[field], resumed[field])
                self.assert_state_equal(self.read_checkpoint(f"{kind}-full", "model.pt")["model"],
                                        self.read_checkpoint(f"{kind}-resume", "model.pt")["model"])

    def test_resume_rejects_changed_execution_settings(self):
        selection = self.word_selection()
        cfg = self.config()
        train(selection, self.root / "resume", kind="gpt", config=cfg, stop_after=2)
        for changes in ({"iters": 5}, {"d": 16}, {"batch": 1}, {"seed": 18}, {"lr": 1e-4},
                        {"corrupt": 0.1}, {"eval_every": 2}, {"max_len": 30}):
            with self.subTest(changes=changes), self.assertRaises(TrainingError) as ctx:
                train(selection, self.root / "resume", kind="gpt", config=replace(cfg, **changes), resume=True)
            self.assertEqual(ctx.exception.code, "resume_mismatch")

    def test_resume_rejects_changed_token_or_metadata(self):
        selection = self.word_selection()
        train(selection, self.root / "resume", kind="gpt", config=self.config(), stop_after=2)
        self.tokens["clips"]["WORD_A_T"]["tokens"][0] = 7
        changed = self.select(mode="smoke")
        with self.assertRaises(ArtifactValidationError) as ctx:
            train(changed, self.root / "resume", kind="gpt", config=self.config(), resume=True)
        self.assertEqual(ctx.exception.code, "selection_mismatch")

    def test_resume_rejects_changed_decoder_bytes_and_version(self):
        selection = self.word_selection()
        from vq.model import MotionVQVAE
        cfg = {"width": 8, "code_dim": 4, "nb_code": 8, "depth": 1, "parts": "body_hand"}
        # Fixture tokens use down=2; use down=4 here to match the existing loader.
        self.tokens["down"] = 4
        for token in self.tokens["clips"].values():
            token["tokens"] = token["tokens"][:3]
        selection = self.select(mode="smoke")
        decoder = self.root / "vq.pt"
        vq = MotionVQVAE(width=8, code_dim=4, nb_code=8, depth=1, parts="body_hand")
        torch.save({"config": cfg, "model": vq.state_dict()}, decoder)
        original_decoder = decoder.read_bytes()
        options = {"kind": "gpt", "config": self.config(), "vq_path": decoder, "vq_version": "fixture-v1"}
        train(selection, self.root / "resume", stop_after=2, **options)
        vq.rest.add_(1)
        torch.save({"config": cfg, "model": vq.state_dict()}, decoder)
        with self.assertRaises(TrainingError) as ctx:
            train(selection, self.root / "resume", resume=True, **options)
        self.assertEqual(ctx.exception.code, "resume_mismatch")
        decoder.write_bytes(original_decoder)
        with self.assertRaisesRegex(TrainingError, "resume_mismatch"):
            train(selection, self.root / "resume", resume=True, **{**options, "vq_version": "fixture-v2"})
        formal = self.select()
        result = train(formal, self.root / "formal", **{**options, "config": self.config(iters=1)})
        self.assertEqual(result["global_step"], 1)
        self.assertEqual(self.read_checkpoint("formal", "model.pt")["artifact_manifest"]["data_mode"], "formal")

    def test_resume_rejects_changed_coordinate_inventory(self):
        selection = self.word_selection()
        train(selection, self.root / "resume", kind="regress", config=self.config(), data_dir=self.root, stop_after=2)
        path = self.root / "npy/WORD_A_T.npy"
        np.save(path, np.zeros((12, 125, 3), dtype=np.float64))
        with self.assertRaises(TrainingError) as ctx:
            train(selection, self.root / "resume", kind="regress", config=self.config(), data_dir=self.root, resume=True)
        self.assertEqual(ctx.exception.code, "resume_mismatch")

    def test_validation_uses_train_signer_and_never_test_or_holdout(self):
        selection = self.word_selection()
        selection.partitions["test"] = [{"invalid": "must not be inspected"}]
        selection.partitions["holdout_val"] = [{"invalid": "must not be inspected"}]
        selection.partitions["holdout_test"] = [{"invalid": "must not be inspected"}]
        trainer = Trainer(selection, "gpt", self.config())
        with patch.object(trainer.model, "forward", wraps=trainer.model.forward) as forward:
            self.assertTrue(math.isfinite(trainer.validate()))
        signers = forward.call_args.args[2]
        self.assertTrue(torch.equal(signers, torch.tensor([0])))
        self.assertEqual(trainer.model.signer.num_embeddings, 1)

    def test_generation_for_val_and_test_uses_learned_train_signer(self):
        selection = self.word_selection()
        train(selection, self.root / "generation", kind="gpt", config=self.config(iters=1))
        model, ck = load_generator(self.root / "generation/model.pt")
        for bucket in ("val", "test"):
            reference = selection.partitions[bucket][0]
            self.assertNotIn(reference["signer"], ck["signers"])
            with torch.inference_mode():
                generated = model.generate(torch.tensor([ck["classes"][reference["item"]]]),
                    torch.tensor([ck["signers"][ck["generation_signer"]]]), top_k=2)
            self.assertTrue(generated[0])

    def test_best_model_comes_from_validation_not_latest_or_training_loss(self):
        selection = self.word_selection()
        with patch.object(Trainer, "validate", side_effect=[2.0, 1.0, 3.0, 4.0]):
            result = train(selection, self.root / "best", kind="gpt", config=self.config())
        best = self.read_checkpoint("best", "model.pt")
        latest = self.read_checkpoint("best")
        self.assertEqual((result["best_step"], best["global_step"], latest["global_step"]), (2, 2, 4))
        self.assertEqual(best["best_validation"], 1.0)

    def test_tiny_scheduler_totals_including_ten(self):
        selection = self.word_selection()
        for total in (1, 2, 3, 10, 20):
            with self.subTest(total=total):
                result = train(selection, self.root / f"steps-{total}", kind="gpt", config=self.config(iters=total))
                self.assertEqual(result["global_step"], total)
                self.assertTrue(math.isfinite(result["lr"]))

    def test_invalid_configuration_and_empty_train_fail_before_outputs(self):
        selection = self.word_selection()
        for changes in ({"iters": 0}, {"batch": 0}, {"length": 1}, {"d": 7}, {"corrupt": -0.1},
                        {"lr": float("nan")}, {"eval_every": 0}, {"save_every": 0}, {"max_src": 0}):
            with self.subTest(changes=changes), self.assertRaises(TrainingError):
                train(selection, self.root / "invalid", kind="gpt", config=self.config(**changes))
            self.assertFalse((self.root / "invalid").exists())
        selection.partitions["train"] = []
        with self.assertRaisesRegex(TrainingError, "empty_train"):
            train(selection, self.root / "empty", kind="gpt", config=self.config())

    def test_explicit_cuda_never_silently_falls_back(self):
        with patch("torch.cuda.is_available", return_value=False):
            self.assertEqual(str(resolve_device("auto")), "cpu")
            self.assertEqual(str(resolve_device("cpu")), "cpu")
            with self.assertRaisesRegex(TrainingError, "cuda_unavailable"):
                resolve_device("cuda")

    def test_formal_requires_eligible_ordinary_validation(self):
        selection = self.word_selection()
        selection.report["data_mode"] = "formal"
        selection.partitions["val"] = []
        with self.assertRaisesRegex(TrainingError, "validation_required"):
            Trainer(selection, "gpt", self.config())

    def test_validation_oov_coverage_is_reported_and_not_trained(self):
        selection = self.word_selection()
        unknown = dict(selection.partitions["val"][0], item="WORD_OOV", clip="OOV_V")
        selection.partitions["val"].append(unknown)
        result = train(selection, self.root / "coverage", kind="gpt", config=self.config())
        self.assertEqual(result["validation_skipped"], {"class_oov": 1})
        self.assertNotIn("WORD_OOV", self.read_checkpoint("coverage", "model.pt")["classes"])

    def test_synthetic_sentence_train_save_load_infer_and_resume(self):
        self.word_selection()
        _, pairs, vocab, selection = build_pairs(self.root / "tokens.json", None, True,
            np.random.default_rng(0), n_synth=4, return_selection=True)
        cfg = self.config()
        train(selection, self.root / "sentence-full", kind="sentence", config=cfg)
        train(selection, self.root / "sentence-resume", kind="sentence", config=cfg, stop_after=2)
        train(selection, self.root / "sentence-resume", kind="sentence", config=cfg, resume=True)
        full, resumed = self.read_checkpoint("sentence-full"), self.read_checkpoint("sentence-resume")
        for field in ("model", "optimizer", "scheduler", "rng", "global_step"):
            self.assert_state_equal(full[field], resumed[field])
        model, ck = load_sentence_generator(self.root / "sentence-resume/model.pt")
        self.assertEqual(ck["kind"], "sentence")
        self.assertEqual(ck["selection_metric"], "smoke_unvalidated")
        self.assertIsNone(ck["best_validation"])
        src = torch.tensor([encode_src(pairs[0], vocab, cfg.max_src)])
        with torch.inference_mode():
            out = model.generate(src, torch.tensor([0]), top_k=2)
        self.assertTrue(out[0])

    def test_sentence_ordinary_validation_and_unknown_tags(self):
        self.add("SEN_A", kind="SEN", gloss=["known"], tags=["question"])
        self.add("SEN_A", "V", kind="SEN", gloss=["known"], tags=["question"])
        self.add("SEN_B", "V", kind="SEN", gloss=["known"], tags=["eval_tag"])
        self.add("SEN_C", "E", kind="SEN", gloss=["test_only"])
        selection = self.select("SEN", mode="smoke")
        result = train(selection, self.root / "sen-val", kind="sentence", config=self.config(iters=1))
        self.assertEqual(result["validation_skipped"], {"source_oov": 1})
        self.assertEqual(result["validation_clips"], 1)
        _, ck = load_sentence_generator(self.root / "sen-val/model.pt")
        self.assertEqual(ck["selection_metric"], "ordinary_val_loss")
        self.assertNotIn("test_only", ck["vocab"])
        self.assertNotIn("<eval_tag>", ck["vocab"])

    def test_legacy_word_loader_and_recovery_rejection(self):
        selection = self.word_selection()
        train(selection, self.root / "model", kind="gpt", config=self.config())
        ck = self.read_checkpoint("model", "model.pt")
        for field in ("checkpoint_type", "checkpoint_schema_version", "artifact_manifest"):
            ck.pop(field)
        torch.save(ck, self.root / "legacy.pt")
        _, loaded = load_generator(self.root / "legacy.pt")
        self.assertEqual(loaded["kind"], "gpt")
        with self.assertRaisesRegex(TrainingError, "inference_required"):
            load_generator(self.root / "model/latest.pt")

    def test_checkpoint_atomic_failure_preserves_old_file(self):
        target = self.root / "atomic.pt"
        torch.save({"old": 1}, target)
        with patch("gen.training.os.replace", side_effect=OSError("simulated interruption")):
            with self.assertRaises(OSError):
                atomic_torch_save({"new": 2}, target)
        self.assertEqual(torch.load(target, weights_only=True), {"old": 1})
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["atomic.pt"])

    def test_rng_roundtrip_including_numpy_generator(self):
        rng = np.random.default_rng(3)
        state = capture_rng(rng)
        first = (random.random(), np.random.rand(), rng.random(), torch.rand(3))
        restore_rng(state, rng)
        second = (random.random(), np.random.rand(), rng.random(), torch.rand(3))
        self.assert_state_equal(first, second)

    def test_cli_word_and_synthetic_sentence_smoke(self):
        self.word_selection()
        common = ["--tokens", str(self.root / "tokens.json"), "--iters", "1", "--batch", "1",
                  "--d", "8", "--layers", "1", "--device", "cpu", "--seed", "7"]
        for module, extra in (("gen.train_word", ["--model", "gpt", "--data", str(self.root), "--data-mode", "smoke"]),
                              ("gen.train_sentence", ["--synthetic"])):
            with self.subTest(module=module):
                result = subprocess.run([sys.executable, "-m", module, *common, *extra,
                                         "--run", str(self.root / module)], capture_output=True, text=True,
                                        cwd=Path(__file__).resolve().parents[2], timeout=60,
                                        env={**os.environ, "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["global_step"], 1)


if __name__ == "__main__":
    unittest.main()
