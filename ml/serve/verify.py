"""검증 화면(GET /verify): 한국어 문장 → /translate → /generate → 2D 정면 재생. 외부 CDN 없음.

뼈대 연결선은 ml/common/skeleton.py(재훈)의 all_edges()를 그대로 읽어 HTML에 넣는다.
"""
import functools
import importlib.util
import json
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _skeleton():
    path = _HERE.parent / "common" / "skeleton.py"
    spec = importlib.util.spec_from_file_location("_serve_skeleton", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@functools.cache
def verify_html() -> str:
    sk = _skeleton()
    meta = {"edges": sk.all_edges(), "body": [sk.BODY.start, sk.BODY.stop],
            "hands": [sk.LHAND.start, sk.RHAND.stop], "face": [sk.FACE.start, sk.FACE.stop]}
    page = (_HERE / "verify.html").read_text(encoding="utf-8")
    return page.replace("/*SKELETON*/null", json.dumps(meta, separators=(",", ":")))
