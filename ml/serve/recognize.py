"""읽기 경로: 동작 좌표를 읽는 모델(계약 ④ Recognizer.score)에 넣어 어떤 단어로 읽히는지 돌려준다.

  POST /recognize
    {"joints": 125 | 55, "frames": T, "data": "base64(float32 little-endian [T × joints × 3])",
     "spans": [[start, end], ...]}        # 생략하면 동작 전체를 한 번 읽는다. end 는 끝 프레임 다음
  → {"classes": 3000,
     "results": [{"start": 0, "end": T, "top": [{"item": "WORD0773", "name": "병원", "prob": 0.82}, ...]}]}

- 좌표는 계약 ①과 같다(목 원점, 어깨너비 1). 55점은 앞 55점(상체 13 · 왼손 21 · 오른손 21)이고 얼굴은 0으로 채운다.
- 읽는 모델은 승현의 것을 고치지 않고 그대로 부른다. 단어 클립으로 배운 모델이라
  문장 속 낱말이나 웹캠 좌표는 잘 못 읽을 수 있다. 여기서는 읽은 결과만 전하고 맞다 · 틀리다를 판정하지 않는다.
- name 은 단어 번호의 한국어 이름이다. 글로스 표나 단어 생성기의 단어표에서 찾고, 없으면 null.
"""
import base64
import binascii
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr

MAX_SPANS = 32
MIN_SPAN_FRAMES = 4
TOP = 5


class RecognizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    joints: Literal[55, 125]
    frames: StrictInt
    data: StrictStr
    spans: list[list[StrictInt]] = Field(default_factory=list)


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    item: StrictStr
    name: StrictStr | None
    prob: StrictFloat


class SpanResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    start: StrictInt
    end: StrictInt
    top: list[Candidate]


class RecognizeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    classes: StrictInt
    results: list[SpanResult]


class InvalidRecognition(ValueError):
    """요청이 틀렸다 (422)."""


def decode(request: RecognizeRequest, max_frames: int) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """요청을 [T, 125, 3] float32 와 읽을 구간 목록으로 바꾼다. 틀리면 InvalidRecognition."""
    frames, joints = request.frames, request.joints
    if not MIN_SPAN_FRAMES <= frames <= max_frames:
        raise InvalidRecognition("frames out of range")
    expected = frames * joints * 3 * 4
    if len(request.data) != (expected + 2) // 3 * 4:
        raise InvalidRecognition("data length does not match frames")
    try:
        raw = base64.b64decode(request.data, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidRecognition("data is not base64") from None
    if len(raw) != expected:
        raise InvalidRecognition("data length does not match frames")
    points = np.frombuffer(raw, dtype="<f4").reshape(frames, joints, 3)
    if not np.isfinite(points).all() or np.abs(points).max() > 100:
        raise InvalidRecognition("coordinates must be finite")
    motion = np.zeros((frames, 125, 3), dtype=np.float32)
    motion[:, :joints] = points
    if len(request.spans) > MAX_SPANS or any(len(span) != 2 for span in request.spans):
        raise InvalidRecognition("spans must be at most 32 [start, end] pairs")
    spans = [(span[0], span[1]) for span in request.spans] or [(0, frames)]
    for start, end in spans:
        if not (0 <= start < end <= frames) or end - start < MIN_SPAN_FRAMES:
            raise InvalidRecognition("span out of range or too short")
    return motion, spans


def item_names(table: dict | None, generator=None) -> dict[str, str]:
    """단어 번호 → 한국어 이름. 글로스 표의 W 단위가 먼저, 없으면 단어 생성기의 단어표(이름 → 번호)를 뒤집는다."""
    names: dict[str, str] = {}
    if isinstance(table, dict):
        for unit, info in (table.get("units") or {}).items():
            if isinstance(unit, str) and unit.startswith("W:") and isinstance(info, dict) and isinstance(info.get("name"), str):
                names.setdefault(unit[2:], info["name"])
    mapping = getattr(generator, "mapping", None)
    if isinstance(mapping, dict):
        for name, item in mapping.items():
            if isinstance(name, str) and isinstance(item, str):
                names.setdefault(item, name)
    return names


def uses_face(recognizer) -> bool:
    checkpoint = getattr(recognizer, "checkpoint", None)
    return bool(isinstance(checkpoint, dict) and checkpoint.get("with_face"))


def read(recognizer, motion: np.ndarray, spans: list[tuple[int, int]], names: dict[str, str]) -> RecognizeResponse:
    """구간마다 읽는 모델을 한 번씩 부른다. active 는 끝 프레임을 포함하므로 end - 1 을 넘긴다."""
    results = []
    classes = 0
    for start, end in spans:
        scored = recognizer.score(motion, active=(start, end - 1))
        top = scored.get("top5") if isinstance(scored, dict) else None
        if not isinstance(top, list) or not top:
            raise ValueError("recognizer returned no candidates")
        candidates = []
        for item, prob in top[:TOP]:
            prob = float(prob)
            if type(item) is not str or not np.isfinite(prob):
                raise ValueError("recognizer returned a malformed candidate")
            candidates.append(Candidate(item=item, name=names.get(item), prob=prob))
        probs = scored.get("probs")
        classes = max(classes, int(len(probs)) if probs is not None else len(candidates))
        results.append(SpanResult(start=start, end=end, top=candidates))
    return RecognizeResponse(classes=classes, results=results)
