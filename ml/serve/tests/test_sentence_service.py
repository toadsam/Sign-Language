"""문장 경로(/translate, 문장 모드 /generate, /verify). 표·동작은 모두 지어낸 것이다."""
import base64
import json
import re
import sys
import types
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml.serve import sentence
from ml.serve.app import create_app
from ml.serve.demo import DEMO_TABLE, create_sentence_demo_app
from ml.serve.serialization import InvalidMotion, check_segments
from ml.serve.settings import Settings
from ml.serve.tests.baseline_fixture import make_baseline_bundle

TABLE = DEMO_TABLE


def decode(result):
    raw = base64.b64decode(result["data"], validate=True)
    return np.frombuffer(raw, dtype="<f4").reshape(result["frames"], 125, 3)


@pytest.fixture
def table_file(tmp_path):
    path = tmp_path / "gloss_table.json"
    path.write_text(json.dumps(TABLE, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------- stub 번역기

def test_stub_translator_prefix_match_drops_endings():
    out = sentence.StubTranslator(TABLE).translate("화장실 어디에 있어요?")
    assert out == {"gloss": ["화장실", "어디", "있다"], "units": ["S:화장실", "S:어디", "S:있다"],
                   "senses": [None] * 3, "unknown": [], "dropped": ["에", "어요"]}


def test_stub_translator_unknown_and_word_units():
    out = sentence.StubTranslator(TABLE).translate("나는 퀘이사 학교에 가요")
    assert out["gloss"] == ["나", "학교", "가다"]
    assert out["units"] == ["W:WORD9001", "W:WORD9002", "S:가다"]
    assert out["unknown"] == ["퀘이사"]
    assert sentence.check_translation(out) == out


@pytest.mark.parametrize("bad", [
    None, {"gloss": "x"}, {"gloss": ["a"], "units": []}, {"gloss": ["a"], "units": [1]},
    {"gloss": ["a"], "units": ["S:a"], "unknown": [3]}, {"gloss": [""], "units": [None]},
])
def test_check_translation_rejects_bad_shapes(bad):
    with pytest.raises(ValueError):
        sentence.check_translation(bad)


def test_resolve_matches_gen_gloss_table(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    from gen.gloss_table import resolve as gen_resolve
    table = {"glosses": {"기타": {"default": "W:WORD1", "alts": ["W:WORD2"], "homonym": True,
                                  "senses": {"W:WORD2": "악기"}}}}
    for name, sense in [("기타", None), ("기타", "악기"), ("기타", "없는뜻"), ("없음", None)]:
        assert sentence.resolve(table, name, sense) == gen_resolve(table, name, sense)


# ---------------------------------------------------------------- 어댑터

def test_adapter_maps_segments_to_gloss_and_unknown():
    adapter = sentence.GlossSentenceAdapter(sentence.SyntheticSentenceGenerator(), TABLE)
    out = adapter.generate(["화장실", "모름", "있다", "화장실"])
    assert out["unknown"] == ["모름"]
    assert [s["gloss"] for s in out["segments"]] == ["화장실", "있다", "화장실"]
    assert out["motion"].shape[1:] == (125, 3) and out["motion"].dtype == np.float32
    starts = [s["start"] for s in out["segments"]]
    assert starts == sorted(starts) and out["segments"][-1]["end"] <= len(out["motion"])
    # 같은 단위는 같은 가짜 동작(해시 기반)
    a, b = out["segments"][0], out["segments"][2]
    np.testing.assert_array_equal(out["motion"][a["start"]:a["end"]], out["motion"][b["start"]:b["end"]])


def test_adapter_all_unknown_is_empty_motion():
    out = sentence.GlossSentenceAdapter(sentence.SyntheticSentenceGenerator(), TABLE).generate(["모름"])
    assert out["motion"].shape == (0, 125, 3) and out["unknown"] == ["모름"] and out["segments"] == []


def test_adapter_marks_units_the_generator_skipped():
    class Partial:
        def generate(self, units, signer=None, seed=None):
            self.args = (units, signer, seed)
            return {"fps": 30, "motion": np.zeros((10, 125, 3), np.float32), "tokens": [1, 2],
                    "segments": [{"unit": units[1], "start": 2, "end": 8}], "source": "model"}

    inner = Partial()
    out = sentence.GlossSentenceAdapter(inner, TABLE, signer="REAL01").generate(["화장실", "있다"], seed=5)
    assert inner.args == (["S:화장실", "S:있다"], "REAL01", 5)
    assert out["unknown"] == ["화장실"] and out["segments"] == [{"gloss": "있다", "start": 2, "end": 8}]


@pytest.mark.parametrize("segments", [
    [{"unit": "S:화장실", "start": 0, "end": 99}],
    [{"unit": "S:화장실", "start": 0, "end": 4}, {"unit": "S:없는것", "start": 4, "end": 6}],
])
def test_adapter_rejects_bad_segments(segments):
    class Bad:
        def generate(self, units, signer=None, seed=None):
            return {"fps": 30, "motion": np.zeros((10, 125, 3), np.float32), "tokens": [],
                    "segments": segments, "source": "baseline"}

    with pytest.raises(ValueError):
        sentence.GlossSentenceAdapter(Bad(), TABLE).generate(["화장실"])


@pytest.mark.parametrize("segments", [
    [{"gloss": "x", "start": 0, "end": 2}], [{"gloss": "a", "start": 2, "end": 2}],
    [{"gloss": "a", "start": 0, "end": 5}], [{"gloss": "a", "start": 0, "end": 2, "extra": 1}],
    [{"gloss": "a", "start": 2, "end": 3}, {"gloss": "a", "start": 0, "end": 1}],
])
def test_check_segments_rejects(segments):
    with pytest.raises(InvalidMotion):
        check_segments(segments, ["a"], 4)


# ---------------------------------------------------------------- HTTP

def test_translate_generate_verify_flow_with_demo_app():
    with TestClient(create_sentence_demo_app()) as client:
        tr = client.post("/translate", json={"text": "오늘 화장실 어디에 있어요?"})
        assert tr.status_code == 200 and "tr;dur=" in tr.headers["server-timing"]
        body = tr.json()
        assert body["gloss"] == ["오늘", "화장실", "어디", "있다"] and body["translator"] == "stub"
        gen = client.post("/generate", json={"gloss": body["gloss"] + ["모름"], "nonmanual": ["의문"]})
        assert gen.status_code == 200 and "gen;dur=" in gen.headers["server-timing"]
        result = gen.json()
        assert set(result) == {"fps", "joints", "frames", "units", "data", "tokens", "segments", "unknown", "source"}
        assert result["unknown"] == ["모름"] and result["source"] == "baseline" and result["tokens"] == []
        assert [s["gloss"] for s in result["segments"]] == ["오늘", "화장실", "어디", "있다"]
        assert set(result["segments"][0]) == {"gloss", "start", "end"}
        motion = decode(result)
        assert np.isfinite(motion).all() and motion.shape[0] == result["frames"] > 0
        page = client.get("/verify")
        assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")


def test_verify_page_is_self_contained():
    with TestClient(create_sentence_demo_app()) as client:
        html = client.get("/verify").text
    assert "/*SKELETON*/null" not in html
    meta = json.loads(re.search(r"const SKELETON = (\{.*?\});", html).group(1))
    assert len(meta["edges"]) > 100 and meta["face"] == [55, 125]
    # 외부 자원(CDN, 글꼴, 이미지 주소)을 부르지 않는다.
    assert not re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", html)
    assert "@import" not in html and "http://" not in html and "https://" not in html
    for path in ("/translate", "/generate"):
        assert f'"{path}"' in html


def test_verify_page_can_be_disabled():
    with TestClient(create_app(Settings(verify_page=False), generator_factory=lambda: None)) as client:
        assert client.get("/verify").status_code == 404


@pytest.mark.parametrize("payload,status", [
    ({"text": ""}, 422), ({"text": "   "}, 422), ({"text": "x" * 4097}, 422), ({}, 422),
    ({"text": 3}, 422), ({"text": "a", "extra": 1}, 422),
])
def test_translate_input_limits(payload, status):
    calls = []

    class Spy(sentence.StubTranslator):
        def translate(self, text):
            calls.append(text)
            return super().translate(text)

    with TestClient(create_app(generator_factory=lambda: None, translator_factory=lambda: Spy(TABLE))) as client:
        assert client.post("/translate", json=payload).status_code == status
    assert calls == []


def test_translate_unavailable_and_failures_do_not_leak(monkeypatch):
    for key in ("SIGN_GLOSS_TABLE", "SIGN_TRANSLATOR", "SIGN_MODE"):
        monkeypatch.delenv(key, raising=False)
    with TestClient(create_app(Settings(), generator_factory=lambda: None)) as client:
        assert client.post("/translate", json={"text": "화장실"}).status_code == 503

    class Broken:
        def translate(self, text):
            raise RuntimeError("SECRET C:/private")

    class Malformed:
        def translate(self, text):
            return {"gloss": ["a"], "units": []}

    for factory in (Broken, Malformed):
        with TestClient(create_app(generator_factory=lambda: None, translator_factory=factory)) as client:
            response = client.post("/translate", json={"text": "화장실"})
            assert response.status_code == 500 and "SECRET" not in response.text


def test_word_mode_keeps_empty_segments(table_file):
    class WithSegments:
        def generate(self, gloss, nonmanual=(), seed=None):
            return {"fps": 30, "motion": np.zeros((4, 125, 3), np.float32), "tokens": [], "unknown": [],
                    "segments": [{"gloss": gloss[0], "start": 0, "end": 4}], "source": "baseline"}

    with TestClient(create_app(Settings(), generator_factory=WithSegments)) as client:
        assert client.post("/generate", json={"gloss": ["화장실"]}).json()["segments"] == []
    settings = Settings(mode="sentence", gloss_table=str(table_file), segments=False)
    with TestClient(create_app(settings)) as client:
        result = client.post("/generate", json={"gloss": ["화장실"]}).json()
        assert result["segments"] == [] and result["frames"] > 0


def test_production_loader_synthetic_sentence_and_stub_translator(table_file):
    settings = Settings(mode="sentence", gloss_table=str(table_file))
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "ready"}
        assert type(client.app.state.generator) is sentence.GlossSentenceAdapter
        gloss = client.post("/translate", json={"text": "화장실 있어요"}).json()["gloss"]
        result = client.post("/generate", json={"gloss": gloss}).json()
        assert [s["gloss"] for s in result["segments"]] == ["화장실", "있다"]


def test_sentence_mode_without_table_is_unavailable():
    with TestClient(create_app(Settings(mode="sentence"))) as client:
        assert client.get("/health").status_code == 503


def test_loader_strings_plug_in_real_parts(table_file, monkeypatch):
    """실제 부품은 "module:function" 설정만 바꿔 끼운다(①②가 생긴 뒤 같은 길)."""
    fake = types.ModuleType("fake_parts")
    seen = {}

    class Translator:
        name = "fake-translator"

        def translate(self, text):
            return {"gloss": ["있다"], "units": ["S:있다"], "senses": [None], "unknown": [], "dropped": []}

    class Generator:
        def generate(self, units, signer=None, seed=None):
            seen["units"], seen["signer"] = units, signer
            return {"fps": 30, "motion": np.ones((8, 125, 3), np.float32), "tokens": [3, 4],
                    "segments": [{"unit": units[0], "start": 0, "end": 8}], "source": "model"}

    def load_translator(path):
        seen["translator_path"] = path
        return Translator()

    def load_sentence_generator(run_dir, device="cpu"):
        seen["run_dir"], seen["device"] = run_dir, device
        return Generator()

    fake.load_translator, fake.load_sentence_generator = load_translator, load_sentence_generator
    monkeypatch.setitem(sys.modules, "fake_parts", fake)
    settings = Settings(mode="sentence", gloss_table=str(table_file),
                        translator="fake_parts:load_translator", translator_path="tr.json",
                        sentence_generator="fake_parts:load_sentence_generator",
                        sentence_run_dir="runs/sent", sentence_signer="REAL05")
    with TestClient(create_app(settings)) as client:
        tr = client.post("/translate", json={"text": "아무거나"}).json()
        assert tr["translator"] == "fake-translator"
        result = client.post("/generate", json={"gloss": tr["gloss"]}).json()
    assert result["source"] == "model" and result["tokens"] == [3, 4]
    assert result["segments"] == [{"gloss": "있다", "start": 0, "end": 8}]
    assert seen == {"translator_path": "tr.json", "run_dir": "runs/sent", "device": "cpu",
                    "units": ["S:있다"], "signer": "REAL05"}


@pytest.mark.parametrize("spec", ["nocolon", "a.b:", ":f", "os:not-ident"])
def test_load_object_rejects_bad_specs(spec):
    with pytest.raises(ValueError):
        sentence.load_object(spec)


def test_settings_from_env(monkeypatch):
    env = {"SIGN_MODE": "sentence", "SIGN_GLOSS_TABLE": "t.json", "SIGN_TRANSLATOR": "m:f",
           "SIGN_SENTENCE_GENERATOR": "word", "SIGN_SEGMENTS": "0", "SIGN_VERIFY_PAGE": "off"}
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    s = Settings.from_env()
    assert (s.mode, s.gloss_table, s.translator, s.sentence_generator, s.segments, s.verify_page) == (
        "sentence", "t.json", "m:f", "word", False, False)
    with pytest.raises(ValueError):
        Settings(mode="video")


def test_check_sentences_summary_counts_without_text():
    from ml.serve import check_sentences

    with TestClient(create_sentence_demo_app()) as client:
        def post(path, body):
            response = client.post(path, json=body)
            return response.status_code, response.json() if response.status_code == 200 else None
        rows = check_sentences.run(["화장실 어디에 있어요", "퀘이사 별", "나 학교 퀘이사", ""], post)
    summary = check_sentences.summarize(rows)
    assert summary["sentences"] == 4 and summary["translate_ok"] == 3 and summary["no_gloss"] == 1
    assert summary["generate_ok"] == 2 and summary["success_rate"] == 0.5
    assert summary["drawable_gloss_rate"] == 1.0 and summary["unknown_pieces"] == 3
    assert "화장실" not in json.dumps(summary, ensure_ascii=False)


# ---------------------------------------------------------------- 단어 Generator 이어 붙이기 stub

def test_word_concat_with_actual_baseline_generator(tmp_path, monkeypatch):
    """gen.infer.Generator(baseline, 지어낸 좌표)를 단위마다 불러 잇는다."""
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    run = make_baseline_bundle(tmp_path)
    table = {"schema_version": 2, "units": {
        "S:화장실": {"source": "SEN", "name": "화장실"}, "W:WORD2": {"source": "WORD", "name": "있다"},
        "S:모름": {"source": "SEN", "name": "모름"}}, "glosses": {
        "화장실": {"default": "S:화장실", "alts": ["W:WORD1"], "homonym": False, "senses": {}},
        "있다": {"default": "W:WORD2", "alts": [], "homonym": False, "senses": {}},
        "모름": {"default": "S:모름", "alts": [], "homonym": False, "senses": {}}}}
    path = tmp_path / "table.json"
    path.write_text(json.dumps(table, ensure_ascii=False), encoding="utf-8")
    settings = Settings(run_dir=str(run), mode="sentence", gloss_table=str(path), sentence_generator="word")
    with TestClient(create_app(settings)) as client:
        result = client.post("/generate", json={"gloss": ["화장실", "모름", "있다"]}).json()
    # 단어 클립 13프레임씩, 사이 연결 8프레임
    assert result["frames"] == 13 + 8 + 13 and result["unknown"] == ["모름"]
    assert result["segments"] == [{"gloss": "화장실", "start": 0, "end": 13},
                                  {"gloss": "있다", "start": 21, "end": 34}]
    assert result["source"] == "baseline"
