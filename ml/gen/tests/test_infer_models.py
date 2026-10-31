"""Real CPU inference with tiny A-trained synthetic GPT/regression/VQ artifacts.

All arrays and weights live in this test's temporary directories. Formal here
means the formal selection policy on invented data, never receipt of real E5.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from gen.infer import Generator
from gen.tests.test_infer_baseline import make_meta, write_json, write_metas

HAS_TORCH = importlib.util.find_spec("torch") is not None
if HAS_TORCH:
    import torch
    from gen.artifacts import sha256_file
    from gen.data import select_data
    from gen.training import TrainingConfig, train
    from vq.model import MotionVQVAE


@unittest.skipUnless(HAS_TORCH, "Torch absent: actual word adapter inference NOT verified")
class WordModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.previous_threads = torch.get_num_threads()
        torch.set_num_threads(1)
        cls.addClassCleanup(torch.set_num_threads, cls.previous_threads)
        cls.fixture_temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.fixture_temp.cleanup)
        cls.fixture_root = Path(cls.fixture_temp.name)
        vq_config = {"width": 8, "code_dim": 4, "nb_code": 8, "depth": 1,
                     "parts": "body_hand", "vq_version": "fixture-v1"}
        decoder = MotionVQVAE(width=8, code_dim=4, nb_code=8, depth=1, parts="body_hand")
        with torch.no_grad():
            decoder.quantizer.codebook.normal_()
            decoder.rest[165:] = 0.25
        cls.vq_path = cls.fixture_root / "vq.pt"
        torch.save({"config": vq_config, "model": decoder.state_dict()}, cls.vq_path)
        metas = [make_meta("WORD1", gloss=["가"]), make_meta("WORD2", gloss=["나"]),
                 make_meta("WORD1", "VAL", gloss=["가"]), make_meta("WORD1", "TEST", gloss=["가"])]
        write_metas(cls.fixture_root, metas)
        split_path, tokens_path = cls.fixture_root / "split.json", cls.fixture_root / "tokens.json"
        write_json(split_path, {"mode": "signer", "signers": {
            "train": ["TRAIN"], "val": ["VAL"], "test": ["TEST"]}, "exclude": {"clips": []}})
        write_json(tokens_path, {"nb_code": 8, "down": 4, "vq_version": "fixture-v1", "clips": {
            m["clip"]: {"item": m["item"], "signer": m["signer"], "type": "WORD",
                         "frames": [2, 14], "tokens": [0, 1, 7]} for m in metas}})
        (cls.fixture_root / "npy").mkdir()
        for meta in metas:
            if meta["signer"] != "TEST":
                x = np.arange(20 * 375, dtype=np.float32).reshape(20, 125, 3) / 7500
                np.save(cls.fixture_root / "npy" / f"{meta['clip']}.npy", x)
        cls.trained = {}
        for mode in ("smoke", "formal"):
            selection = select_data(tokens_path, cls.fixture_root / "meta.jsonl", split_path, mode=mode)
            for kind in ("gpt", "regress"):
                run = cls.fixture_root / f"{kind}-{mode}"
                train(selection, run, kind=kind,
                    config=TrainingConfig(iters=4, batch=2, d=8, layers=1, length=6, max_len=5,
                                          device="cpu", seed=17, eval_every=1, save_every=1),
                    data_dir=cls.fixture_root, vq_path=cls.vq_path, vq_version="fixture-v1")
                cls.trained[("word_" + kind, mode)] = run
        # Null-condition GPT for guidance; kind stays word_gpt in the bundle.
        cls.trained[("word_gpt_cond", "smoke")] = cls.fixture_root / "gpt-cond"
        train(select_data(tokens_path, cls.fixture_root / "meta.jsonl", split_path, mode="smoke"),
              cls.trained[("word_gpt_cond", "smoke")], kind="gpt",
              config=TrainingConfig(iters=4, batch=2, d=8, layers=1, max_len=5, device="cpu", seed=17,
                                    eval_every=1, save_every=1, cond_every=True, cond_drop=0.5),
              vq_path=cls.vq_path, vq_version="fixture-v1")
        # "No signer" GPT: the null signer is an ordinary dictionary entry and the saved generation signer.
        cls.trained[("word_gpt_nosigner", "smoke")] = cls.fixture_root / "gpt-nosigner"
        train(select_data(tokens_path, cls.fixture_root / "meta.jsonl", split_path, mode="smoke"),
              cls.trained[("word_gpt_nosigner", "smoke")], kind="gpt",
              config=TrainingConfig(iters=4, batch=2, d=8, layers=1, max_len=5, device="cpu", seed=17,
                                    eval_every=1, save_every=1, cond_every=True, cond_drop=0.5, signer_drop=0.3),
              vq_path=cls.vq_path, vq_version="fixture-v1")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root, self.counter = Path(self.temporary.name), 0

    def bundle(self, kind="word_gpt", mode="smoke", source=None, **changes):
        self.counter += 1
        run = self.root / f"run-{self.counter}"
        run.mkdir()
        (run / "model.pt").write_bytes((self.trained[(source or kind, mode)] / "model.pt").read_bytes())
        (run / "vq.pt").write_bytes(self.vq_path.read_bytes())
        write_json(run / "vocab_map.json", {"schema_version": 1, "mapping": {"가": "WORD1", "나": "WORD2"},
                                            "unmapped": ["미등록"], "ambiguous": {"모호": ["WORD3", "WORD4"]}})
        config = {"schema_version": 1, "kind": kind, "data_mode": mode,
            "generator_checkpoint": "model.pt", "generator_sha256": sha256_file(run / "model.pt"),
            "vq_checkpoint": "vq.pt", "vq_version": "fixture-v1", "vocab_map": "vocab_map.json",
            "sampling": {"top_k": 3, "temperature": 1.0, "signer": "TRAIN"}}
        config.update(changes)
        write_json(run / "generator.json", config)
        return run, config

    def checkpoint(self, run):
        return torch.load(run / "model.pt", map_location="cpu", weights_only=True)

    def save_checkpoint(self, run, checkpoint):
        torch.save(checkpoint, run / "model.pt")
        config = json.loads((run / "generator.json").read_text(encoding="utf-8"))
        config["generator_sha256"] = sha256_file(run / "model.pt")
        write_json(run / "generator.json", config)

    def assert_motion(self, result):
        self.assertEqual(set(result), {"fps", "motion", "tokens", "unknown", "source"})
        self.assertEqual(result["fps"], 30)
        self.assertEqual(result["source"], "model")
        self.assertEqual(result["motion"].dtype, np.float32)
        self.assertEqual(result["motion"].shape[1:], (125, 3))
        self.assertTrue(np.isfinite(result["motion"]).all())

    def test_both_a_trained_models_load_and_generate_real_motion(self):
        for kind in ("word_gpt", "word_regress"):
            with self.subTest(kind=kind):
                run, _ = self.bundle(kind)
                generator = Generator(run)
                result = generator.generate(["가", "나"], seed=3)
                self.assert_motion(result)
                self.assertEqual(result["unknown"], [])
                self.assertFalse(generator._adapter.model.training)
                self.assertFalse(generator._adapter.decoder.training)
                self.assertFalse(generator.connection_policy["sentence_model"])
                if kind == "word_gpt":
                    self.assertTrue(all(type(t) is int and 0 <= t < 8 for t in result["tokens"]))
                    self.assertEqual(len(result["motion"]), len(result["tokens"]) * 4)
                    np.testing.assert_array_equal(result["motion"][:, 55:], 0.25)
                else:
                    self.assertEqual(result["motion"].shape, (12, 125, 3))
                    self.assertEqual(result["tokens"], [])

    def test_formal_synthetic_models_work_without_enabling_smoke(self):
        for kind in ("word_gpt", "word_regress"):
            run, config = self.bundle(kind, mode="formal")
            config.pop("data_mode")  # Formal is the deployment default.
            write_json(run / "generator.json", config)
            generator = Generator(run)
            self.assertEqual(generator.connection_policy["data_mode"], "formal")
            self.assert_motion(generator.generate(["가"], seed=5))

    def test_mixed_unknown_and_repeated_word_order_are_preserved(self):
        for kind in ("word_gpt", "word_regress"):
            run, _ = self.bundle(kind)
            generator = Generator(run)
            adapter = generator._adapter
            method = "generate" if kind == "word_gpt" else "forward"
            with patch.object(adapter.model, method, wraps=getattr(adapter.model, method)) as sample:
                mixed = generator.generate(["나", "미등록", "가", "모호", "나", "미등록"], seed=7)
            self.assertEqual([int(call.args[0][0]) for call in sample.call_args_list], [1, 0, 1])
            self.assertEqual(mixed["unknown"], ["미등록", "모호", "미등록"])
            clean = generator.generate(["나", "가", "나"], seed=7)
            np.testing.assert_array_equal(mixed["motion"], clean["motion"])
            self.assertEqual(mixed["tokens"], clean["tokens"])

    def test_all_unknown_never_calls_model_and_returns_empty_model_result(self):
        for kind in ("word_gpt", "word_regress"):
            run, _ = self.bundle(kind)
            generator = Generator(run)
            with patch.object(generator._adapter, "_word", side_effect=AssertionError("no known words")):
                result = generator.generate(["미등록", "모호", "미등록"])
            self.assert_motion(result)
            self.assertEqual(result["motion"].shape, (0, 125, 3))
            self.assertEqual(result["tokens"], [])
            self.assertEqual(result["unknown"], ["미등록", "모호", "미등록"])

    def test_empty_and_malformed_requests_remain_errors(self):
        run, _ = self.bundle()
        generator = Generator(run)
        for words in ([], "가", [""], [" "], [1]):
            with self.subTest(words=words), self.assertRaises(ValueError):
                generator.generate(words)
        for seed in (True, -1, 2**63, 1.5):
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                generator.generate(["가"], seed=seed)

    def test_regressor_does_not_decode_tokens_and_ignores_nonmanual(self):
        run, _ = self.bundle("word_regress")
        generator = Generator(run)
        with patch.object(generator._adapter.decoder, "decode", side_effect=AssertionError("regression is not VQ")):
            plain = generator.generate(["가"], seed=1)
            tagged = generator.generate(["가"], nonmanual=["의문"], seed=2)
        np.testing.assert_array_equal(plain["motion"], tagged["motion"])
        self.assertEqual(generator.supported_nonmanual, ())
        self.assertFalse(generator.connection_policy["nonmanual_supported"])

    def test_gpt_nonmanual_is_not_a_condition(self):
        run, _ = self.bundle()
        generator = Generator(run)
        plain = generator.generate(["가"], seed=1)
        tagged = generator.generate(["가"], nonmanual=["의문", "부정"], seed=1)
        np.testing.assert_array_equal(plain["motion"], tagged["motion"])
        self.assertEqual(plain["tokens"], tagged["tokens"])

    def test_same_seed_reproduces_across_other_requests_and_instances(self):
        run, _ = self.bundle()
        first = Generator(run)
        expected = first.generate(["나", "가"], seed=42)
        first.generate(["가"])
        first.generate(["나"], seed=99)
        actual = first.generate(["나", "가"], seed=42)
        other = Generator(run).generate(["나", "가"], seed=42)
        self.assertEqual(expected["tokens"], actual["tokens"])
        self.assertEqual(expected["tokens"], other["tokens"])
        np.testing.assert_array_equal(expected["motion"], actual["motion"])
        np.testing.assert_array_equal(expected["motion"], other["motion"])

    def test_startup_and_calls_leave_caller_rng_states_unchanged(self):
        run, _ = self.bundle()
        python_state, numpy_state, cpu_state = random.getstate(), np.random.get_state(), torch.get_rng_state().clone()
        generator = Generator(run)
        generator.generate(["가"], seed=6)
        generator.generate(["나"])
        generator.generate(["가"], seed=7)
        self.assertEqual(random.getstate(), python_state)
        after = np.random.get_state()
        self.assertEqual(numpy_state[0], after[0])
        np.testing.assert_array_equal(numpy_state[1], after[1])
        self.assertEqual(numpy_state[2:], after[2:])
        self.assertTrue(torch.equal(cpu_state, torch.get_rng_state()))

    def test_unseeded_gpt_requests_do_not_repeat_a_reset_seed(self):
        run, _ = self.bundle(sampling={"top_k": 0, "temperature": 1.0})
        generator = Generator(run)
        # Flat learned logits make the test independent of tiny-run convergence.
        with torch.no_grad():
            generator._adapter.model.head.weight.zero_()
            generator._adapter.model.head.bias.zero_()
        streams = {tuple(generator.generate(["가"])["tokens"]) for _ in range(12)}
        self.assertGreater(len(streams), 1)

    def test_seeded_calls_do_not_advance_the_unseeded_stream(self):
        run, _ = self.bundle()
        with patch("gen.infer_models.secrets.randbits", return_value=12345):
            first, control = Generator(run), Generator(run)
        self.assertEqual(first.generate(["가"])["tokens"], control.generate(["가"])["tokens"])
        first.generate(["나"], seed=7)
        first.generate(["가"], seed=8)
        self.assertEqual(first.generate(["나"])["tokens"], control.generate(["나"])["tokens"])

    def test_parallel_seeded_requests_are_isolated_across_instances(self):
        run, _ = self.bundle()
        first, second = Generator(run), Generator(run)
        expected = first.generate(["가", "나"], seed=123)
        before = torch.get_rng_state().clone()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(g.generate, ["가", "나"], seed=123) for g in (first, second)]
            results = [future.result(timeout=10) for future in futures]
        for result in results:
            self.assertEqual(result["tokens"], expected["tokens"])
            np.testing.assert_array_equal(result["motion"], expected["motion"])
        self.assertTrue(torch.equal(before, torch.get_rng_state()))

    def test_sampling_failure_restores_caller_rng_state(self):
        run, _ = self.bundle()
        generator = Generator(run)

        def fail(*args, **kwargs):
            torch.rand(17)
            raise RuntimeError("synthetic sampling failure")

        before = torch.get_rng_state().clone()
        with patch.object(generator._adapter.model, "generate", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "sampling failure"):
                generator.generate(["가"], seed=7)
        self.assertTrue(torch.equal(before, torch.get_rng_state()))

    def test_requests_run_in_inference_mode_and_on_selected_device(self):
        for kind in ("word_gpt", "word_regress"):
            run, _ = self.bundle(kind)
            generator = Generator(run, device="cpu")
            adapter, observed = generator._adapter, []
            original = adapter.model.forward

            def forward(*args, **kwargs):
                observed.append((torch.is_inference_mode_enabled(), torch.is_grad_enabled(), args[0].device.type))
                return original(*args, **kwargs)

            with patch.object(adapter.model, "forward", side_effect=forward):
                generator.generate(["가"], seed=1)
            self.assertTrue(observed)
            self.assertTrue(all(flag and not grad and dev == "cpu" for flag, grad, dev in observed))

    def test_models_and_decoders_are_loaded_once_not_per_request(self):
        run, _ = self.bundle()
        generator = Generator(run)
        with patch("torch.load", side_effect=AssertionError("request must not load checkpoints")):
            self.assert_motion(generator.generate(["가", "나"], seed=1))
            self.assert_motion(generator.generate(["나"], seed=2))

    def test_relative_paths_load_after_changing_working_directory(self):
        run, _ = self.bundle()
        previous = os.getcwd()
        try:
            os.chdir(self.root)
            self.assert_motion(Generator(run).generate(["가"], seed=1))
        finally:
            os.chdir(previous)

    def test_recovery_files_are_rejected_by_name_and_by_a_loader(self):
        run, config = self.bundle()
        (run / "latest.pt").write_bytes((run / "model.pt").read_bytes())
        config["generator_checkpoint"] = "latest.pt"
        write_json(run / "generator.json", config)
        with self.assertRaisesRegex(ValueError, "recovery"):
            Generator(run)
        run, _ = self.bundle()
        checkpoint = torch.load(self.trained[("word_gpt", "smoke")] / "latest.pt", weights_only=True)
        self.save_checkpoint(run, checkpoint)
        with self.assertRaisesRegex(ValueError, "inference_required"):
            Generator(run)

    def test_generator_hash_mismatch_is_rejected_before_loading(self):
        run, _ = self.bundle(generator_sha256="0" * 64)
        with patch("gen.infer_models.load_generator", side_effect=AssertionError("hash first")):
            with self.assertRaisesRegex(ValueError, "hash"):
                Generator(run)

    def test_decoder_hash_mismatch_is_rejected_before_decoder_loading(self):
        run, _ = self.bundle()
        with (run / "vq.pt").open("ab") as stream:
            stream.write(b"changed fixture decoder")
        with patch("gen.infer_models.load_vqvae", side_effect=AssertionError("hash first")):
            with self.assertRaisesRegex(ValueError, "hash_mismatch"):
                Generator(run)

    def test_kind_schema_and_missing_manifest_are_rejected(self):
        for kind in ("word_gpt", "word_regress"):
            run, config = self.bundle(kind)
            config["kind"] = "word_regress" if kind == "word_gpt" else "word_gpt"
            write_json(run / "generator.json", config)
            with self.assertRaisesRegex(ValueError, "kind"):
                Generator(run)
        for field, value in (("checkpoint_schema_version", 2), ("artifact_manifest", None)):
            run, _ = self.bundle()
            checkpoint = self.checkpoint(run)
            checkpoint[field] = value
            self.save_checkpoint(run, checkpoint)
            with self.subTest(field=field), self.assertRaises(ValueError):
                Generator(run)

    def test_smoke_and_formal_are_never_automatically_mixed(self):
        for source_mode, requested_mode in (("smoke", "formal"), ("formal", "smoke")):
            run, config = self.bundle(mode=source_mode)
            config["data_mode"] = requested_mode
            write_json(run / "generator.json", config)
            with self.subTest(source_mode=source_mode), self.assertRaises(ValueError):
                Generator(run)

    def test_unsupported_mapping_class_and_untrained_signer_are_rejected(self):
        run, _ = self.bundle()
        vocab = json.loads((run / "vocab_map.json").read_text(encoding="utf-8"))
        vocab["mapping"]["다"] = "WORD999"
        write_json(run / "vocab_map.json", vocab)
        with self.assertRaisesRegex(ValueError, "classes"):
            Generator(run)
        run, _ = self.bundle(sampling={"signer": "VAL"})
        with self.assertRaisesRegex(ValueError, "not trained"):
            Generator(run)
        run, _ = self.bundle()
        checkpoint = self.checkpoint(run)
        checkpoint["generation_signer"] = "TEST"
        self.save_checkpoint(run, checkpoint)
        with self.assertRaisesRegex(ValueError, "not trained"):
            Generator(run)

    def test_invalid_class_or_signer_indices_are_rejected(self):
        for key, value in (("classes", {"WORD1": 1, "WORD2": 2}),
                           ("classes", {"WORD1": 0, "WORD2": False}),
                           ("signers", {"TRAIN": True})):
            run, _ = self.bundle()
            checkpoint = self.checkpoint(run)
            checkpoint[key] = value
            self.save_checkpoint(run, checkpoint)
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                Generator(run)

    def test_manifest_version_dimensions_and_parts_match_actual_decoder(self):
        for field, value in (("vq_version", "wrong-version"), ("nb_code", 9), ("down", 2), ("parts", "all")):
            run, _ = self.bundle()
            checkpoint = self.checkpoint(run)
            checkpoint["artifact_manifest"][field] = value
            self.save_checkpoint(run, checkpoint)
            with self.subTest(field=field), self.assertRaises(ValueError):
                Generator(run)

    def test_actual_decoder_version_and_code_count_cannot_be_hidden_by_rehashing(self):
        for change in ("version", "nb_code", "down"):
            run, _ = self.bundle()
            decoder = torch.load(run / "vq.pt", weights_only=True)
            if change == "version":
                decoder["config"]["vq_version"] = "another-fixture"
            elif change == "down":
                decoder["config"]["down_t"] = 3
            else:
                decoder["config"]["nb_code"] = 4
                model = MotionVQVAE(width=8, code_dim=4, nb_code=4, depth=1, parts="body_hand")
                decoder["model"] = model.state_dict()
            torch.save(decoder, run / "vq.pt")
            checkpoint = self.checkpoint(run)
            checkpoint["artifact_manifest"]["vq_sha256"] = sha256_file(run / "vq.pt")
            self.save_checkpoint(run, checkpoint)
            with self.subTest(change=change), self.assertRaises(ValueError):
                Generator(run)

    def test_tiny_fixture_must_not_claim_to_be_real_e5(self):
        run, config = self.bundle(vq_version="v0.3-e5")
        checkpoint = self.checkpoint(run)
        checkpoint["artifact_manifest"]["vq_version"] = "v0.3-e5"
        self.save_checkpoint(run, checkpoint)
        with self.assertRaisesRegex(ValueError, "documented E5 hash"):
            Generator(run)

    def test_model_limits_reject_before_sampling(self):
        for kind, per_word in (("word_gpt", 20), ("word_regress", 6)):
            run, _ = self.bundle(kind, max_words=2, max_frames=per_word)
            generator = Generator(run)
            with patch.object(generator._adapter, "_word", side_effect=AssertionError("limits first")):
                with self.assertRaisesRegex(ValueError, "max_words"):
                    generator.generate(["unknown"] * 3)
                with self.assertRaisesRegex(ValueError, "max_frames"):
                    generator.generate(["가", "나"])
                self.assertEqual(generator.generate(["unknown"])["motion"].shape, (0, 125, 3))

    def test_invalid_settings_and_missing_required_paths_fail_at_startup(self):
        cases = [{"max_words": True}, {"max_frames": 0}, {"max_frames": 19}, {"blend": -1},
                 {"sampling": []}, {"sampling": {"top_k": -1}}, {"sampling": {"top_k": True}},
                 {"sampling": {"temperature": float("nan")}}, {"sampling": {"temperature": 0}},
                 {"sampling": {"min_len": 6}}, {"data_mode": "automatic"},
                 {"generator_sha256": None}, {"vq_version": ""}]
        for changes in cases:
            run, _ = self.bundle(**changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                Generator(run)
        for field in ("generator_checkpoint", "vq_checkpoint", "generator_sha256", "vocab_map", "vq_version"):
            run, config = self.bundle()
            config.pop(field)
            write_json(run / "generator.json", config)
            with self.subTest(field=field), self.assertRaises(ValueError):
                Generator(run)

    def test_invalid_and_unavailable_devices_are_rejected(self):
        run, _ = self.bundle()
        with self.assertRaisesRegex(ValueError, "invalid_device"):
            Generator(run, device="not-a-device")
        with patch("torch.cuda.is_available", return_value=False):
            with self.assertRaisesRegex(ValueError, "cuda_unavailable"):
                Generator(run, device="cuda")

    def test_nonfinite_wrong_shape_dtype_or_device_output_is_rejected(self):
        for kind in ("word_gpt", "word_regress"):
            run, _ = self.bundle(kind)
            generator = Generator(run)
            adapter = generator._adapter
            frames = 8 if kind == "word_gpt" else 6
            values = [torch.zeros(1, frames, 374), torch.full((1, frames, 375), float("nan")),
                      torch.zeros(1, frames, 375, dtype=torch.float64),
                      torch.empty((1, frames, 375), device="meta")]
            for value in values:
                with self.subTest(kind=kind, shape=value.shape, device=value.device):
                    if kind == "word_gpt":
                        with patch.object(adapter.model, "generate", return_value=[[0, 1]]), \
                                patch.object(adapter.decoder, "decode", return_value=value):
                            with self.assertRaises(ValueError):
                                generator.generate(["가"], seed=1)
                    else:
                        with patch.object(adapter.model, "forward", return_value=value):
                            with self.assertRaises(ValueError):
                                generator.generate(["가"], seed=1)

    def test_model_parameters_and_decoder_buffers_must_stay_on_target_device(self):
        for component in ("model", "decoder"):
            run, _ = self.bundle()
            generator = Generator(run)
            if component == "model":
                generator._adapter.model.to("meta")
            else:
                generator._adapter.decoder.rest = generator._adapter.decoder.rest.to("meta")
            with self.subTest(component=component), self.assertRaisesRegex(ValueError, "device mismatch"):
                generator.generate(["가"], seed=1)

    def test_bad_generated_tokens_are_rejected_before_decode(self):
        run, _ = self.bundle()
        generator = Generator(run)
        adapter = generator._adapter
        for value in ([[]], [[-1, 0]], [[8, 0]], [[True, 0]], [[0] * 6], [[0, 1], [1, 2]], None):
            with self.subTest(value=value), patch.object(adapter.model, "generate", return_value=value), \
                    patch.object(adapter.decoder, "decode", side_effect=AssertionError("validate tokens first")):
                with self.assertRaises(ValueError):
                    generator.generate(["가"])

    def test_guided_medoid_sampling_generates_reproducibly(self):
        run, _ = self.bundle(source="word_gpt_cond", sampling={"top_k": 3, "signer": "TRAIN",
                                                                 "guidance": 2.0, "samples": 4})
        generator = Generator(run)
        adapter = generator._adapter
        self.assertEqual((adapter.model.null, adapter.model.cond_every), (2, True))
        self.assertEqual(generator.connection_policy["pick"], "medoid_body_hands55")
        with patch.object(adapter.model, "generate", wraps=adapter.model.generate) as sample:
            result = generator.generate(["가", "미등록"], seed=11)
        self.assert_motion(result)
        self.assertEqual(result["unknown"], ["미등록"])
        self.assertEqual(len(result["motion"]), len(result["tokens"]) * 4)
        self.assertEqual(sample.call_args.args[0].tolist(), [0, 0, 0, 0])
        self.assertEqual(sample.call_args.kwargs["guidance"], 2.0)
        again = generator.generate(["가", "미등록"], seed=11)
        self.assertEqual(result["tokens"], again["tokens"])
        np.testing.assert_array_equal(result["motion"], again["motion"])

    def test_medoid_returns_the_sample_closest_to_the_others(self):
        run, _ = self.bundle(sampling={"top_k": 3, "signer": "TRAIN", "samples": 3})
        generator = Generator(run)
        adapter = generator._adapter
        fill = {0: 0.0, 2: 0.01, 4: 5.0}  # 0 and 2 agree; 4 is the outlier.
        def decode(indices):
            return torch.full((1, indices.shape[1] * 4, 375), fill[int(indices[0, 0])])
        with patch.object(adapter.model, "generate", return_value=[[4, 5], [2, 3], [0, 1]]), \
                patch.object(adapter.decoder, "decode", side_effect=decode):
            result = generator.generate(["가"], seed=1)
        self.assertIn(result["tokens"], ([2, 3], [0, 1]))
        self.assertNotEqual(float(result["motion"][0, 0, 0]), 5.0)
        with patch.object(adapter.model, "generate", return_value=[[0, 1], [2, 3]]):
            with self.assertRaisesRegex(ValueError, "per sample"):
                generator.generate(["가"], seed=1)

    def test_null_signer_checkpoint_serves_without_adapter_changes(self):
        from gen.training import NULL_SIGNER
        run, config = self.bundle(source="word_gpt_nosigner", sampling={"top_k": 3, "guidance": 2.0, "samples": 2})
        generator = Generator(run)
        adapter = generator._adapter
        self.assertEqual(generator.connection_policy["signer"], NULL_SIGNER)
        with patch.object(adapter.model, "generate", wraps=adapter.model.generate) as sample:
            result = generator.generate(["가"], seed=3)
        self.assert_motion(result)
        self.assertEqual(sample.call_args.args[1].tolist(), [adapter.signers[NULL_SIGNER]] * 2)
        run, _ = self.bundle(source="word_gpt_nosigner", sampling={"top_k": 3, "signer": "TRAIN"})
        self.assertEqual(Generator(run).connection_policy["signer"], "TRAIN")

    def test_guidance_and_samples_settings_are_validated(self):
        cases = [("word_gpt", None, {"guidance": 2.0}),  # no null condition
                 ("word_gpt", "word_gpt_cond", {"guidance": 0}),
                 ("word_gpt", "word_gpt_cond", {"guidance": float("inf")}),
                 ("word_gpt", "word_gpt_cond", {"guidance": "2"}),
                 ("word_gpt", None, {"samples": 0}), ("word_gpt", None, {"samples": 33}),
                 ("word_gpt", None, {"samples": True}), ("word_regress", None, {"samples": 2}),
                 ("word_regress", None, {"guidance": 2.0})]
        for kind, source, sampling in cases:
            run, _ = self.bundle(kind, source=source, sampling=sampling)
            with self.subTest(kind=kind, sampling=sampling), self.assertRaises(ValueError):
                Generator(run)
        run, _ = self.bundle(source="word_gpt_cond", sampling={"guidance": 1})
        self.assertEqual(Generator(run).connection_policy["pick"], "single")

    def test_blend_frames_are_not_misrepresented_as_gpt_tokens(self):
        run, _ = self.bundle(blend=3)
        generator = Generator(run)
        adapter = generator._adapter
        with patch.object(adapter.model, "generate", side_effect=[[[0, 1]], [[2, 3]]]), \
                patch.object(adapter.decoder, "decode", wraps=adapter.decoder.decode) as decode:
            result = generator.generate(["가", "나"], seed=1)
        self.assertEqual(result["tokens"], [0, 1, 2, 3])
        self.assertEqual(result["motion"].shape, (19, 125, 3))
        self.assertEqual(decode.call_count, 2)
        self.assertEqual(generator.connection_policy["decode"], "per_word")
        weights = np.array([0.25, 0.5, 0.75])[:, None, None]
        expected = result["motion"][7] * (1 - weights) + result["motion"][11] * weights
        np.testing.assert_allclose(result["motion"][8:11], expected, atol=1e-7)


if __name__ == "__main__":
    unittest.main()
