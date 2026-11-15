"""Production loader + actual B Generator on entirely fabricated coordinates."""
import base64
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
from pathlib import Path
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml.serve.app import create_app
from ml.serve.settings import Settings
from ml.serve.tests.baseline_fixture import expected_motion, make_baseline_bundle


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    return make_baseline_bundle(tmp_path)


@pytest.mark.parametrize("gloss", [
    ["화장실", "있다"], ["있다", "화장실", "있다"],
    ["미등록", "있다", "미등록"], ["미등록", "미등록"],
])
def test_actual_baseline_contract_and_all_coordinate_bytes(bundle, gloss):
    with TestClient(create_app(Settings(run_dir=str(bundle)))) as client:
        assert client.get("/health").json() == {"status": "ready"}
        assert type(client.app.state.generator) is importlib.import_module("gen.infer").Generator
        response = client.post("/generate", json={"gloss": gloss, "nonmanual": ["의문"]})
        assert response.status_code == 200
        result = response.json()
        expected = expected_motion(gloss)
        assert set(result) == {"fps", "joints", "frames", "units", "data", "tokens", "segments", "unknown", "source"}
        assert (result["source"], result["fps"], result["joints"], result["units"]) == (
            "baseline", 30, 125, "shoulder")
        assert result["frames"] == len(expected)
        assert result["tokens"] == result["segments"] == []
        assert result["unknown"] == [word for word in gloss if word == "미등록"]
        raw = base64.b64decode(result["data"], validate=True)
        assert len(raw) == len(expected) * 125 * 3 * 4
        assert raw == expected.astype("<f4").tobytes(order="C")
        np.testing.assert_array_equal(np.frombuffer(raw, dtype="<f4").reshape(-1, 125, 3), expected)


def test_reuses_loaded_baseline_and_tags_do_not_create_expressions(bundle):
    with TestClient(create_app(Settings(run_dir=str(bundle)))) as client:
        loaded = client.app.state.generator
        plain = client.post("/generate", json={"gloss": ["화장실", "있다"]})
        # Make subsequent loading fail: requests must keep the original in-memory object.
        (bundle / "generator.json").write_text("{}", encoding="utf-8")
        for _ in range(2):
            tagged = client.post("/generate", json={"gloss": ["화장실", "있다"], "nonmanual": ["의문"]})
            assert tagged.status_code == 200 and tagged.json() == plain.json()
            assert client.app.state.generator is loaded


@pytest.mark.parametrize("failure", ["missing_config", "bad_json", "bad_kind", "bad_split", "bad_coordinates"])
def test_real_loader_failures_are_not_ready_and_do_not_leak(bundle, failure):
    if failure == "missing_config":
        run_dir = bundle / "not_present"
    else:
        run_dir = bundle
        if failure == "bad_json":
            (bundle / "generator.json").write_text("{", encoding="utf-8")
        elif failure == "bad_kind":
            config = json.loads((bundle / "generator.json").read_text(encoding="utf-8"))
            config["kind"] = "invalid_test_kind"
            (bundle / "generator.json").write_text(json.dumps(config), encoding="utf-8")
        elif failure == "bad_split":
            (bundle.parent / "split.json").write_text("{}", encoding="utf-8")
        else:
            path = bundle.parent / "data/npy/WORD1_SYNTH_TRAIN.npy"
            np.save(path, np.full((20, 125, 3), np.nan, dtype=np.float32), allow_pickle=False)
    with TestClient(create_app(Settings(run_dir=str(run_dir)))) as client:
        health = client.get("/health")
        assert health.status_code == 503 and health.json() == {"status": "unavailable"}
        response = client.post("/generate", json={"gloss": ["화장실"]})
        assert response.status_code == 503 and response.json() == {"detail": "Generator unavailable"}
        assert str(bundle) not in response.text and str(bundle) not in health.text


def test_busy_actual_baseline_rejects_then_recovers(bundle, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    with TestClient(create_app(Settings(run_dir=str(bundle)))) as client:
        generator = client.app.state.generator
        original = generator.generate

        def delayed(**kwargs):
            entered.set()
            assert release.wait(5)
            return original(**kwargs)

        # Fault injection only; the loader and eventual coordinate generation are B's.
        monkeypatch.setattr(generator, "generate", delayed)
        with ThreadPoolExecutor(1) as pool:
            first = pool.submit(client.post, "/generate", json={"gloss": ["화장실"]})
            try:
                assert entered.wait(3)
                assert client.get("/health").status_code == 200
                busy = client.post("/generate", json={"gloss": ["있다"]})
                assert busy.status_code == 503 and busy.headers["retry-after"] == "1"
            finally:
                release.set()
            assert first.result(5).status_code == 200
        assert client.post("/generate", json={"gloss": ["있다"]}).status_code == 200


def test_actual_baseline_output_frame_limit_is_enforced(bundle):
    with TestClient(create_app(Settings(run_dir=str(bundle), max_frames=12))) as client:
        response = client.post("/generate", json={"gloss": ["화장실"]})
        assert response.status_code == 500
        assert response.json() == {"detail": "motion exceeds frame limit"}
