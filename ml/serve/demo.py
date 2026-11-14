"""Explicit test-only factory. These coordinates are not sign-language motion."""
import numpy as np

from .app import create_app


class SyntheticGenerator:
    def generate(self, gloss, nonmanual=(), seed=None):
        unknown = [word for word in gloss if word not in {"화장실", "있다"}]
        frames = 1 if any(word not in unknown for word in gloss) else 0
        motion = np.zeros((frames, 125, 3), dtype=np.float32)
        if frames:
            motion[0, :, 0] = np.arange(125, dtype=np.float32) / 125
        return dict(fps=30, motion=motion, tokens=[], unknown=unknown, source="baseline")


def create_demo_app():
    return create_app(generator_factory=SyntheticGenerator)


# 문장 경로 시연용 작은 글로스 표. 이름은 일상어 몇 개로 지어낸 것이고 AI Hub 표가 아니다.
DEMO_TABLE = {"schema_version": 2, "units": {}, "glosses": {}}
for _name, _unit in [("화장실", "S:화장실"), ("어디", "S:어디"), ("있다", "S:있다"), ("나", "W:WORD9001"),
                     ("학교", "W:WORD9002"), ("가다", "S:가다"), ("오늘", "S:오늘")]:
    DEMO_TABLE["units"][_unit] = {"source": "SEN" if _unit.startswith("S:") else "WORD", "name": _name}
    DEMO_TABLE["glosses"][_name] = {"default": _unit, "alts": [], "homonym": False, "senses": {}}


def create_sentence_demo_app():
    """문장 모드 + stub 번역기 + 가짜 문장 생성기. SIGN_GLOSS_TABLE이 있으면 그 표를 쓴다."""
    import os

    from . import sentence
    from .settings import Settings

    path = os.environ.get("SIGN_GLOSS_TABLE")
    table = sentence.load_gloss_table(path) if path else DEMO_TABLE
    settings = Settings(mode="sentence", gloss_table=path)
    return create_app(settings,
                      generator_factory=lambda: sentence.GlossSentenceAdapter(
                          sentence.SyntheticSentenceGenerator(), table),
                      translator_factory=lambda: sentence.StubTranslator(table))
