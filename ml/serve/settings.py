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

    def __post_init__(self):
        for name in ("max_words", "max_word_chars", "max_input_chars", "max_nonmanual", "max_frames"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")

    @classmethod
    def from_env(cls):
        limits = {name: int(os.environ.get(f"SIGN_{name.upper()}", field.default))
                  for name, field in cls.__dataclass_fields__.items() if name.startswith("max_")}
        return cls(run_dir=os.environ.get("SIGN_RUN_DIR"),
                   device=os.environ.get("SIGN_DEVICE", "cpu"), **limits)
