"""문장 경로: 한국어 문장 → 글로스 열(번역기) → 동작 단위 열(글로스 표 v2) → 동작(문장 생성기).

공유 인터페이스 (docs/plans 문장 지시서, 2026-11-14)
  Translator.translate(text) -> {"gloss", "units", "senses", "unknown", "dropped"}
  SentenceGenerator.generate(units, signer=None, seed=None)
      -> {"fps": 30, "motion": [T,125,3] float32, "tokens", "segments": [{"unit","start","end"}], "source"}

실제 부품(① gen.translate, ② 문장 GPT)이 생기기 전에 끝까지 돌리려고 임시 부품(stub)을 둔다.
  StubTranslator             글로스 표에서 띄어쓰기 단위로 찾는다(앞부분 최장 일치 + "다"/"하다")
  SyntheticSentenceGenerator 단위마다 만든 가짜 동작. 수어가 아니다(화면 확인용)
  WordConcatSentenceGenerator 단어 Generator(gen.infer, 계약 ③)를 단위마다 불러 이어 붙인다
실제 부품은 설정의 "module:function" 문자열로 끼운다(serve.settings 참고). 이 파일은 그 모양만 안다.

GlossSentenceAdapter는 문장 생성기를 계약 ③ Generator 모양(gloss 이름 열 → dict)으로 감싸
/generate가 응답 ⑤를 그대로 낼 수 있게 한다. segments의 gloss는 글로스 이름, end는 끝 프레임 다음(배타).
"""
import importlib
import json
import re
import zlib
from pathlib import Path

import numpy as np

FPS = 30
JOINTS = 125


# ---------------------------------------------------------------- 글로스 표

def load_gloss_table(path) -> dict:
    table = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(table, dict) or table.get("schema_version") != 2:
        raise ValueError("gloss table must be schema_version 2")
    if not isinstance(table.get("glosses"), dict) or not isinstance(table.get("units"), dict):
        raise ValueError("gloss table requires glosses and units")
    return table


def resolve(table: dict, name: str, sense: str | None = None):
    """gen.gloss_table.resolve와 같은 규칙. serve가 torch 없는 gen 경로에 묶이지 않게 따로 둔다."""
    g = table["glosses"].get(name)
    if g is None:
        return None
    if sense:
        for unit, meaning in g.get("senses", {}).items():
            if meaning == sense:
                return unit
    return g["default"]


def load_object(spec: str, *args, **kwargs):
    """"package.module:function" 문자열로 실제 부품의 load 함수를 불러 부른다."""
    module, sep, func = spec.partition(":")
    if not sep or not module or not func.isidentifier():
        raise ValueError("loader must look like package.module:function")
    return getattr(importlib.import_module(module), func)(*args, **kwargs)


# ---------------------------------------------------------------- 번역기

def check_translation(result: dict) -> dict:
    """번역기 결과가 공유 인터페이스 모양인지 확인하고 필요한 키만 돌려준다."""
    if not isinstance(result, dict):
        raise ValueError("translation must be a dict")
    gloss, units = result.get("gloss"), result.get("units")
    senses = result.get("senses") or [None] * len(gloss or [])
    unknown, dropped = result.get("unknown", []), result.get("dropped", [])
    if not isinstance(gloss, list) or any(type(g) is not str or not g.strip() for g in gloss):
        raise ValueError("gloss must be a list of nonempty strings")
    for name, seq in (("units", units), ("senses", senses)):
        if not isinstance(seq, list) or len(seq) != len(gloss) or any(v is not None and type(v) is not str for v in seq):
            raise ValueError(f"{name} must match gloss length with str|None")
    for name, seq in (("unknown", unknown), ("dropped", dropped)):
        if not isinstance(seq, list) or any(type(v) is not str for v in seq):
            raise ValueError(f"{name} must be a list of strings")
    return {"gloss": gloss, "units": units, "senses": senses, "unknown": unknown, "dropped": dropped}


class StubTranslator:
    """임시 번역기. 어절마다 앞부분이 가장 길게 맞는 글로스 이름을 찾는다(이름, 이름+다, 이름+하다).

    남은 뒷부분(조사·어미)은 dropped, 아무것도 못 찾은 어절은 unknown. 어순은 바꾸지 않는다.
    """

    name = "stub"

    def __init__(self, table: dict):
        self.table = table
        self.names = table["glosses"]

    def _match(self, word):
        for k in range(len(word), 0, -1):
            stem = word[:k]
            for name in (stem, stem + "다", stem + "하다"):
                if name in self.names:
                    return name, word[k:]
        return None, word

    def translate(self, text: str) -> dict:
        gloss, unknown, dropped = [], [], []
        for word in re.findall(r"[0-9A-Za-z가-힣]+", text):
            name, rest = self._match(word)
            if name is None:
                unknown.append(word)
                continue
            gloss.append(name)
            if rest:
                dropped.append(rest)
        units = [resolve(self.table, name) for name in gloss]
        return {"gloss": gloss, "units": units, "senses": [None] * len(gloss),
                "unknown": unknown, "dropped": dropped}


# ---------------------------------------------------------------- 문장 생성기 stub

def _pose(right_wrist, left_wrist, t: float) -> np.ndarray:
    """가짜 상체 자세 하나 [125,3]. 원점 목, 어깨너비 1, y 아래, 사람의 오른쪽 = 화면 왼쪽."""
    p = np.zeros((JOINTS, 3), dtype=np.float32)
    p[0] = (0, -0.45, 0)                          # 코
    p[2], p[5] = (-0.5, 0, 0), (0.5, 0, 0)        # 오른/왼 어깨
    p[8] = (0, 1.6, 0)                            # 골반 중앙
    p[9:13] = [(-0.08, -0.52, 0), (0.08, -0.52, 0), (-0.18, -0.48, 0), (0.18, -0.48, 0)]
    for shoulder, elbow, wrist, root, target, side in (
            (2, 3, 4, 34, right_wrist, -1), (5, 6, 7, 13, left_wrist, 1)):
        target = np.asarray(target, dtype=np.float32)
        p[wrist] = target
        p[elbow] = (p[shoulder] + target) / 2 + np.array([side * 0.25, 0.25, 0], dtype=np.float32)
        p[root] = target
        spread = 0.6 + 0.3 * np.sin(t * 2 * np.pi)          # 손가락 펴짐이 조금씩 바뀐다
        for finger in range(5):
            angle = np.pi / 2 + side * (finger - 2) * 0.35 * spread
            direction = np.array([np.cos(angle) * side * -1, -np.sin(angle), 0], dtype=np.float32)
            for joint in range(4):
                p[root + 1 + finger * 4 + joint] = target + direction * 0.05 * (joint + 1)
    angles = np.linspace(0, 2 * np.pi, 70, endpoint=False)  # 얼굴 70점은 타원 하나
    p[55:] = np.stack([0.16 * np.cos(angles), -0.45 + 0.2 * np.sin(angles), np.zeros(70)], 1)
    return p


_REST_R, _REST_L = (-0.45, 1.3, 0), (0.45, 1.3, 0)


class SyntheticSentenceGenerator:
    """임시 문장 생성기. 단위 이름의 해시로 손 위치를 정해 움직이는 가짜 동작. 수어가 아니다."""

    def __init__(self, unit_frames: int = 24, link_frames: int = 8, rest_frames: int = 6):
        self.unit_frames, self.link_frames, self.rest_frames = unit_frames, link_frames, rest_frames

    def _unit(self, unit):
        rng = np.random.default_rng(zlib.crc32(unit.encode("utf-8")))
        a, b = rng.uniform([-0.5, -0.3], [0.1, 0.7], (2, 2)), rng.uniform([-0.1, -0.3], [0.5, 0.7], (2, 2))
        frames = []
        for i in range(self.unit_frames):
            t = i / max(self.unit_frames - 1, 1)
            r = a[0] + (a[1] - a[0]) * t + [0, 0.06 * np.sin(4 * np.pi * t)]
            l = b[0] + (b[1] - b[0]) * t
            frames.append(_pose((*r, 0), (*l, 0), t))
        return np.stack(frames)

    @staticmethod
    def _link(prev, nxt, n):
        w = np.linspace(0, 1, n + 2, dtype=np.float32)[1:-1, None, None]
        return prev[None] * (1 - w) + nxt[None] * w

    def generate(self, units, signer=None, seed=None) -> dict:
        rest = _pose(_REST_R, _REST_L, 0)
        parts, segments, cursor = [np.repeat(rest[None], self.rest_frames, 0)], [], self.rest_frames
        for i, unit in enumerate(units):
            clip = self._unit(unit)
            prev = parts[-1][-1]
            link = self._link(prev, clip[0], self.link_frames if i else self.rest_frames)
            parts += [link, clip]
            cursor += len(link)
            segments.append({"unit": unit, "start": cursor, "end": cursor + len(clip)})
            cursor += len(clip)
        if units:
            parts += [self._link(parts[-1][-1], rest, self.rest_frames), rest[None]]
        motion = np.concatenate(parts).astype(np.float32) if units else np.empty((0, JOINTS, 3), np.float32)
        return {"fps": FPS, "motion": motion, "tokens": [], "segments": segments, "source": "baseline"}


class WordConcatSentenceGenerator:
    """단어 Generator(계약 ③)를 단위마다 한 번씩 불러 잇는다. 경계는 blend 프레임 직선 보간.

    단위의 표 이름(units[unit]["name"])을 단어 Generator에 넘긴다. 단어 쪽이 모르는 이름이면 그 단위는 빠진다.
    """

    def __init__(self, word_generator, table: dict, blend: int = 8):
        self.word, self.table, self.blend = word_generator, table, blend

    def generate(self, units, signer=None, seed=None) -> dict:
        parts, tokens, segments, cursor, sources = [], [], [], 0, set()
        for i, unit in enumerate(units):
            name = self.table["units"].get(unit, {}).get("name")
            if not name:
                continue
            result = self.word.generate(gloss=[name], seed=None if seed is None else seed + i)
            motion = np.asarray(result["motion"], dtype=np.float32)
            if name in result.get("unknown", []) or len(motion) == 0:
                continue
            if parts and self.blend:
                w = np.linspace(0, 1, self.blend + 2, dtype=np.float32)[1:-1, None, None]
                link = parts[-1][-1][None] * (1 - w) + motion[0][None] * w
                parts.append(link)
                cursor += len(link)
            parts.append(motion)
            segments.append({"unit": unit, "start": cursor, "end": cursor + len(motion)})
            cursor += len(motion)
            tokens += list(result.get("tokens", []))
            sources.add(result.get("source"))
        motion = np.concatenate(parts) if parts else np.empty((0, JOINTS, 3), np.float32)
        return {"fps": FPS, "motion": motion, "tokens": tokens, "segments": segments,
                "source": "model" if "model" in sources else "baseline"}


# ---------------------------------------------------------------- 계약 ③ 모양으로 감싸기

class GlossSentenceAdapter:
    """gloss 이름 열 → 글로스 표 → 단위 열 → SentenceGenerator → 응답 ⑤에 맞는 dict.

    표에 없는 이름과 생성기가 구간을 돌려주지 않은 단위의 이름은 unknown에 원래 이름 그대로 넣는다.
    생성기가 known(units) -> (그릴 수 있는 것, 없는 것)을 주면, 기본 단위를 못 그릴 때 alts 중 그릴 수 있는
    첫 단위로 바꾼다(11-14: 문장 GPT 학습에 없던 S 단위 16개 대응).
    """

    def __init__(self, sentence_generator, table: dict, signer: str | None = None):
        self.sentence, self.table, self.signer = sentence_generator, table, signer
        self._known = getattr(sentence_generator, "known", None)

    def _unit(self, name):
        unit = resolve(self.table, name)
        if unit is None or not callable(self._known):
            return unit
        candidates = [unit] + [a for a in self.table["glosses"][name].get("alts", []) if a != unit]
        drawable, _ = self._known(candidates)
        return next((c for c in candidates if c in drawable), unit)

    def generate(self, gloss, nonmanual=(), seed=None) -> dict:
        known = [(name, self._unit(name)) for name in gloss]
        units = [unit for _, unit in known if unit is not None]
        result = self.sentence.generate(units, signer=self.signer, seed=seed) if units else {
            "fps": FPS, "motion": np.empty((0, JOINTS, 3), np.float32), "tokens": [], "segments": [],
            "source": "baseline"}
        motion = result.get("motion")
        frames = len(motion) if isinstance(motion, np.ndarray) and motion.ndim == 3 else 0
        # 단위 열과 구간을 앞에서부터 짝짓는다(같은 단위가 여러 번 나와도 순서대로).
        segments, unknown, raw = [], [], list(result.get("segments") or [])
        for name, unit in known:
            seg = raw[0] if raw and unit is not None and raw[0].get("unit") == unit else None
            if seg is None:
                unknown.append(name)
                continue
            raw.pop(0)
            start, end = seg.get("start"), seg.get("end")
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= frames:
                raise ValueError("segment frames out of range")
            segments.append({"gloss": name, "start": start, "end": end})
        if raw:
            raise ValueError("generator returned segments for units it was not given")
        return {"fps": result.get("fps"), "motion": motion, "tokens": list(result.get("tokens") or []),
                "segments": segments, "unknown": unknown, "source": result.get("source")}
