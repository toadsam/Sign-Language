"""Actual A/B CPU model inference through the production service loader."""
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

torch = pytest.importorskip("torch", reason="CPU Torch required: model HTTP integration NOT verified")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gen.infer import Generator
from gen import infer_models
from vq.model import load_vqvae
from ml.serve.app import create_app
from ml.serve.settings import Settings
from ml.serve.tests.baseline_fixture import WORDS
from ml.serve.tests.model_fixture import (
    DOWN, FAILURES, KINDS, MAX_LEN, NB_CODE, REGRESS_LENGTH,
    make_model_bundles, read_config, regression_oracle, variant_bundle,
)


@pytest.fixture(scope="module")
def bundles(tmp_path_factory):
    previous_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        yield make_model_bundles(tmp_path_factory.mktemp("service-models"))
    finally:
        torch.set_num_threads(previous_threads)


SEQUENCES = (["화장실", "있다"], ["있다", "화장실", "있다"],
             ["미등록", "있다", "미등록"], ["미등록", "미등록"])


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("gloss", SEQUENCES)
def test_real_models_wire_format_and_coordinates(bundles, kind, gloss):
    bundle = bundles[kind]
    config = read_config(bundle)
    if kind == "word_gpt":
        decoder, _ = load_vqvae(bundle / config["vq_checkpoint"])
    else:
        oracle = regression_oracle(bundle)
    with TestClient(create_app(Settings(run_dir=str(bundle)))) as client:
        assert type(client.app.state.generator) is Generator
        assert client.app.state.generator.kind == kind
        assert client.app.state.generator.supported_nonmanual == ()
        assert client.app.state.generator.connection_policy["data_mode"] == "smoke"
        assert client.get("/health").status_code == 200
        for _ in range(2):
            response = client.post("/generate", json={"gloss": gloss, "nonmanual": ["의문"]})
            assert response.status_code == 200
            result = response.json()
            assert set(result) == {"fps", "joints", "frames", "units", "data", "tokens", "segments", "unknown", "source"}
            assert (result["source"], result["fps"], result["joints"], result["units"]) == ("model", 30, 125, "shoulder")
            assert result["segments"] == []
            assert result["unknown"] == [word for word in gloss if word not in WORDS]
            known = [word for word in gloss if word in WORDS]
            raw = base64.b64decode(result["data"], validate=True)
            assert len(raw) == result["frames"] * 125 * 3 * 4
            motion = np.frombuffer(raw, dtype="<f4").reshape(-1, 125, 3)
            assert np.isfinite(motion).all()
            if kind == "word_regress":
                assert result["tokens"] == [] and result["frames"] == len(known) * REGRESS_LENGTH
                assert raw == b"".join(base64.b64decode(oracle[word]) for word in known)
            else:
                codes = result["tokens"]
                assert len(codes) == len(known) * MAX_LEN
                assert all(type(code) is int and 0 <= code < NB_CODE for code in codes)
                assert result["frames"] == len(codes) * DOWN
                expected = []
                with torch.inference_mode():
                    for offset in range(0, len(codes), MAX_LEN):
                        # B decodes each word independently, never the whole flattened stream.
                        word = decoder.decode(torch.tensor([codes[offset:offset + MAX_LEN]], dtype=torch.long))
                        expected.append(word[0].numpy().astype("<f4").tobytes(order="C"))
                assert raw == b"".join(expected)
                np.testing.assert_array_equal(motion[:, 55:], np.float32(0.25))
            # No equality assertion between unseeded GPT requests; every draw is checked independently.


@pytest.mark.parametrize("kind", KINDS)
def test_startup_uses_actual_a_and_vq_loaders_once(bundles, kind):
    with patch.object(infer_models, "load_generator", wraps=infer_models.load_generator) as model_load, \
            patch.object(infer_models, "load_vqvae", wraps=infer_models.load_vqvae) as vq_load:
        with TestClient(create_app(Settings(run_dir=str(bundles[kind])))) as client:
            loaded = client.app.state.generator
            assert loaded is not None and not loaded._adapter.model.training
            for _ in range(3):
                assert client.post("/generate", json={"gloss": ["화장실"]}).status_code == 200
                assert client.app.state.generator is loaded
            assert model_load.call_count == vq_load.call_count == 1


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("failure", FAILURES)
def test_bad_model_artifacts_never_report_ready(bundles, tmp_path, kind, failure):
    bundle = variant_bundle(tmp_path / failure, bundles[kind], failure)
    with TestClient(create_app(Settings(run_dir=str(bundle)))) as client:
        health = client.get("/health")
        assert health.status_code == 503 and health.json() == {"status": "unavailable"}
        response = client.post("/generate", json={"gloss": ["화장실"]})
        assert response.status_code == 503 and response.json() == {"detail": "Generator unavailable"}
        assert str(tmp_path) not in response.text and str(tmp_path) not in health.text


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("limit", ["adapter", "service"])
def test_model_and_service_frame_limits(bundles, tmp_path, kind, limit):
    per_word = MAX_LEN * DOWN if kind == "word_gpt" else REGRESS_LENGTH
    bundle = (variant_bundle(tmp_path / "limit", bundles[kind], "frame_limit")
              if limit == "adapter" else bundles[kind])
    settings = Settings(run_dir=str(bundle), max_frames=1800 if limit == "adapter" else per_word - 1)
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        words = ["화장실", "있다"] if limit == "adapter" else ["화장실"]
        response = client.post("/generate", json={"gloss": words})
        assert response.status_code == 500
        assert response.json()["detail"] == ("Generation failed" if limit == "adapter" else "motion exceeds frame limit")


@pytest.mark.parametrize("kind", KINDS)
def test_real_model_busy_rejection_and_recovery(bundles, kind, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    with TestClient(create_app(Settings(run_dir=str(bundles[kind])))) as client:
        original = client.app.state.generator.generate

        def delayed(**kwargs):
            entered.set()
            assert release.wait(5)
            return original(**kwargs)

        monkeypatch.setattr(client.app.state.generator, "generate", delayed)
        with ThreadPoolExecutor(1) as pool:
            first = pool.submit(client.post, "/generate", json={"gloss": ["화장실"]})
            try:
                assert entered.wait(3)
                busy = client.post("/generate", json={"gloss": ["있다"]})
                assert busy.status_code == 503 and busy.headers["retry-after"] == "1"
                assert client.get("/health").status_code == 200
            finally:
                release.set()
            assert first.result(5).status_code == 200
        assert client.post("/generate", json={"gloss": ["있다"]}).status_code == 200


@pytest.mark.parametrize("kind", KINDS)
def test_model_http_does_not_add_a_seed_field(bundles, kind):
    with TestClient(create_app(Settings(run_dir=str(bundles[kind])))) as client:
        assert client.post("/generate", json={"gloss": ["화장실"], "seed": 7}).status_code == 422
