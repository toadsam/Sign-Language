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
