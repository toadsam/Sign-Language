import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    run_dir: str | None = None
    device: str = "cpu"
    max_words: int = 128
    max_word_chars: int = 100
    max_input_chars: int = 4096
    max_nonmanual: int = 16
    max_frames: int = 1800
    # 문장 경로 (2026-11-14). mode="word"이면 예전과 똑같다.
    mode: str = "word"                       # "word" | "sentence"
    gloss_table: str | None = None           # 글로스 표 v2 JSON
    translator: str = "stub"                 # "stub" | "module:function" (load_translator)
    translator_path: str | None = None       # 실제 번역기의 학습 결과 JSON
    sentence_generator: str = "synthetic"    # "synthetic" | "word" | "module:function"
    sentence_run_dir: str | None = None      # 실제 문장 생성기 run 폴더
    sentence_signer: str | None = None
    segments: bool = True                    # 문장 모드에서 응답 segments를 채울지
    verify_page: bool = True                 # GET /verify

    def __post_init__(self):
        for name in ("max_words", "max_word_chars", "max_input_chars", "max_nonmanual", "max_frames"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.mode not in ("word", "sentence"):
            raise ValueError("mode must be word or sentence")

    @classmethod
    def from_env(cls):
        env = os.environ.get
        limits = {name: int(env(f"SIGN_{name.upper()}", field.default))
                  for name, field in cls.__dataclass_fields__.items() if name.startswith("max_")}
        flag = lambda key, default: env(key, "1" if default else "0").strip().lower() not in ("0", "false", "off", "no")
        return cls(run_dir=env("SIGN_RUN_DIR"), device=env("SIGN_DEVICE", "cpu"),
                   mode=env("SIGN_MODE", "word"), gloss_table=env("SIGN_GLOSS_TABLE"),
                   translator=env("SIGN_TRANSLATOR", "stub"), translator_path=env("SIGN_TRANSLATOR_PATH"),
                   sentence_generator=env("SIGN_SENTENCE_GENERATOR", "synthetic"),
                   sentence_run_dir=env("SIGN_SENTENCE_RUN_DIR"), sentence_signer=env("SIGN_SENTENCE_SIGNER"),
                   segments=flag("SIGN_SEGMENTS", True), verify_page=flag("SIGN_VERIFY_PAGE", True),
                   **limits)
