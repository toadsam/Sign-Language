"""단계별 표의 대조 실험: 같은 읽기 통로에 "사람 동작"을 넣으면 읽히는가.

stage_table.py 에서 낱말 데이터에서 온 낱말이 거의 안 읽혔다. 그것이 만든 동작 탓인지, 재는 통로(서버의 /recognize)
탓인지 가르려고, 문장 모델 run 폴더의 baseline.npz(단위마다 학습 데이터에서 고른 대표 동작, 사람이 한 것)를
같은 통로에 넣는다. 여기서 잘 읽히면 통로는 멀쩡하고, 못 읽은 것은 만든 동작 쪽 문제다.

주의: 대표 동작은 읽는 모델이 학습 때 본 클립일 수 있다. "통로가 멀쩡한가"만 보는 대조이고, 정확도 숫자로 쓰지 않는다.

사용 (VM 에서, ml 폴더에서, 서버를 켠 뒤):
  python -m vq.stage_table_control --run <문장 GPT run 폴더> --table <gloss_table_v2.json> --result <stage_table 결과.json>
"""
from __future__ import annotations

import argparse
import base64
import json
import urllib.request

import numpy as np

from gen.sentence_generator import load_sentence_generator


def read(api: str, motion: np.ndarray, span: tuple[int, int]):
    body = {"joints": 125, "frames": int(len(motion)), "data": base64.b64encode(motion.astype("<f4").tobytes()).decode("ascii"), "spans": [list(span)]}
    request = urllib.request.Request(api + "/recognize", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as answer:
        return json.loads(answer.read())["results"][0]["top"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="추론 서버 (FastAPI)")
    parser.add_argument("--run", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--result", required=True, help="stage_table.py 가 쓴 결과. 같은 낱말로 잰다")
    args = parser.parse_args()

    table = json.load(open(args.table, encoding="utf-8"))
    units, glosses = table["units"], table["glosses"]
    items_of: dict[str, set[str]] = {}
    for unit, info in units.items():
        if unit.startswith("W:") and isinstance(info.get("name"), str):
            items_of.setdefault(info["name"], set()).add(unit[2:])
    result = json.load(open(args.result, encoding="utf-8"))
    generator = load_sentence_generator(args.run, device="cpu", mode="baseline")

    summary = {}
    for group in ("A", "B"):
        hit1, hit5, missing, lengths = [], [], 0, []
        for row in result[group]["rows"]:
            name = row["word"]
            unit = glosses[name]["default"]
            out = generator.generate([unit])
            if not out["segments"]:
                missing += 1
                continue
            seg = out["segments"][0]
            top = read(args.api, out["motion"], (int(seg["start"]), int(seg["end"])))
            same = [(c.get("item") in items_of[name]) or (c.get("name") == name) for c in top]
            hit1.append(bool(same and same[0]))
            hit5.append(any(same[:5]))
            lengths.append(int(seg["end"]) - int(seg["start"]))
        n = len(hit1)
        summary[group] = {"words": n, "no_baseline": missing, "top1": round(100 * sum(hit1) / n, 2) if n else None,
                          "top5": round(100 * sum(hit5) / n, 2) if n else None, "mean_frames": round(float(np.mean(lengths)), 1) if n else None}
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
