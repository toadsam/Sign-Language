import copy
import json

from gen.artifacts import (ArtifactValidationError, create_artifact_manifest,
                           prepare_run, sha256_file, validate_artifact_manifest)
from gen.tests.test_data import Fixture


class ManifestTests(Fixture):
    def manifest(self, kind="WORD"):
        self.add("WORD_A" if kind == "WORD" else "SEN_A", kind=kind)
        selection = self.select(kind)
        path = self.root / "run/selection.json"
        selection.write(path)
        decoder = self.root / "decoder.pt"
        decoder.write_bytes(b"invented decoder bytes for hashing, not a real checkpoint")
        manifest = create_artifact_manifest(selection, path, vq_path=decoder,
                                            vq_version="fixture-v1", parts="body_hand",
                                            code_commit="fixture-commit", code_dirty=True)
        return selection, path, decoder, manifest

    def assert_artifact_error(self, code, field, action):
        with self.assertRaises(ArtifactValidationError) as ctx:
            action()
        self.assertEqual((ctx.exception.code, ctx.exception.field), (code, field))

    def test_manifest_exact_sources_and_non_e5_dimensions(self):
        selection, path, decoder, manifest = self.manifest()
        self.assertEqual(manifest["nb_code"], 8)
        self.assertEqual(manifest["down"], 2)
        self.assertEqual(manifest["vq_sha256"], sha256_file(decoder))
        self.assertEqual(manifest["selection_sha256"], sha256_file(path))
        self.assertEqual(manifest["meta_sha256"], selection.report["sources"]["meta_sha256"])
        self.assertIs(validate_artifact_manifest(manifest, expected={"vq_version": "fixture-v1", "nb_code": 8},
            files={"vq_sha256": decoder, "selection_sha256": path, "tokens_sha256": self.root / "tokens.json",
                   "split_sha256": self.root / "split.json", "meta_sha256": {"word": self.root / "meta.jsonl"}}), manifest)

    def test_decoder_or_dimension_mismatch_is_not_silent(self):
        _, _, decoder, manifest = self.manifest()
        decoder.write_bytes(b"different decoder")
        self.assert_artifact_error("hash_mismatch", "vq_sha256", lambda: validate_artifact_manifest(manifest, files={"vq_sha256": decoder}))
        for field, expected in (("nb_code", 512), ("down", 4), ("parts", "all"), ("vq_version", "v0.3-e5")):
            self.assert_artifact_error("manifest_mismatch", field,
                                      lambda: validate_artifact_manifest(manifest, expected={field: expected}))

    def test_missing_legacy_manifest_and_missing_fields(self):
        self.assert_artifact_error("manifest_missing", "artifact_manifest", lambda: validate_artifact_manifest(None))
        _, _, _, manifest = self.manifest()
        del manifest["split_sha256"]
        self.assert_artifact_error("missing_field", "split_sha256", lambda: validate_artifact_manifest(manifest))

    def test_smoke_is_explicit_and_not_allowed_by_default(self):
        _, _, _, manifest = self.manifest()
        manifest["data_mode"] = "smoke"
        manifest["vq_sha256"], manifest["split_sha256"] = None, None
        self.assert_artifact_error("smoke_not_allowed", "data_mode", lambda: validate_artifact_manifest(manifest))
        validate_artifact_manifest(manifest, allow_smoke=True)

    def test_bad_hash_schema_integer_and_boolean_fields(self):
        _, _, _, good = self.manifest()
        cases = [("tokens_sha256", "bad", "invalid_hash"), ("nb_code", True, "invalid_value"),
                 ("down", 0, "invalid_value"), ("schema_version", 2, "unsupported_schema"),
                 ("code_dirty", "false", "invalid_value"), ("parts", "unknown", "invalid_value")]
        for field, value, code in cases:
            with self.subTest(field=field):
                manifest = copy.deepcopy(good)
                manifest[field] = value
                self.assert_artifact_error(code, field, lambda: validate_artifact_manifest(manifest))

    def test_selection_changed_after_persist_is_rejected(self):
        selection, path, decoder, _ = self.manifest()
        selection.report["counts"]["train"] = 900
        self.assert_artifact_error("selection_mismatch", "selection_sha256", lambda: create_artifact_manifest(
            selection, path, vq_path=decoder, vq_version="fixture-v1", parts="all", code_commit="fixture", code_dirty=True))

    def test_sentence_manifest_requires_sentence_hash(self):
        _, _, _, manifest = self.manifest("SEN")
        self.assertEqual(manifest["sentences_sha256"], sha256_file(self.root / "sentences.jsonl"))
        manifest["sentences_sha256"] = None
        self.assert_artifact_error("missing_field", "sentences_sha256", lambda: validate_artifact_manifest(manifest))

    def test_formal_run_without_decoder_fails_before_any_output(self):
        self.add("WORD_A")
        selection = self.select()
        run = self.root / "formal-run"
        self.assert_artifact_error("decoder_required", "vq_checkpoint/vq_version", lambda: prepare_run(selection, run))
        self.assertFalse(run.exists())

    def test_smoke_run_records_provenance_without_torch_and_refuses_reuse(self):
        self.add("WORD_A")
        selection = self.select(mode="smoke")
        run = self.root / "smoke-run"
        manifest = prepare_run(selection, run)
        self.assertEqual(manifest["data_mode"], "smoke")
        self.assertIsNone(manifest["vq_sha256"])
        self.assertEqual(json.loads((run / "artifact_manifest.json").read_text(encoding="utf-8")), manifest)
        self.assert_artifact_error("run_not_empty", "run_dir", lambda: prepare_run(selection, run))
