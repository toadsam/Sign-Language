"""Invented WORD records and motions only; no model, E5, network or GPU."""
import json
import hashlib
import io
import importlib.util
import os
from pathlib import Path
import random
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

from gen.artifacts import sha256_file
from gen.data import select_data
from gen.evaluate import (INFERENCE_FILES, EvaluationError, check_motion, dtw, evaluate_frozen,
                          finger_relative_metrics, isolated_rng, load_reference, main, make_manifest, select_words, wrist_metrics)


class Motion:
    dtype = "float32"

    def __init__(self, frames):
        self.frames = frames
        self.shape = (len(frames), 125, 3)

    def __len__(self):
        return len(self.frames)

    def __iter__(self):
        return iter(self.frames)

    def __getitem__(self, index):
        value = self.frames[index]
        return Motion(value) if isinstance(index, slice) else value


def motion(n=12, offset=0.0, moving=True):
    return Motion([[[offset + (i if moving and j in (13, 34) else 0.0), 0.0, 0.0]
                    for j in range(125)] for i in range(n)])


class EvaluationFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.paths = {"tokens": self.root / "tokens.json", "meta": self.data / "meta.jsonl",
                      "split": self.root / "split.json", "checkpoint": self.root / "model.pt",
                      "vq": self.root / "vq.pt", "vq_config": self.root / "config.json"}
        self.records = []
        self.token_records = {}
        self.split = {"mode": "signer", "signers": {"train": ["REAL01"], "val": ["VAL"], "test": ["TEST"]},
                      "exclude": {"clips": []}}
        for p in (self.paths["checkpoint"], self.paths["vq"]):
            p.write_bytes(b"fake weights")
        self.paths["vq_config"].write_text('{"fixture": true}', encoding="utf-8")

    def add(self, word, signer, suffix=""):
        clip = f"{word}_{signer}{suffix}"
        self.records.append({"clip": clip, "item": word, "signer": signer, "type": "WORD",
                             "frames": 12, "active": [4, 7], "label": "ok", "dur_ratio": 1.0})
        self.token_records[clip] = {"item": word, "signer": signer, "type": "WORD",
                                    "frames": [0, 12], "tokens": [0, 1, 2, 3, 4, 5]}
        return clip

    def setup(self, count=30, words=31):
        for i in range(words):
            w = f"WORD{i:04d}"
            self.add(w, "REAL01")
            self.add(w, "VAL", "a")
            self.add(w, "VAL", "b")
        self.add("WORD0000", "TEST")
        self.paths["tokens"].write_text(json.dumps({"nb_code": 512, "down": 2, "clips": self.token_records}), encoding="utf-8")
        self.paths["meta"].write_text("".join(json.dumps(r) + "\n" for r in self.records), encoding="utf-8")
        self.paths["split"].write_text(json.dumps(self.split), encoding="utf-8")
        self.selection = select_data(self.paths["tokens"], self.paths["meta"], self.paths["split"])
        hashes = {k: sha256_file(p) for k, p in self.paths.items()}
        self.checkpoint = {"kind": "gpt", "global_step": 2280, "classes": self.selection.classes,
                           "signers": self.selection.signers, "generation_signer": "REAL01",
                           "nb_code": 512, "max_len": 54,
                           "artifact_manifest": {"data_mode": "formal", "tokens_sha256": hashes["tokens"],
                                                 "split_sha256": hashes["split"], "vq_sha256": hashes["vq"],
                                                 "meta_sha256": {"word": hashes["meta"]},
                                                 "selection_sha256": hashlib.sha256((json.dumps(
                                                     self.selection.report, ensure_ascii=False, sort_keys=True,
                                                     indent=2, allow_nan=False) + "\n").encode("utf-8")).hexdigest(),
                                                 "nb_code": 512, "down": 2, "parts": "body_hand"}}
        with patch("gen.evaluate.BEST_SHA256", hashes["checkpoint"]):
            self.manifest = make_manifest(self.selection, self.checkpoint, self.paths, count=count)
        return self.manifest

    def assert_error(self, code, action):
        with self.assertRaises(EvaluationError) as raised:
            action()
        self.assertEqual(raised.exception.code, code)


class SelectionTests(EvaluationFixture):
    def test_30_words_all_val_refs_stable_and_no_test(self):
        m = self.setup()
        self.assertEqual(len(m["selected"]), 30)
        self.assertEqual(sum(len(x["references"]) for x in m["selected"]), 60)
        self.assertEqual([r["word_id"] for r in m["selected"]], select_words(self.selection, self.selection.classes)[0])
        self.assertEqual([r["clip"] for r in m["selected"][0]["references"]],
                         sorted(r["clip"] for r in m["selected"][0]["references"]))
        self.assertTrue(all("TEST" not in r["clip"] for x in m["selected"] for r in x["references"]))
        self.assertEqual(make_manifest.__name__, "make_manifest")

    def test_insufficient_words_and_formal_split(self):
        self.setup(count=2, words=2)
        self.assert_error("insufficient_words", lambda: select_words(self.selection, self.selection.classes, 30))
        self.selection.report["data_mode"] = "smoke"
        self.assert_error("formal_required", lambda: select_words(self.selection, self.selection.classes, 1))

    def test_checkpoint_hash_and_metadata_gate(self):
        self.setup(count=2, words=2)
        self.assert_error("checkpoint_hash", lambda: make_manifest(self.selection, self.checkpoint, self.paths, count=2))
        with patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])):
            self.checkpoint["signers"] = {"VAL": 0}
            self.assert_error("signer", lambda: make_manifest(self.selection, self.checkpoint, self.paths, count=2))

    def test_only_allowlisted_val_coordinate_path_can_be_opened(self):
        m = self.setup(count=2, words=2)
        allowed = {r["clip"] for x in m["selected"] for r in x["references"]}
        accessed = []
        def loader(path):
            accessed.append(path.name)
            return motion()
        row = self.selection.partitions["test"][0]
        self.assert_error("coordinate_not_allowed", lambda: load_reference(self.data, row, allowed, loader))
        self.assertEqual(accessed, [])
        val_row = self.selection.partitions["val"][0]
        load_reference(self.data, val_row, allowed, loader)
        self.assertEqual(accessed, [val_row["clip"] + ".npy"])

    def test_missing_reference_aborts_before_generation(self):
        m = self.setup(count=2, words=2)
        calls = []
        def missing(path):
            calls.append(path.name)
            raise FileNotFoundError(path)
        def generate(*args):
            self.fail("generation must wait for all references")
        with self.assertRaises(FileNotFoundError):
            evaluate_frozen(m, self.selection, self.data, generate=generate,
                            decode=lambda t: motion(), load_motion=missing)
        self.assertEqual(len(calls), 1)

    def test_flat_stored_coordinate_shape_is_reshaped_exactly(self):
        m = self.setup(count=1, words=1)
        row = self.selection.partitions["val"][0]
        class Flat:
            shape = (12, 375)
            def reshape(self, *shape):
                self_shape = shape
                assert self_shape == (-1, 125, 3)
                return motion()
        allowed = {r["clip"] for r in m["selected"][0]["references"]}
        self.assertEqual(len(load_reference(self.data, row, allowed, lambda path: Flat())), 12)

    def test_cli_freezes_manifest_before_coordinate_access(self):
        self.setup(count=30, words=30)
        code_root = self.root / "code"
        for relative in INFERENCE_FILES:
            path = code_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# invented dependency\n", encoding="utf-8")
        adapter_hash = sha256_file(code_root / "gen/evaluation_adapter.py")
        bundle = self.root / "bundle"
        bundle.mkdir()
        (bundle / "generator.json").write_text('{"vocab_map":"vocab_map.json"}', encoding="utf-8")
        (bundle / "vocab_map.json").write_text('{"mapping":{}}', encoding="utf-8")
        (self.data / "npy").mkdir()
        for row in self.selection.partitions["val"]:
            (self.data / "npy" / f'{row["clip"]}.npy').write_bytes(b"synthetic val bytes")
        calls = []
        class Model:
            def eval(self):
                return self
        adapter = SimpleNamespace(checkpoint=self.checkpoint, decoder_info={"nb_code": 512, "down": 2,
                "parts": "body_hand"}, model=Model(), decoder_model=Model(),
                generate=lambda *args: calls.append(args), decode=lambda tokens: motion())
        out = self.root / "out"
        args = ["--checkpoint", str(self.paths["checkpoint"]), "--vq", str(self.paths["vq"]),
                "--vq-config", str(self.paths["vq_config"]), "--tokens", str(self.paths["tokens"]),
                "--data", str(self.data), "--split", str(self.paths["split"]),
                "--out", str(out), "--adapter", "fixture:factory",
                "--inference-code-root", str(code_root)]
        with patch.dict(os.environ, {"GEN_EVALUATION_BUNDLE": str(bundle)}), \
                patch("gen.evaluate._adapter", return_value=(adapter, adapter_hash,
                      (code_root / "gen/evaluation_adapter.py").resolve())), \
                patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])), \
                patch("gen.evaluate.EXPECTED_COUNTS", {"train": 30, "val": 60, "test": 1}), \
                redirect_stdout(io.StringIO()):
            main(["--prepare", *args])
            self.assertTrue((out / "manifest.json").exists())
            self.assertEqual(calls, [])
            frozen = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(frozen["reference_sha256"]), 60)
            frozen["sampling"]["seeds"] = [1, 2, 3]
            (out / "manifest.json").write_text(json.dumps(frozen), encoding="utf-8")
            self.assert_error("manifest_changed", lambda: main(["--run", *args]))
            self.assertEqual(calls, [])
            frozen["sampling"]["seeds"] = [17, 18, 19]
            (out / "manifest.json").write_text(json.dumps(frozen), encoding="utf-8")
            first = next(iter(frozen["reference_sha256"]))
            (self.data / "npy" / f"{first}.npy").write_bytes(b"changed val bytes")
            self.assert_error("manifest_changed", lambda: main(["--run", *args]))
            self.assertEqual(calls, [])


class BAdapterIntegrationTests(EvaluationFixture):
    def test_real_b_factory_with_fake_loader_prepare_run_and_freeze(self):
        """Copy B's source from this snapshot or its adjacent worktree to temp."""
        same_ml = Path(__file__).resolve().parents[2]
        neighbor_ml = Path(__file__).resolve().parents[4] / "Sign-Language-inference" / "ml"
        b_ml = same_ml if (same_ml / "gen/evaluation_adapter.py").is_file() else neighbor_ml
        if not (b_ml / "gen/evaluation_adapter.py").is_file():
            self.skipTest("B evaluation_adapter.py is unavailable in snapshot or adjacent worktree")
        self.setup(count=30, words=30)
        self.paths["vq_config"].write_text(json.dumps(
            {"nb_code": 512, "parts": "body_hand", "vq_version": "fixture-v1"}), encoding="utf-8")
        code_root = self.root / "b_code"
        for relative in INFERENCE_FILES:
            destination = code_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(b_ml / relative, destination)
        source = code_root / "gen/evaluation_adapter.py"
        spec = importlib.util.spec_from_file_location("gen.evaluation_adapter", source)
        b_adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(b_adapter)
        bundle = self.root / "bundle"
        bundle.mkdir()
        config = {"schema_version": 1, "kind": "word_gpt", "data_mode": "smoke",
                  "vocab_map": "vocab_map.json", "generator_checkpoint": "../model.pt",
                  "generator_sha256": sha256_file(self.paths["checkpoint"]),
                  "vq_checkpoint": "../vq.pt", "vq_version": "fixture-v1",
                  "sampling": dict(b_adapter.SAMPLING), "expected_generation_signer": "REAL01",
                  "blend": 0, "max_words": 1}
        config_path = bundle / "generator.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        vocab_path = bundle / "vocab_map.json"
        vocab_path.write_text('{"mapping":{}}', encoding="utf-8")
        (self.data / "npy").mkdir()
        for row in self.selection.partitions["val"]:
            (self.data / "npy" / f'{row["clip"]}.npy').write_bytes(b"invented val coordinates")

        class Model:
            def eval(self):
                return self
        generated, decoded, opened = [], [], []
        decoder = SimpleNamespace(quantizer=SimpleNamespace(nb_code=512), down=2,
                                  parts="body_hand", eval=Model().eval)
        core = SimpleNamespace(checkpoint=self.checkpoint, decoder_config=json.loads(
                    self.paths["vq_config"].read_text(encoding="utf-8")), decoder=decoder,
                    model=Model(), manifest={"vq_sha256": sha256_file(self.paths["vq"]),
                                             "down": 2, "parts": "body_hand"})
        class FakeGenerator:
            kind = "word_gpt"
            _adapter = core
            connection_policy = {**b_adapter.SAMPLING, "checkpoint_generation_signer": "REAL01", "max_len": 54}
            fail_one = False
            def generate_word_id(self, word, seed):
                if self.fail_one and word == "WORD0000" and seed == 19:
                    raise RuntimeError("invented generation failure")
                generated.append((word, seed))
                return {"tokens": [1, 2, 3, 4, 5, 6], "motion": motion(12, seed - 17, False), "fps": 30}
            def decode_reference_tokens(self, tokens):
                decoded.append(tuple(tokens))
                return motion(12, 0, False)
        fake_generator = FakeGenerator()
        actual_reference = load_reference
        def fake_reference(data_dir, row, allowed, loader=None):
            def invented_loader(path):
                opened.append(path.name)
                return motion()
            return actual_reference(data_dir, row, allowed, invented_loader)
        args = ["--checkpoint", str(self.paths["checkpoint"]), "--vq", str(self.paths["vq"]),
                "--vq-config", str(self.paths["vq_config"]), "--tokens", str(self.paths["tokens"]),
                "--data", str(self.data), "--split", str(self.paths["split"]),
                "--adapter", "gen.evaluation_adapter:factory", "--inference-code-root", str(code_root)]
        with patch.dict(sys.modules, {"gen.evaluation_adapter": b_adapter}), \
                patch.dict(os.environ, {"GEN_EVALUATION_BUNDLE": str(bundle)}), \
                patch.object(b_adapter, "_load_generator", return_value=fake_generator) as load_stub, \
                patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])), \
                patch("gen.evaluate.EXPECTED_COUNTS", {"train": 30, "val": 60, "test": 1}), \
                patch("gen.evaluate.load_reference", side_effect=fake_reference), \
                redirect_stdout(io.StringIO()):
            out = self.root / "success"
            main(["--prepare", *args, "--out", str(out)])
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["inference_code_sha256"]), len(INFERENCE_FILES))
            self.assertEqual(len(manifest["reference_sha256"]), 60)
            self.assertEqual(manifest["workload_estimate"]["expected_generations"], 90)
            self.assertEqual(manifest["workload_estimate"]["reference_count"], 60)
            self.assertEqual(generated, [])
            main(["--run", *args, "--out", str(out)])
            self.assertEqual(json.loads((out / "run_status.json").read_text(encoding="utf-8"))["phase"], "complete")
            summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual((summary["successes"], summary["failures"], summary["complete_word_count"]), (90, 0, 30))
            self.assertEqual(len(generated), 90)
            self.assertEqual(len(decoded), 60)
            self.assertEqual(len(opened), 60)
            self.assertEqual(load_stub.call_count, 2)
            self.assertTrue(all(name.endswith(("VALa.npy", "VALb.npy")) for name in opened))
            progress = [json.loads(line) for line in (out / "progress.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(progress), 92)
            self.assertEqual(progress[-1], {"phase": "generation", "attempted": 90, "successes": 90, "failures": 0})
            main(["--summarize", "--out", str(out)])
            safe = json.loads((out / "numeric_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(safe["status"], "complete")
            self.assertEqual(safe["generations"]["successes"], 90)
            self.assertNotIn("words", safe)
            self.assertNotIn("WORD0000", json.dumps(safe))
            self.assertNotIn("VALa", json.dumps(safe))

            code_out = self.root / "code_changed"
            main(["--prepare", *args, "--out", str(code_out)])
            dependent = code_root / "gen/infer_models.py"
            original = dependent.read_bytes()
            dependent.write_bytes(original + b"\n# invented change\n")
            self.assert_error("manifest_changed", lambda: main(["--run", *args, "--out", str(code_out)]))
            self.assertEqual(len(generated), 90)
            self.assertEqual(load_stub.call_count, 3)
            dependent.write_bytes(original)

            config_out = self.root / "config_changed"
            main(["--prepare", *args, "--out", str(config_out)])
            config["note"] = "invented setting change"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            self.assert_error("manifest_changed", lambda: main(["--run", *args, "--out", str(config_out)]))
            self.assertEqual(len(generated), 90)
            self.assertEqual(load_stub.call_count, 4)
            config.pop("note")
            config_path.write_text(json.dumps(config), encoding="utf-8")

            vocab_out = self.root / "vocab_changed"
            main(["--prepare", *args, "--out", str(vocab_out)])
            vocab_path.write_text('{"mapping":{"invented":"WORD0000"}}', encoding="utf-8")
            self.assert_error("manifest_changed", lambda: main(["--run", *args, "--out", str(vocab_out)]))
            self.assertEqual(len(generated), 90)
            self.assertEqual(load_stub.call_count, 5)

            factory_out = self.root / "factory_changed"
            vocab_path.write_text('{"mapping":{}}', encoding="utf-8")
            main(["--prepare", *args, "--out", str(factory_out)])
            original = source.read_bytes()
            source.write_bytes(original + b"\n# invented factory change\n")
            self.assert_error("adapter_source", lambda: main(["--run", *args, "--out", str(factory_out)]))
            self.assertEqual(load_stub.call_count, 6)
            source.write_bytes(original)

            partial_out = self.root / "partial"
            main(["--prepare", *args, "--out", str(partial_out)])
            fake_generator.fail_one = True
            with self.assertRaises(SystemExit) as raised:
                main(["--run", *args, "--out", str(partial_out)])
            self.assertEqual(raised.exception.code, 3)
            partial_status = json.loads((partial_out / "run_status.json").read_text(encoding="utf-8"))
            self.assertEqual((partial_status["phase"], partial_status["attempted"],
                              partial_status["successes"], partial_status["failures"]), ("partial", 90, 89, 1))
            last_progress = json.loads((partial_out / "progress.jsonl").read_text(encoding="utf-8").splitlines()[-1])
            self.assertEqual((last_progress["attempted"], last_progress["failures"]), (90, 1))
            main(["--summarize", "--out", str(partial_out)])
            partial_safe = json.loads((partial_out / "numeric_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(partial_safe["status"], "partial")
            self.assertEqual(partial_safe["generations"]["failure_codes"], {"RuntimeError": 1})


class MetricTests(EvaluationFixture):
    def test_relative_finger_motion_removes_rigid_wrist_translation(self):
        moving = motion(5)
        for frame in moving:
            for joint in range(14, 34):
                frame[joint] = list(frame[13])
        metrics = finger_relative_metrics(moving)
        self.assertEqual(metrics["left"]["path"], 0)
        self.assertEqual(metrics["right"]["path"], 4)

    def test_dtw_units_length_and_ties(self):
        a, b = motion(4, 0, False), motion(4, 1, False)
        self.assertAlmostEqual(dtw(a, b), 1.0)
        self.assertEqual(dtw(a, a), 0)
        self.assertAlmostEqual(dtw(motion(2, 0, False), motion(3, 2, False)), 2.0)

    def test_format_path_speed_jerk_and_short_na(self):
        self.assert_error("motion_dtype", lambda: check_motion([[[0.0]*3 for _ in range(125)]]))
        m = motion(5)
        values = wrist_metrics(m)
        self.assertEqual(values["wrist_path"]["13"], 4)
        self.assertEqual(values["wrist_speed_per_second"]["13"], 30)
        self.assertEqual(values["wrist_jerk_per_second_cubed"]["13"], 0)
        self.assertIsNone(wrist_metrics(motion(3))["wrist_jerk_per_second_cubed"]["13"])

    def test_all_refs_macro_failures_and_zero_denominator(self):
        m = self.setup(count=2, words=2)
        def generate(word, seed, sampling):
            if word == m["selected"][0]["word_id"] and seed == 19:
                raise RuntimeError("synthetic failure")
            return {"tokens": [seed % 512] * 6, "motion": motion(12, seed - 17, False), "fps": 30}
        rows, recon, summary = evaluate_frozen(m, self.selection, self.data, generate=generate,
                        decode=lambda tokens: motion(12, 1, False), load_motion=lambda path: motion(12, 0, False))
        self.assertEqual((summary["attempted"], summary["successes"], summary["failures"]), (6, 5, 1))
        self.assertEqual(summary["complete_word_count"], 1)
        self.assertEqual(summary["reference_reconstruction"]["count"], 4)
        self.assertEqual(summary["reference_reconstruction"]["dtw"]["mean"], 1)
        self.assertEqual(rows[0]["reference_count"], 2)
        self.assertEqual(summary["wrist"]["13"]["zero_reference_path_count"], 10)
        self.assertIsNone(summary["wrist"]["13"]["path_ratio"]["mean"])
        self.assertEqual(summary["failure_codes"], {"RuntimeError": 1})
        self.assertEqual(summary["eos_telemetry"], "unmeasured")

    def test_rng_isolation(self):
        random.seed(123)
        before = random.getstate()
        with isolated_rng(17):
            random.random()
        self.assertEqual(random.getstate(), before)

    def test_bad_generation_is_counted_without_dropping_attempt(self):
        m = self.setup(count=1, words=1)
        rows, _, summary = evaluate_frozen(m, self.selection, self.data,
                generate=lambda word, seed, cfg: {"tokens": [1], "motion": motion(), "fps": 30},
                decode=lambda tokens: motion(), load_motion=lambda path: motion())
        self.assertEqual(summary["attempted"], 3)
        self.assertEqual(summary["failures"], 3)
        self.assertEqual(summary["failure_codes"], {"generated_tokens": 3})
        self.assertIsNone(summary["dtw_macro_complete_words"])

    def test_resource_failure_aborts_instead_of_retrying_90_samples(self):
        m = self.setup(count=1, words=1)
        calls = []
        def exhausted(*args):
            calls.append(args)
            raise MemoryError("invented allocation failure")
        with self.assertRaises(MemoryError):
            evaluate_frozen(m, self.selection, self.data, generate=exhausted,
                            decode=lambda tokens: motion(), load_motion=lambda path: motion())
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
