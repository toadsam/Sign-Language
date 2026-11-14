from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    gloss: list[StrictStr]
    nonmanual: list[StrictStr] = Field(default_factory=list)


class MotionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    fps: Literal[30] = 30
    joints: Literal[125] = 125
    frames: StrictInt
    units: Literal["shoulder"] = "shoulder"
    data: StrictStr
    tokens: list[StrictInt]
    segments: list = Field(default_factory=list)
    unknown: list[StrictStr]
    source: Literal["baseline", "model"]


class TranslateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: StrictStr


class TranslateResponse(BaseModel):
    """번역기 공유 인터페이스 dict 그대로 + 어떤 번역기인지. units·senses는 gloss와 같은 길이."""
    model_config = ConfigDict(extra="forbid", strict=True)
    gloss: list[StrictStr]
    units: list[StrictStr | None]
    senses: list[StrictStr | None]
    unknown: list[StrictStr]
    dropped: list[StrictStr]
    translator: StrictStr
