import base64

import numpy as np

from .models import MotionResponse


class InvalidMotion(ValueError):
    pass


def check_segments(segments, gloss: list[str], frames: int) -> list[dict]:
    """응답 ⑤ segments: [{"gloss": 원래 글로스 이름, "start": 첫 프레임, "end": 끝 프레임 다음}], 시간 순."""
    if not isinstance(segments, list):
        raise InvalidMotion("segments must be a list")
    out, last = [], 0
    for seg in segments:
        if not isinstance(seg, dict) or set(seg) != {"gloss", "start", "end"}:
            raise InvalidMotion("segment must have gloss, start, end")
        name, start, end = seg["gloss"], seg["start"], seg["end"]
        if type(name) is not str or name not in gloss:
            raise InvalidMotion("segment gloss must be original gloss")
        if type(start) is not int or type(end) is not int or not last <= start < end <= frames:
            raise InvalidMotion("segment frames must be ordered and inside the motion")
        out.append({"gloss": name, "start": start, "end": end})
        last = end
    return out


def serialize(result: dict, gloss: list[str], max_frames: int, segments: bool = False) -> MotionResponse:
    """Reject bad internal output before converting to C-order little-endian bytes.

    segments=True일 때만 생성기가 준 구간을 응답에 싣는다(문장 모드). 기본은 예전처럼 [].
    """
    motion = result.get("motion")
    if not isinstance(motion, np.ndarray) or motion.ndim != 3 or motion.shape[1:] != (125, 3):
        raise InvalidMotion("motion must have shape [T,125,3]")
    if motion.dtype.kind != "f" or motion.dtype.itemsize != 4:
        raise InvalidMotion("motion must be float32")
    frames = motion.shape[0]
    if frames > max_frames:
        raise InvalidMotion("motion exceeds frame limit")
    if not np.isfinite(motion).all():
        raise InvalidMotion("motion must contain finite coordinates")
    if type(result.get("fps")) is not int or result["fps"] != 30:
        raise InvalidMotion("fps must be 30")
    unknown, tokens = result.get("unknown"), result.get("tokens")
    if not isinstance(unknown, list) or any(type(word) is not str or word not in gloss for word in unknown):
        raise InvalidMotion("unknown must contain original gloss")
    if not isinstance(tokens, list) or any(type(token) is not int or token < 0 for token in tokens):
        raise InvalidMotion("tokens must be nonnegative integers")
    if result.get("source") not in ("baseline", "model") or (result["source"] == "baseline" and tokens):
        raise InvalidMotion("invalid generator source or baseline tokens")
    all_unknown = all(word in unknown for word in gloss)
    if (frames == 0) != all_unknown or (all_unknown and tokens):
        raise InvalidMotion("empty motion must represent all-unknown input")
    raw = motion.astype("<f4", copy=False).tobytes(order="C")
    if len(raw) != frames * 125 * 3 * 4:
        raise InvalidMotion("coordinate byte count mismatch")
    segs = check_segments(result.get("segments", []), gloss, frames) if segments else []
    return MotionResponse(frames=frames, data=base64.b64encode(raw).decode("ascii"),
                          tokens=tokens, segments=segs, unknown=unknown, source=result["source"])
