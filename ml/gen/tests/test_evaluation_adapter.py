"""Factory contract tests with invented files and a fake loaded generator.

The real tiny Torch/VQ integration check is in test_infer_models.py.
"""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from gen.artifacts import sha256_file
from gen.evaluation_adapter import BUNDLE_ENV, SAMPLING, factory


class Model:
    def eval(self):
        return self


class FakeGenerator:
    kind = "word_gpt"

    def __init__(self, vq_hash):
        self._adapter = SimpleNamespace(
            checkpoint={"kind": "gpt", "generation_signer": "REAL01", "nb_code": 8},
            decoder_config={"nb_code": 8, "parts": "body_hand", "vq_version": "fixture-v1"},
            decoder=SimpleNamespace(quantizer=SimpleNamespace(nb_code=8), down=4, parts="body_hand", eval=Model().eval),
            model=Model(), manifest={"vq_sha256": vq_hash, "down": 4, "parts": "body_hand"})
        self.connection_policy = {**SAMPLING, "checkpoint_generation_signer": "REAL01", "max_len": 5}
        self.calls = []

    def generate_word_id(self, word, seed):
        self.calls.append(("generate", word, seed))
        return {"fps": 30, "motion": "invented motion", "tokens": [1, 2], "unknown": [], "source": "model"}

    def decode_reference_tokens(self, tokens):
        self.calls.append(("decode", tokens))
        return "invented reconstruction"


class EvaluationAdapterTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.checkpoint = self.root / "best.pt"
        self.checkpoint.write_bytes(b"invented checkpoint")
        self.vq_dir = self.root / "vq"
        self.vq_dir.mkdir()
        self.vq = self.vq_dir / "model.pt"
        self.vq.write_bytes(b"invented VQ")
        (self.vq_dir / "config.json").write_text(json.dumps(
            {"nb_code": 8, "parts": "body_hand", "vq_version": "fixture-v1"}), encoding="utf-8")
        self.config = {"schema_version": 1, "kind": "word_gpt", "data_mode": "smoke",
                       "vocab_map": "vocab_map.json", "generator_checkpoint": "../best.pt",
                       "generator_sha256": sha256_file(self.checkpoint), "vq_checkpoint": "../vq/model.pt",
                       "vq_version": "fixture-v1", "sampling": dict(SAMPLING),
                       "expected_generation_signer": "REAL01", "blend": 0, "max_words": 1}
        self.save_config()
        self.generator = FakeGenerator(sha256_file(self.vq))
        self.env = patch.dict(os.environ, {BUNDLE_ENV: str(self.bundle)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def save_config(self):
        (self.bundle / "generator.json").write_text(json.dumps(self.config), encoding="utf-8")

    def make(self):
        with patch("gen.evaluation_adapter._load_generator", return_value=self.generator):
            return factory(self.checkpoint, self.vq, "cpu")

    def test_factory_exposes_a_fields_and_delegates_exact_sampling(self):
        adapter = self.make()
        for field in ("checkpoint", "decoder_info", "model", "decoder_model", "generate", "decode"):
            self.assertTrue(hasattr(adapter, field), field)
        adapter.model.eval()
        adapter.decoder_model.eval()
        self.assertIs(adapter.checkpoint, self.generator._adapter.checkpoint)
        self.assertIs(adapter.model, self.generator._adapter.model)
        self.assertIs(adapter.decoder_model, self.generator._adapter.decoder)
        self.assertEqual(adapter.decoder_info, {"nb_code": 8, "down": 4, "parts": "body_hand"})
        sampling = {**SAMPLING, "seeds": [17, 18, 19], "fps": 30}
        self.assertEqual(adapter.generate("WORD1", 17, sampling)["tokens"], [1, 2])
        self.assertEqual(adapter.decode([0, 1]), "invented reconstruction")
        self.assertEqual(self.generator.calls, [("generate", "WORD1", 17), ("decode", [0, 1])])
        with self.assertRaisesRegex(ValueError, "sampling mismatch"):
            adapter.generate("WORD1", 17, {**sampling, "top_k": 11})
        self.assertEqual(len(self.generator.calls), 2)

    def test_wrong_cli_paths_and_hash_are_rejected_before_load(self):
        other = self.root / "other.pt"
        other.write_bytes(b"other")
        with patch("gen.evaluation_adapter._load_generator", side_effect=AssertionError("must not load")):
            with self.assertRaisesRegex(ValueError, "checkpoint path differs"):
                factory(other, self.vq, "cpu")
            with self.assertRaisesRegex(ValueError, "E5 path differs"):
                factory(self.checkpoint, other, "cpu")
            self.checkpoint.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "checkpoint hash differs"):
                factory(self.checkpoint, self.vq, "cpu")

    def test_bundle_sampling_and_loaded_e5_config_mismatch_are_rejected(self):
        self.config["sampling"]["top_k"] = 11
        self.save_config()
        with self.assertRaisesRegex(ValueError, "sampling mismatch"):
            self.make()
        self.config["sampling"]["top_k"] = 10
        self.save_config()
        self.generator._adapter.decoder_config["nb_code"] = 9
        with self.assertRaisesRegex(ValueError, "sidecar differs"):
            self.make()

    def test_loaded_sampling_and_provenance_are_checked(self):
        self.generator.connection_policy["top_k"] = 11
        with self.assertRaisesRegex(ValueError, "loaded sampling differs"):
            self.make()
        self.generator.connection_policy["top_k"] = 10
        self.generator._adapter.manifest["vq_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            self.make()


if __name__ == "__main__":
    unittest.main()
