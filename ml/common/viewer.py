"""동작 두 개를 나란히 재생하는 뷰어 HTML 만들기 (../viewer/skeleton_viewer.html 템플릿 사용)."""
import json
import os

import numpy as np

from common.skeleton import BODY, FACE, LHAND, RHAND, all_edges

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(os.path.dirname(ML_ROOT), "viewer", "skeleton_viewer.html")


def write_viewer(path, clips, labels=("원본", "자모표로 바꿨다 되돌린 것"), title=None, down=4):
    """clips: [{"name", "split", "a": [Ta,375], "b": [Tb,375], "tokens": [...], "active": [s, e]}]"""
    if not os.path.exists(TEMPLATE):
        print(f"뷰어 템플릿이 없어 건너뜀: {TEMPLATE}")
        return
    data = {"edges": all_edges(), "down": down, "fps": 30, "labels": list(labels), "title": title,
            "parts": {"body": [BODY.start, BODY.stop], "lhand": [LHAND.start, LHAND.stop],
                      "rhand": [RHAND.start, RHAND.stop], "face": [FACE.start, FACE.stop]}, "clips": []}
    for c in clips:
        a, b = np.asarray(c["a"]), np.asarray(c["b"])
        data["clips"].append({
            "name": c["name"], "split": c.get("split", ""), "frames": int(max(len(a), len(b))),
            "active": c.get("active") or [0, int(max(len(a), len(b)) - 1)], "tokens": list(c.get("tokens", [])),
            "orig": np.round(a.reshape(-1), 3).tolist(), "recon": np.round(b.reshape(-1), 3).tolist(),
        })
    html = open(TEMPLATE, encoding="utf-8").read().replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"뷰어: {path}")
