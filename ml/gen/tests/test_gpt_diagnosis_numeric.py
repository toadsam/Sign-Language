"""Tiny invented GPT/E5 weights only; real tensor checks require existing deps."""
import importlib.util
import unittest
from unittest.mock import patch


HAS_DEPS = all(importlib.util.find_spec(name) is not None for name in ("numpy", "torch"))


@unittest.skipUnless(HAS_DEPS, "NumPy/Torch absent: warm-start/trace calculations not executed")
class WarmStartTests(unittest.TestCase):
    def setUp(self):
        import torch
        from gen.tests.test_data import Fixture
        from gen.training import TrainingConfig, train
        from gen.artifacts import sha256_file
        from vq.model import MotionVQVAE
        self.torch, self.train = torch, train
        previous = torch.get_num_threads()
        torch.set_num_threads(1)
        self.addCleanup(torch.set_num_threads, previous)
        f = Fixture()
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.root, self.fixture = f.root, f
        f.split["signers"]["train"] = ["REAL01"]
        f.add("WORD_A", "REAL01")
        f.add("WORD_B", "REAL01")
        f.add("WORD_A", "V")
        f.add("WORD_A", "E")
        f.tokens["down"] = 4
        for record in f.tokens["clips"].values():
            record["tokens"] = [0, 1, 7]
        self.selection = f.select()
        self.vq = self.root/"vq.pt"
        decoder = MotionVQVAE(width=8, code_dim=4, nb_code=8, depth=1, parts="body_hand")
        torch.save({"model": decoder.state_dict(), "config": {"width": 8, "code_dim": 4, "nb_code": 8,
                   "depth": 1, "parts": "body_hand"}}, self.vq)
        self.config = TrainingConfig(iters=4, batch=2, d=8, layers=1, max_len=11,
                                    seed=17, device="cpu", eval_every=1, save_every=1)
        from dataclasses import replace
        self.options = {"kind": "gpt", "vq_path": self.vq, "vq_version": "fixture-v1"}
        train(self.selection, self.root/"parent", config=replace(self.config, iters=2), **self.options)
        self.parent = self.root/"parent/model.pt"
        self.parent_sha = sha256_file(self.parent)

    def load(self, run, filename="latest.pt"):
        return self.torch.load(self.root/run/filename, map_location="cpu", weights_only=True)

    def test_warm_start_exact_resume_matches_uninterrupted_and_parent_unchanged(self):
        from gen.artifacts import sha256_file
        args = {**self.options, "config": self.config, "warm_start": self.parent, "parent_sha256": self.parent_sha}
        self.train(self.selection, self.root/"full", **args)
        self.train(self.selection, self.root/"paused", stop_after=2, **args)
        self.train(self.selection, self.root/"paused", resume=True, config=self.config, **self.options)
        a, b = self.load("full"), self.load("paused")
        for key in a["model"]:
            self.assertTrue(self.torch.equal(a["model"][key], b["model"][key]))
        self.assertEqual(a["global_step"], b["global_step"])
        self.assertEqual(a["scheduler"], b["scheduler"])
        self.assertTrue(self.torch.equal(a["rng"]["torch_cpu"], b["rng"]["torch_cpu"]))
        for identity, state in a["optimizer"]["state"].items():
            for field, value in state.items():
                other = b["optimizer"]["state"][identity][field]
                self.assertTrue(self.torch.equal(value, other)) if isinstance(value, self.torch.Tensor) else self.assertEqual(value, other)
        for field in ("python", "numpy", "sampler"):
            self.assertEqual(a["rng"][field], b["rng"][field])
        self.assertEqual(sha256_file(self.parent), self.parent_sha)
        self.parent.write_bytes(b"invented changed parent")
        with self.assertRaisesRegex(ValueError, "warm_start_parent"):
            self.train(self.selection, self.root/"paused", resume=True, config=self.config, **self.options)

    def test_step0_baseline_remains_best_when_every_pilot_validation_worsens(self):
        from gen.training import Trainer, atomic_torch_save
        with patch.object(Trainer, "validate", side_effect=[1.0, 2.0, 3.0, 4.0, 5.0]), \
                patch("gen.training.atomic_torch_save", wraps=atomic_torch_save) as saved:
            result = self.train(self.selection, self.root/"worse", config=self.config,
                    warm_start=self.parent, parent_sha256=self.parent_sha, **self.options)
        step0 = next(call.args[0] for call in saved.call_args_list
                     if call.args[0].get("checkpoint_type") == "recovery" and call.args[0]["global_step"] == 0)
        self.assertEqual(step0["optimizer"]["state"], {})
        self.assertEqual(step0["scheduler"]["total_steps"], 4)
        self.assertEqual(result["best_step"], 0)
        baseline, best = self.load("worse", "baseline.pt"), self.load("worse", "model.pt")
        self.assertEqual(best["artifact_role"], "warm_start_step0")
        self.assertEqual(best["global_step"], 0)
        self.assertEqual(best["parent_provenance"]["sha256"], self.parent_sha)
        for key in baseline["model"]:
            self.assertTrue(self.torch.equal(baseline["model"][key], best["model"][key]))

    def test_wrong_parent_hash_and_resume_conflict_fail_before_new_outputs(self):
        with self.assertRaisesRegex(ValueError, "warm_start_parent"):
            self.train(self.selection, self.root/"bad", config=self.config, warm_start=self.parent,
                       parent_sha256="0"*64, **self.options)
        self.assertFalse((self.root/"bad").exists())
        with self.assertRaisesRegex(ValueError, "initialization_conflict"):
            self.train(self.selection, self.root/"bad", config=self.config, resume=True,
                       warm_start=self.parent, parent_sha256=self.parent_sha, **self.options)

    def test_real_loss_trace_and_condition_swap_use_identical_history(self):
        from gen.training import load_trained_model
        from gen.diagnose_gpt import torch_scorer
        model, checkpoint = load_trained_model(self.parent, "cpu")
        score = torch_scorer(model, checkpoint, self.selection, "cpu")
        wrong = {"WORD_A": "WORD_B", "WORD_B": "WORD_A"}
        for split, rows in (("train", self.selection.train), ("val", self.selection.partitions["val"])):
            values = score(rows, split, wrong)
            self.assertTrue(all(r["alignment_verified"] for r in values))
            self.assertTrue(all(len(r["positions"]) == 4 and r["positions"][-1]["stage"] == "END" for r in values))

    def test_parent_structure_mapping_and_data_mismatch_are_rejected(self):
        import copy
        from dataclasses import replace
        for name, changes in (("width", {"d": 16}), ("layers", {"layers": 2}), ("corrupt", {"corrupt": 0.0})):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "warm_start_mismatch"):
                self.train(self.selection, self.root/name, config=replace(self.config, **changes),
                           warm_start=self.parent, parent_sha256=self.parent_sha, **self.options)
        for field in ("classes", "signers", "split"):
            selection = copy.deepcopy(self.selection)
            if field == "classes":
                selection.classes = {"WORD_A": 1, "WORD_B": 0}
            elif field == "signers":
                selection.signers = {"REAL01": 1}
            else:
                selection.report["sources"]["split_sha256"] = "0"*64
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "warm_start_mismatch"):
                self.train(selection, self.root/field, config=self.config, warm_start=self.parent,
                           parent_sha256=self.parent_sha, **self.options)


if __name__ == "__main__":
    unittest.main()
