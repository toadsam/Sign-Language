"""Invented metadata/logits only; no coordinates, model generation or training."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from gen.artifacts import sha256_file
from gen.diagnose_gpt import aggregate, prepare_manifest, run_diagnostic, stage, stored_generation_stats
from gen.evaluate import EvaluationError, make_manifest
from gen import evaluation_spec as S
from gen.tests.test_evaluation import EvaluationFixture


class DiagnosticTests(EvaluationFixture):
    def diagnostic(self):
        for i in range(6):
            self.add("WORD0000", "REAL01", f"extra{i}")
        original = self.setup(count=30, words=61)
        paths = dict(self.paths)
        for name in ("original_manifest", "stored_samples"):
            paths[name] = self.root / f"{name}.json"
            paths[name].write_text("{}", encoding="utf-8")
        with patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])):
            diagnostic = prepare_manifest(self.selection, self.checkpoint, paths, original)
        return diagnostic

    def test_cohorts_all_refs_train_cap_and_derangement_are_frozen(self):
        d = self.diagnostic()
        old, extra = d["cohorts"]["original30"]["words"], d["cohorts"]["extra30"]["words"]
        self.assertEqual((len(old), len(extra), len(set(old) & set(extra))), (30, 30, 0))
        self.assertTrue(all(w != wrong for w, wrong in d["derangement"].items()))
        self.assertEqual(set(d["derangement"]), set(d["derangement"].values()))
        self.assertEqual(len(d["records"]["val"]), 120)
        self.assertTrue(all("TEST" not in row["clip"] for split in d["records"].values() for row in split))
        self.assertTrue(all(v["train_selected"] <= 4 for v in d["distribution"].values()))
        if "WORD0000" in d["distribution"]:
            self.assertEqual(d["distribution"]["WORD0000"]["train_selected"], 4)
        self.selection.train.reverse()
        self.selection.partitions["val"].reverse()
        with patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])):
            repeated = prepare_manifest(self.selection, self.checkpoint,
                                        {k: v["path"] for k, v in d["inputs"].items()}, self.manifest)
        self.assertEqual(d, repeated)

    def test_wrong_mapping_and_original_reference_change_are_rejected(self):
        self.setup(count=30, words=61)
        original = copy.deepcopy(self.manifest)
        original["selected"][0]["references"].pop()
        with patch("gen.evaluate.BEST_SHA256", sha256_file(self.paths["checkpoint"])):
            with self.assertRaisesRegex(ValueError, "original_cohort"):
                prepare_manifest(self.selection, self.checkpoint, self.paths, original)
            swapped = copy.deepcopy(self.checkpoint)
            keys = list(swapped["classes"])
            swapped["classes"][keys[0]], swapped["classes"][keys[1]] = swapped["classes"][keys[1]], swapped["classes"][keys[0]]
            with self.assertRaisesRegex(ValueError, "classes"):
                prepare_manifest(self.selection, swapped, self.paths, self.manifest)

    def test_metric_sign_macro_and_allowlist(self):
        d = self.diagnostic()
        def scorer(rows, split, wrong):
            return [{"word_id": row["item"], "clip": row["clip"], "split": split,
                "alignment_verified": True, "positions": [
                    {"stage": stage(p, len(row["tokens"])), "nll_correct": 1.0, "nll_wrong": 3.0,
                     "top1_correct": 1, "top5_correct": 1, "top1_wrong": 0, "top5_wrong": 0, "top1_changed": 1}
                    for p in range(len(row["tokens"])+1)]} for row in rows]
        rows = run_diagnostic(d, self.selection, scorer)
        summary = aggregate(rows)
        self.assertEqual(summary["val/original30/all"]["word_macro"]["nll_correct"], 1)
        self.assertEqual(summary["val/original30/all"]["delta_NLL_wrong_minus_correct_tokens"]["mean"], 2)
        self.assertEqual(summary["val/original30/END"]["words"], 30)
        bad = copy.deepcopy(d)
        bad["records"]["val"][0]["clip"] = self.selection.partitions["test"][0]["clip"]
        with self.assertRaisesRegex(ValueError, "diagnostic_allowlist"):
            run_diagnostic(bad, self.selection, scorer)

    def test_stored90_analysis_requires_every_original_seed(self):
        d = self.diagnostic()
        rows = [{"word_id": word, "seed": seed, "status": "ok", "tokens": [1, 1, 2, 3]}
                for word in d["cohorts"]["original30"]["words"] for seed in (17, 18, 19)]
        stats = stored_generation_stats(rows, d)
        self.assertEqual(stats["samples"], 90)
        self.assertEqual(stats["new_generation_calls"], 0)
        self.assertAlmostEqual(stats["adjacent_repeat_fraction"]["mean"], 1/3)
        with self.assertRaisesRegex(ValueError, "stored_samples"):
            stored_generation_stats(rows[:-1], d)

    def test_resume_and_warm_start_cli_are_exclusive_before_torch_import(self):
        cmd = [sys.executable, "-B", "-m", "gen.train_word", "--model", "gpt", "--tokens", "unused",
               "--data", "unused", "--run", "unused", "--resume", "--warm-start", "unused"]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=Path(__file__).resolve().parents[2])
        self.assertEqual(result.returncode, 2)
        self.assertIn("not allowed", result.stderr)


class EvaluationSpecTests(EvaluationFixture):
    def test_explicit_candidate_registration_and_fixed_cohort(self):
        self.setup(count=30, words=31)
        old = self.manifest
        parent_sha = sha256_file(self.paths["checkpoint"])
        child_path = self.root/"candidate.pt"
        child_path.write_bytes(b"invented candidate")
        models = {"parent": {"path": str(self.paths["checkpoint"]), "sha256": parent_sha, "expected_step": 2280, "parent_sha256": None},
                  "pilot": {"path": str(child_path), "sha256": sha256_file(child_path), "expected_step": 2, "parent_sha256": parent_sha}}
        diagnostic = {"inputs": {k: {"sha256": sha256_file(v)} for k, v in self.paths.items()},
                      "sampling": {"top_k": 10, "temperature": 1.0, "min_len": 2, "signer": "REAL01", "seeds": [17,18,19]},
                      "cohorts": {"original30": {"words": [x["word_id"] for x in old["selected"]],
                           "references": {x["word_id"]: [r["clip"] for r in x["references"]] for x in old["selected"]}}}}
        with patch.object(S, "PARENT_SHA256", parent_sha), patch.object(S, "E5_SHA256", sha256_file(self.paths["vq"])), \
                patch.object(S, "E5_CONFIG_SHA256", sha256_file(self.paths["vq_config"])):
            spec = S.build_spec(diagnostic, models, "original30")
            child = copy.deepcopy(self.checkpoint)
            child.update(checkpoint_schema_version=1, checkpoint_type="inference", global_step=2, parent_provenance={"sha256": parent_sha})
            paths = {**self.paths, "checkpoint": child_path}
            manifest = make_manifest(self.selection, child, paths, evaluation_spec=spec, model_key="pilot")
            self.assertEqual(manifest["selected"], old["selected"])
            self.assertEqual(manifest["registered_model"]["parent_sha256"], parent_sha)
            old["reference_sha256"] = manifest["reference_sha256"] = {"invented": "same"}
            summary = {"attempted": 90, "successes": 90, "failures": 0, "complete_word_count": 30,
                       "dtw_macro_complete_words": 3.0, "wrist": {w: {m: {"mean": 1.0} for m in
                       ("path", "speed_per_second", "jerk_per_second_cubed")} for w in ("13", "34")}}
            candidate_summary = {**summary, "dtw_macro_complete_words": 2.0}
            comparison = S.compare_runs(old, summary, manifest, candidate_summary)
            self.assertEqual(comparison["metrics"]["dtw_macro"]["candidate_minus_parent"], -1)
            self.assertIsNone(comparison["automatic_improvement_verdict"])
            changed = copy.deepcopy(manifest)
            changed["sampling"]["top_k"] = 1
            with self.assertRaisesRegex(ValueError, "cohort"):
                S.compare_runs(old, summary, changed, candidate_summary)
            child["global_step"] = 3
            with self.assertRaisesRegex(ValueError, "step"):
                make_manifest(self.selection, child, paths, evaluation_spec=spec, model_key="pilot")
            with self.assertRaises(EvaluationError):
                make_manifest(self.selection, child, paths)  # default best-only gate remains

    def test_formal_spec_adapter_validates_registered_child_without_editing_b(self):
        self.setup(count=30, words=30)
        b_source = Path(__file__).resolve().parents[2]/"gen/evaluation_adapter.py"
        if not b_source.is_file():
            b_source = Path(__file__).resolve().parents[4]/"Sign-Language-inference/ml/gen/evaluation_adapter.py"
        if not b_source.is_file():
            self.skipTest("B source unavailable")
        b_spec = importlib.util.spec_from_file_location("gen.evaluation_adapter", b_source)
        b_module = importlib.util.module_from_spec(b_spec)
        b_spec.loader.exec_module(b_module)
        source = Path(__file__).resolve().parents[1]/"spec_adapter.py"
        parent_sha = sha256_file(self.paths["checkpoint"])
        child_path = self.root/"candidate.pt"
        child_path.write_bytes(b"candidate bytes")
        child = copy.deepcopy(self.checkpoint)
        child.update(checkpoint_schema_version=1, checkpoint_type="inference", global_step=2,
                     parent_provenance={"sha256": parent_sha})
        spec = {"schema_version": 1, "shared_input_sha256": {k: sha256_file(self.paths[k]) for k in S.SHARED_INPUTS},
                "cohort": {"name": "original30", "words": [v["word_id"] for v in self.manifest["selected"]],
                    "references": {v["word_id"]: [r["clip"] for r in v["references"]] for v in self.manifest["selected"]}},
                "sampling": {**b_module.SAMPLING, "seeds": [17,18,19]},
                "models": {"pilot": {"path": str(child_path), "sha256": sha256_file(child_path), "expected_step": 2,
                                     "parent_sha256": parent_sha}}}
        spec_path = self.root/"spec.json"
        spec_path.write_text(json.dumps(spec), encoding="utf-8")
        bundle = self.root/"bundle"
        bundle.mkdir()
        config = {"schema_version": 1, "kind": "word_gpt", "data_mode": "formal", "vq_version": "v0.3-e5",
                  "sampling": b_module.SAMPLING, "expected_generation_signer": "REAL01", "blend": 0, "max_words": 1,
                  "generator_checkpoint": str(child_path), "generator_sha256": sha256_file(child_path),
                  "vq_checkpoint": str(self.paths["vq"])}
        (bundle/"generator.json").write_text(json.dumps(config), encoding="utf-8")
        decoder = SimpleNamespace(quantizer=SimpleNamespace(nb_code=512), down=4, parts="body_hand")
        core = SimpleNamespace(checkpoint=child, model="fake model", decoder=decoder,
            decoder_config=json.loads(self.paths["vq_config"].read_text(encoding="utf-8")),
            manifest={"vq_sha256": sha256_file(self.paths["vq"]), "vq_version": "v0.3-e5"})
        generator = SimpleNamespace(_adapter=core, connection_policy={**b_module.SAMPLING,
                    "max_len": 54, "checkpoint_generation_signer": "REAL01"})
        with patch.dict(sys.modules, {"gen.evaluation_adapter": b_module}), \
                patch.object(S, "PARENT_SHA256", parent_sha), \
                patch.object(S, "E5_SHA256", sha256_file(self.paths["vq"])), \
                patch.object(S, "E5_CONFIG_SHA256", sha256_file(self.paths["vq_config"])), \
                patch.dict(os.environ, {"GEN_EVALUATION_SPEC": str(spec_path), "GEN_EVALUATION_MODEL": "pilot",
                                        "GEN_EVALUATION_BUNDLE": str(bundle)}):
            loader = importlib.util.spec_from_file_location("gen._test_spec_adapter", source)
            adapter_module = importlib.util.module_from_spec(loader)
            loader.loader.exec_module(adapter_module)
            with patch.object(adapter_module, "_load_generator", return_value=generator):
                result = adapter_module.factory(child_path, self.paths["vq"], "cpu")
                self.assertIs(result.checkpoint, child)
                child["global_step"] = 9
                with self.assertRaisesRegex(ValueError, "step"):
                    adapter_module.factory(child_path, self.paths["vq"], "cpu")


if __name__ == "__main__":
    unittest.main()
