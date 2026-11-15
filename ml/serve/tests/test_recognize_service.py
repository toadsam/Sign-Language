"""읽기 경로(POST /recognize) 검사. 가짜 읽는 모델과 손으로 만든 좌표만 쓴다 (모델 가중치 · AI Hub 파일 없음)."""
import base64
import json
import threading

import numpy as np
from fastapi.testclient import TestClient

from ml.serve.app import create_app
from ml.serve.recognize import item_names
from ml.serve.settings import Settings


class FakeGenerator:
    mapping = {"병원": "WORD0773", "학교": "WORD0002"}

    def generate(self, gloss, nonmanual=(), seed=None):
        return dict(fps=30, motion=np.zeros((2, 125, 3), np.float32), tokens=[], unknown=[], source="baseline")


class FakeRecognizer:
    """구간의 첫 프레임 x 값으로 1등 단어를 정해, 어떤 구간 · 어떤 좌표가 들어왔는지 드러낸다."""

    def __init__(self, with_face=False):
        self.checkpoint = {"with_face": with_face}
        self.calls = []
        self.gate = None
        self.entered = threading.Event()  # score 안에 들어왔다는 신호

    def score(self, motion, active=None):
        self.entered.set()
        if self.gate:
            self.gate.wait(30)
        self.calls.append((motion.shape, active, float(motion[active[0], 0, 0]), float(np.abs(motion[:, 55:]).max())))
        first = "WORD0773" if motion[active[0], 0, 0] < 0.5 else "WORD0002"
        top = [(first, 0.8), ("WORD9999", 0.1), ("WORD0003", 0.05), ("WORD0004", 0.03), ("WORD0005", 0.02)]
        return {"top5": top, "probs": np.zeros(3000, np.float32)}


def body(frames=20, joints=125, spans=None, fill=None):
    points = np.zeros((frames, joints, 3), np.float32)
    if fill is not None:
        points[:] = fill
    points[:, 0, 0] = np.arange(frames) / frames  # 뒤 프레임일수록 x 가 크다
    out = {"joints": joints, "frames": frames, "data": base64.b64encode(points.astype("<f4").tobytes()).decode()}
    if spans is not None:
        out["spans"] = spans
    return out


def client(recognizer, settings=None):
    return TestClient(create_app(settings or Settings(), generator_factory=FakeGenerator, recognizer_factory=lambda: recognizer))


def test_reads_whole_motion_and_names_items_from_the_word_table():
    fake = FakeRecognizer()
    with client(fake) as http:
        response = http.post("/recognize", json=body())
    assert response.status_code == 200
    data = response.json()
    assert data["classes"] == 3000
    assert [(r["start"], r["end"]) for r in data["results"]] == [(0, 20)]
    top = data["results"][0]["top"]
    assert [c["item"] for c in top] == ["WORD0773", "WORD9999", "WORD0003", "WORD0004", "WORD0005"]
    assert top[0]["name"] == "병원" and top[1]["name"] is None  # 단어표에 없는 번호는 이름이 없다
    assert abs(top[0]["prob"] - 0.8) < 1e-6
    assert fake.calls[0][0] == (20, 125, 3) and fake.calls[0][1] == (0, 19)  # active 는 끝 프레임 포함
    assert "rec;dur=" in response.headers["Server-Timing"]


def test_spans_are_read_one_by_one_in_order():
    fake = FakeRecognizer()
    with client(fake) as http:
        data = http.post("/recognize", json=body(spans=[[0, 8], [12, 20]])).json()
    assert [(r["start"], r["end"]) for r in data["results"]] == [(0, 8), (12, 20)]
    assert [r["top"][0]["name"] for r in data["results"]] == ["병원", "학교"]
    assert [call[1] for call in fake.calls] == [(0, 7), (12, 19)]


def test_fifty_five_joints_are_padded_with_a_zero_face():
    fake = FakeRecognizer()
    with client(fake) as http:
        assert http.post("/recognize", json=body(joints=55, fill=0.25)).status_code == 200
    shape, _, _, face = fake.calls[0]
    assert shape == (20, 125, 3) and face == 0.0
    # 얼굴까지 쓰는 읽는 모델에는 55점을 넣을 수 없다
    with client(FakeRecognizer(with_face=True)) as http:
        assert http.post("/recognize", json=body(joints=55)).status_code == 422
        assert http.post("/recognize", json=body(joints=125)).status_code == 200


def test_malformed_requests_never_reach_the_recognizer():
    fake = FakeRecognizer()
    good = body()
    bad = [
        {**good, "frames": 21},                         # 길이가 프레임 수와 다름
        {**good, "data": good["data"][:-4] + "!!!!"},   # base64 가 아님
        {**good, "joints": 60},                         # 55 · 125 만
        {**good, "spans": [[5, 5]]},                    # 빈 구간
        {**good, "spans": [[0, 3]]},                    # 너무 짧음 (4프레임 미만)
        {**good, "spans": [[0, 21]]},                   # 범위 밖
        {**good, "spans": [[0, 8, 9]]},                 # 쌍이 아님
        {**good, "spans": [[0, 8]] * 33},               # 너무 많음
        {**good, "extra": 1},                           # 모르는 칸
        body(frames=2),                                 # 동작이 너무 짧음
        {"joints": 125, "frames": 20},                  # 좌표 없음
    ]
    nan = np.zeros((20, 125, 3), np.float32)
    nan[3, 4, 1] = np.nan
    bad.append({**good, "data": base64.b64encode(nan.tobytes()).decode()})
    with client(fake) as http:
        for request in bad:
            assert http.post("/recognize", json=request).status_code == 422, json.dumps(request)[:80]
        too_long = Settings(max_frames=10)
    with client(fake, too_long) as http:
        assert http.post("/recognize", json=good).status_code == 422
    assert fake.calls == []


def test_unavailable_busy_and_failure_are_explicit():
    with client(None) as http:  # 읽는 모델을 설정하지 않은 서버
        assert http.post("/recognize", json=body()).status_code == 503
        assert http.get("/health").status_code == 200  # 생성 쪽 준비 상태와는 별개다

    fake = FakeRecognizer()
    fake.gate = threading.Event()
    with client(fake) as http:
        results = []
        first = threading.Thread(target=lambda: results.append(http.post("/recognize", json=body()).status_code))
        first.start()
        # 첫 요청이 읽는 모델 안에 들어간 것(자물쇠를 잡은 것)을 확인한 뒤에 둘째를 보낸다.
        # 그냥 되풀이해 보내면 둘째가 먼저 자물쇠를 잡아 첫 요청이 503 을 받는 수가 있었다
        assert fake.entered.wait(30)
        second = http.post("/recognize", json=body())
        assert second.status_code == 503 and second.headers.get("Retry-After") == "1"
        fake.gate.set()
        first.join(30)
        assert results == [200]
        fake.gate = None
        assert http.post("/recognize", json=body()).status_code == 200  # 끝나면 다시 받는다

    class Broken(FakeRecognizer):
        def score(self, motion, active=None):
            raise RuntimeError("C:/secret/path/model.pt")

    with client(Broken()) as http:
        response = http.post("/recognize", json=body())
    assert response.status_code == 500 and "secret" not in response.text


def test_item_names_prefer_the_gloss_table_then_the_word_generator():
    table = {"units": {"W:WORD0773": {"source": "WORD", "name": "병원(표)"}, "S:가다": {"source": "SEN", "name": "가다"}}, "glosses": {}}
    names = item_names(table, FakeGenerator())
    assert names == {"WORD0773": "병원(표)", "WORD0002": "학교"}
    assert item_names(None, object()) == {}
