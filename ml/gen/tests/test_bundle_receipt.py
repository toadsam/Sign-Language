"""Receipt fixtures are authored here; the decoder boundary is mocked explicitly."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from gen import verify_bundle as bundle
from gen.tests.test_infer_baseline import write_json


def synthetic_tokens(**updates):
    value = {"vq_version": "v0.3-e5", "nb_code": 512, "down": 4, "clips": {
        "WORD1_TRAIN": {"type": "WORD", "item": "WORD1", "signer": "TRAIN",
                          "tokens": [0, 1, 511], "frames": [0, 12]}}}
    value.update(updates)
    return value


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_hash_reference_matches_handoff_document(self):
        # Keep the pinned receipt identifiers synchronized without using real data.
        text = (Path(__file__).resolve().parents[3] / "docs" / "handoff" /
                "jaehun-to-jiheon-e5.md").read_text(encoding="utf-8")
        for name, digest in bundle.KNOWN_SHA256.items():
            with self.subTest(name=name):
                self.assertRegex(digest, r"^[0-9a-f]{64}$")
                self.assertIn(digest, text)

    def test_no_paths_is_pending_not_received(self):
        report = bundle.verify_bundle({})
        self.assertFalse(report["passed"])
        self.assertEqual(report["status"], "pending")
        self.assertEqual(report["errors"], [])
        self.assertTrue(all(v["status"] == "not_supplied" for v in report["files"].values()))
        self.assertEqual(report["decoder"]["status"], "not_run")

    def test_missing_file_differs_from_omitted_and_reports_no_paths(self):
        report = bundle.verify_bundle({"model": self.root / "private_missing.pt"})
        self.assertEqual(report["files"]["model"]["status"], "missing")
        self.assertEqual(report["files"]["tokens"]["status"], "not_supplied")
        self.assertEqual(report["status"], "failed")
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_wrong_hash_never_loads_decoder_or_modifies_original(self):
        model = self.root / "model.pt"
        config = self.root / "config.json"
        model.write_bytes(b"synthetic checkpoint; must never be deserialized")
        write_json(config, {"nb_code": 512, "parts": "body_hand"})
        before = {p: p.read_bytes() for p in (model, config)}
        with patch.object(bundle, "decoder_smoke") as decoder:
            report = bundle.verify_bundle({"model": model, "config": config})
            decoder.assert_not_called()
        self.assertIn({"file": "model", "code": "hash_mismatch"}, report["errors"])
        self.assertEqual(report["files"]["model"]["status"], "hash_mismatch")
        for path, original in before.items():
            self.assertEqual(path.read_bytes(), original)

    def test_version_code_count_down_and_token_range_fail_separately(self):
        cases = [(synthetic_tokens(vq_version="v1"), "version_mismatch"),
                 (synthetic_tokens(nb_code=128), "nb_code_mismatch"),
                 (synthetic_tokens(down=2), "down_mismatch"),
                 (synthetic_tokens(clips={}), "empty_or_invalid_clips")]
        bad_range = synthetic_tokens()
        bad_range["clips"]["WORD1_TRAIN"]["tokens"] = [512, 1, 2]
        cases.append((bad_range, "token_range_invalid"))
        bad_shape = synthetic_tokens()
        bad_shape["clips"]["WORD1_TRAIN"]["frames"] = [0, 8]
        cases.append((bad_shape, "token_frame_shape_invalid"))
        for value, code in cases:
            tokens = self.root / "tokens.json"
            write_json(tokens, value)
            before = tokens.read_bytes()
            with self.subTest(code=code):
                report = bundle.verify_bundle({"tokens": tokens})
                self.assertIn({"file": "tokens", "code": code}, report["errors"])
                self.assertFalse(report["passed"])
                self.assertEqual(tokens.read_bytes(), before)

    def test_invalid_json_reports_safe_format_error(self):
        path = self.root / "bad.json"
        path.write_bytes(b"{not JSON")
        report = bundle.verify_bundle({"tokens": path})
        self.assertIn({"file": "tokens", "code": "invalid_format"}, report["errors"])

    def test_config_nb_code_parts_and_down_checks(self):
        for value, code in (({"nb_code": 128, "parts": "body_hand"}, "nb_code_mismatch"),
                            ({"nb_code": 512, "parts": "all"}, "parts_mismatch"),
                            ({"nb_code": 512, "parts": "body_hand", "down_t": 3}, "down_mismatch")):
            path = self.root / "config.json"
            write_json(path, value)
            with self.subTest(code=code):
                report = bundle.verify_bundle({"config": path})
                self.assertIn({"file": "config", "code": code}, report["errors"])

    def fixture_bundle(self):
        paths = {}
        for name in bundle.KNOWN_SHA256:
            path = self.root / name
            path.write_text("synthetic receipt fixture", encoding="utf-8")
            paths[name] = path
        write_json(paths["tokens"], synthetic_tokens())
        write_json(paths["config"], {"nb_code": 512, "parts": "body_hand"})
        hashes = {name: bundle.digest(path) for name, path in paths.items()}
        sizes = {name: paths[name].stat().st_size for name in bundle.KNOWN_BYTES}
        # This replacement is confined to the test, never offered as a CLI bypass.
        self.addCleanup(patch.stopall)
        patch.object(bundle, "KNOWN_SHA256", hashes).start()
        patch.object(bundle, "KNOWN_BYTES", sizes).start()
        return paths

    def test_matching_fixture_receipt_calls_smoke_and_leaves_full_audit_pending(self):
        paths = self.fixture_bundle()
        before = {name: path.read_bytes() for name, path in paths.items()}
        with patch.object(bundle, "decoder_smoke", return_value={"status": "passed", "shape": [1, 12, 375]}) as smoke:
            report = bundle.verify_bundle(paths)
            smoke.assert_called_once_with(paths["model"], {"nb_code": 512, "parts": "body_hand"})
        self.assertTrue(report["passed"])
        self.assertEqual(report["status"], "receipt_checks_passed")
        self.assertEqual(report["full_audit"]["status"], "not_run")
        self.assertEqual(report["coordinates"], "not_checked")
        self.assertEqual(before, {name: path.read_bytes() for name, path in paths.items()})

    def test_matching_fixture_without_torch_is_pending(self):
        paths = self.fixture_bundle()
        with patch.object(bundle, "decoder_smoke", side_effect=ModuleNotFoundError("torch")):
            report = bundle.verify_bundle(paths)
        self.assertEqual(report["decoder"]["status"], "unavailable")
        self.assertEqual(report["status"], "pending")
        self.assertFalse(report["passed"])

    def test_decoder_failure_is_not_receipt_success(self):
        paths = self.fixture_bundle()
        with patch.object(bundle, "decoder_smoke", side_effect=ValueError("private local path")):
            report = bundle.verify_bundle(paths)
        self.assertEqual(report["decoder"]["status"], "failed")
        self.assertFalse(report["passed"])
        self.assertNotIn("private local path", json.dumps(report))

    def test_changed_input_detected_during_check(self):
        paths = self.fixture_bundle()

        def external_mutation(*args):
            paths["sentences"].write_text("concurrent external change", encoding="utf-8")
            return {"status": "passed"}

        with patch.object(bundle, "decoder_smoke", side_effect=external_mutation):
            report = bundle.verify_bundle(paths)
        self.assertIn({"file": "sentences", "code": "changed_during_check"}, report["errors"])
        self.assertFalse(report["passed"])

    def test_partial_matched_fixture_is_still_pending(self):
        paths = self.fixture_bundle()
        report = bundle.verify_bundle({"tokens": paths["tokens"]})
        self.assertEqual(report["status"], "pending")
        self.assertFalse(report["passed"])
        self.assertEqual(report["checks"]["tokens"]["status"], "passed")

    def test_cli_exit_codes_are_distinct_for_pending_failure_success(self):
        for argv, expected in (([], 2), (["--model", str(self.root / "missing")], 1)):
            with self.subTest(argv=argv), patch("sys.argv", ["verify_bundle", *argv]), redirect_stdout(io.StringIO()):
                self.assertEqual(bundle.main(), expected)
        paths = self.fixture_bundle()
        argv = ["verify_bundle"]
        for name, path in paths.items():
            argv.extend(["--" + name.replace("_", "-"), str(path)])
        with patch("sys.argv", argv), patch.object(bundle, "decoder_smoke", return_value={"status": "passed"}), redirect_stdout(io.StringIO()):
            self.assertEqual(bundle.main(), 0)

    @unittest.skipUnless(importlib.util.find_spec("torch"), "Torch absent; real decoder execution pending")
    def test_tiny_vq_checkpoint_shape_with_real_decoder_when_torch_available(self):
        import torch
        from vq.model import MotionVQVAE

        config = {"width": 8, "code_dim": 4, "nb_code": 512, "depth": 1, "parts": "body_hand"}
        model = MotionVQVAE(width=8, code_dim=4, nb_code=512, depth=1, parts="body_hand")
        path = self.root / "tiny_model.pt"
        torch.save({"model": model.state_dict(), "config": config}, path)
        report = bundle.decoder_smoke(path, config)
        self.assertEqual(report["shape"], [1, 12, 375])


if __name__ == "__main__":
    unittest.main()
