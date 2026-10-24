import base64
import json
from pathlib import Path
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml.serve.app import create_app
from ml.serve.settings import Settings
from ml.serve.demo import SyntheticGenerator
from ml.serve.serialization import serialize


class FakeGenerator:
    def __init__(self, motion=None):
        self.motion = motion
        self.calls = []

    def generate(self, gloss, nonmanual=(), seed=None):
        self.calls.append((gloss, nonmanual))
        unknown = [word for word in gloss if word != "known"]
        motion = self.motion
        if motion is None:
            frames = 2 if "known" in gloss else 0
            motion = np.arange(frames * 375, dtype=np.float32).reshape(frames, 125, 3) / 100
        return dict(fps=30, motion=motion, tokens=[], unknown=unknown, source="baseline")


def test_roundtrip_axes_endianness_and_load_once():
    # Non-contiguous and big-endian input exercises explicit wire normalization.
    motion = np.arange(750, dtype=np.float32).reshape(2, 3, 125).transpose(0, 2, 1).astype(">f4")
    fake = FakeGenerator(motion)
    loads = []

    def load():
        loads.append(True)
        return fake

    with TestClient(create_app(generator_factory=load)) as client:
        assert client.get("/health").json() == {"status": "ready"}
        for _ in range(2):
            response = client.post("/generate", json={"gloss": ["known"], "nonmanual": ["의문"]})
            assert response.status_code == 200
            result = response.json()
            raw = base64.b64decode(result["data"], validate=True)
            assert len(raw) == 2 * 125 * 3 * 4
            assert raw == motion.astype("<f4").tobytes(order="C")
            np.testing.assert_array_equal(np.frombuffer(raw, dtype="<f4").reshape(2, 125, 3), motion)
            assert result["segments"] == [] and result["units"] == "shoulder"
        assert len(loads) == 1
        assert fake.calls == [(["known"], ["의문"])] * 2


@pytest.mark.parametrize("gloss,frames,unknown", [
    (["known", "missing"], 2, ["missing"]), (["missing"], 0, ["missing"]),
])
def test_unknown_policy(gloss, frames, unknown):
    with TestClient(create_app(generator_factory=FakeGenerator)) as client:
        response = client.post("/generate", json={"gloss": gloss})
        assert response.status_code == 200
        result = response.json()
        assert result["unknown"] == unknown and result["frames"] == frames
        assert result["tokens"] == []
        if frames == 0:
            assert result["data"] == ""


@pytest.mark.parametrize("payload", [
    {}, {"gloss": []}, {"gloss": [""]}, {"gloss": ["  "]}, {"gloss": "known"},
    {"gloss": [12]}, {"gloss": None}, {"gloss": ["known"], "nonmanual": "의문"},
    {"gloss": ["known"], "nonmanual": [False]}, {"gloss": ["x" * 101]},
    {"gloss": ["x"] * 129}, {"gloss": ["known"], "nonmanual": ["tag"] * 17},
    {"gloss": ["x" * 100] * 42}, {"gloss": ["known"], "seed": 3},
])
def test_bad_input_does_not_infer_or_echo(payload):
    fake = FakeGenerator()
    with TestClient(create_app(generator_factory=lambda: fake)) as client:
        response = client.post("/generate", json=payload)
        assert response.status_code == 422
        assert "input" not in response.json()
        assert fake.calls == []


@pytest.mark.parametrize("motion,message", [
    (np.zeros((2, 375), dtype=np.float32), "shape"),
    (np.full((1, 125, 3), np.nan, dtype=np.float32), "finite"),
    (np.full((1, 125, 3), np.inf, dtype=np.float32), "finite"),
    (np.zeros((1, 125, 3), dtype=np.float64), "float32"),
    (np.zeros((3, 125, 3), dtype=np.float32), "frame limit"),
])
def test_invalid_internal_motion(motion, message):
    with TestClient(create_app(Settings(max_frames=2), lambda: FakeGenerator(motion))) as client:
        response = client.post("/generate", json={"gloss": ["known"]})
        assert response.status_code == 500
        assert message in response.json()["detail"]


def test_limits_are_configurable():
    with TestClient(create_app(Settings(max_words=1, max_word_chars=3, max_input_chars=4),
                               FakeGenerator)) as client:
        for payload in [{"gloss": ["a", "b"]}, {"gloss": ["abcd"]},
                        {"gloss": ["abc"], "nonmanual": ["de"]}]:
            assert client.post("/generate", json=payload).status_code == 422


@pytest.mark.parametrize("factory", [lambda: None, lambda: object()])
def test_invalid_loader_not_ready(factory):
    with TestClient(create_app(generator_factory=factory)) as client:
        assert client.get("/health").status_code == 503
        assert client.post("/generate", json={"gloss": ["known"]}).status_code == 503


def test_load_failure_and_unconfigured_deployment_do_not_leak(monkeypatch):
    def broken():
        raise RuntimeError("SECRET C:/private/model.pt")

    monkeypatch.delenv("SIGN_RUN_DIR", raising=False)
    for app in [create_app(generator_factory=broken), create_app(Settings())]:
        with TestClient(app) as client:
            health = client.get("/health")
            assert health.status_code == 503
            assert health.json() == {"status": "unavailable"}
            response = client.post("/generate", json={"gloss": ["known"]})
            assert response.status_code == 503
            assert "private" not in response.text and "SECRET" not in response.text


def test_concurrency_rejects_busy_without_queue_and_recovers():
    entered, release = threading.Event(), threading.Event()

    class Blocking(FakeGenerator):
        def generate(self, *args, **kwargs):
            entered.set()
            assert release.wait(5)
            return super().generate(*args, **kwargs)

    with TestClient(create_app(generator_factory=Blocking)) as client, ThreadPoolExecutor(1) as pool:
        first = pool.submit(client.post, "/generate", json={"gloss": ["known"]})
        try:
            assert entered.wait(3)
            assert client.get("/health").status_code == 200
            busy = client.post("/generate", json={"gloss": ["known"]})
            assert busy.status_code == 503 and busy.headers["retry-after"] == "1"
        finally:
            release.set()
        assert first.result(5).status_code == 200
        assert client.post("/generate", json={"gloss": ["known"]}).status_code == 200


def test_runtime_failure_releases_slot_and_sanitizes_error():
    class Broken(FakeGenerator):
        def generate(self, **kwargs):
            raise RuntimeError("SECRET C:/private/checkpoint")

    with TestClient(create_app(generator_factory=Broken)) as client:
        for _ in range(2):
            response = client.post("/generate", json={"gloss": ["known"]})
            assert response.status_code == 500
            assert response.json() == {"detail": "Generation failed"}


@pytest.mark.parametrize("field,value", [
    ("fps", 24), ("tokens", [True]), ("unknown", ["invented"]), ("source", "video"),
    ("tokens", [1]), ("motion", np.zeros((0, 125, 3), dtype=np.float32)),
])
def test_invalid_generator_metadata(field, value):
    class Invalid(FakeGenerator):
        def generate(self, **kwargs):
            result = super().generate(**kwargs)
            result[field] = value
            return result

    with TestClient(create_app(generator_factory=Invalid)) as client:
        assert client.post("/generate", json={"gloss": ["known"]}).status_code == 500


def test_model_source_and_tokens_pass_through():
    class Model(FakeGenerator):
        def generate(self, **kwargs):
            return dict(super().generate(**kwargs), tokens=[0, 47, 203], source="model")

    with TestClient(create_app(generator_factory=Model)) as client:
        response = client.post("/generate", json={"gloss": ["known"]})
        assert response.status_code == 200
        assert response.json()["source"] == "model"
        assert response.json()["tokens"] == [0, 47, 203]


def test_published_synthetic_examples_match_wire_format():
    folder = Path(__file__).resolve().parents[1] / "examples"
    for name, gloss in [("normal", ["화장실", "있다"]), ("unknown", ["미등록예시"])]:
        expected = serialize(SyntheticGenerator().generate(gloss), gloss, 1800).model_dump()
        assert json.loads((folder / f"{name}.json").read_text(encoding="utf-8")) == expected
    video = json.loads((folder / "video.json").read_text(encoding="utf-8"))
    assert video["source"] == "video" and "data" not in video
    assert video["items"][1]["hasVideo"] is False
    assert video["items"][0]["url"].startswith("https://example.invalid/")
