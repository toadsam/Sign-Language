"""단계별 표의 "만든 동작" 줄을 잰다: 문장 모델이 만든 동작을 읽는 모델이 원래 낱말로 읽는가.

실제 동작(97%) → 자모표로 다시 그린 동작(78%) 다음 줄이 비어 있었다. 이 스크립트가 그 줄을 채운다.
켜져 있는 서버(Spring 8080 → 추론 서버 8000)에 낱말 · 문장을 넣고, 돌아온 동작을 읽기 통로에 다시 넣는다.
좌표는 저장하지도 출력하지도 않는다. 낱말별 맞음/틀림과 요약 숫자만 남긴다.

세 묶음을 잰다.
  A  낱말 데이터에서 온 낱말(기본 단위가 W:)을 무작위로 뽑아 하나씩 만든다. 같은 낱말을 여러 번 만들어 "여러 개 중 고르기"의 여지도 본다
  B  문장 데이터에서 온 낱말(기본 단위가 S:) 가운데 낱말 데이터에도 같은 이름이 있는 것. 문장에 실제로 쓰이는 낱말들이다
  C  문장을 통째로 만들고, 낱말 구간마다 읽는다

사용 (VM 에서, 서버를 켠 뒤):
  python stage_table.py --table <gloss_table_v2.json> --sentences <문장 목록.json> --out <결과.json>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
import urllib.error
import urllib.request


def call(api: str, path: str, body: dict, timeout: float = 120.0):
    """POST 한 번. 바쁨(429 · 503)이면 잠깐 쉬고 다시 묻는다."""
    data = json.dumps(body).encode("utf-8")
    for attempt in range(4):
        request = urllib.request.Request(api + path, data=data, headers={"Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as answer:
                return answer.status, json.loads(answer.read())
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < 3:
                time.sleep(1.0 + attempt)
                continue
            try:
                return error.code, json.loads(error.read())
            except Exception:
                return error.code, {}
        except Exception:
            if attempt == 3:
                return 0, {}
            time.sleep(1.0 + attempt)
    return 0, {}


def read_span(api: str, gen: dict, span: list[int]):
    """만든 동작의 한 구간을 읽는 모델에 넣어 후보(위에서부터)를 받는다."""
    status, rec = call(api, "/api/sign/recognize", {"joints": 125, "frames": gen["frames"], "data": gen["data"], "spans": [span]})
    if status != 200 or not rec.get("results"):
        return None
    return rec["results"][0].get("top") or []


def judge(top: list[dict], items: set[str], name: str):
    """1등 · 5등 안에 원래 낱말이 있는지. 같은 이름에 번호가 여럿인 낱말이 있어 이름이 같아도 맞은 것으로 본다."""
    same = [(c.get("item") in items) or (c.get("name") == name) for c in top]
    prob = next((float(c.get("prob", 0.0)) for c, ok in zip(top, same) if ok), 0.0)
    return bool(same[:1] and same[0]), any(same[:5]), prob


def fingerprint(gen: dict) -> str:
    """같은 낱말을 다시 만들었을 때 동작이 달라졌는지 보려는 지문 (좌표 자체는 남기지 않는다)."""
    return hashlib.sha1(json.dumps(gen["data"]).encode("utf-8")).hexdigest()[:12]


def rate(hits: list[bool]) -> float:
    return round(100.0 * sum(hits) / len(hits), 2) if hits else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--table", required=True, help="글로스 표 (gloss_table_v2.json)")
    parser.add_argument("--sentences", default=None, help="문장 목록 JSON (문자열 배열)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--words", type=int, default=100, help="묶음 A 에서 잴 낱말 수")
    parser.add_argument("--tries", type=int, default=3, help="묶음 A 에서 낱말 하나를 몇 번 만들지")
    parser.add_argument("--seed", type=int, default=1115)
    args = parser.parse_args()

    table = json.load(open(args.table, encoding="utf-8"))
    units, glosses = table["units"], table["glosses"]
    # 이름 → 읽는 모델의 단어 번호들 (낱말 데이터에서 온 단위만)
    items_of: dict[str, set[str]] = {}
    for unit, info in units.items():
        if unit.startswith("W:") and isinstance(info.get("name"), str):
            items_of.setdefault(info["name"], set()).add(unit[2:])
    word_default = sorted(name for name, g in glosses.items() if str(g.get("default", "")).startswith("W:") and name in items_of)
    sen_default = sorted(name for name, g in glosses.items() if str(g.get("default", "")).startswith("S:") and name in items_of)

    def one_word(name: str, tries: int):
        """낱말 하나를 tries 번 만들고 읽는다. 그 낱말 하나로 빠짐없이 그렸을 때만 센다."""
        rows = []
        for _ in range(tries):
            status, gen = call(args.api, "/api/sign/generate", {"text": name})
            segs = gen.get("segments") or [] if status == 200 else []
            if status != 200 or not gen.get("frames") or gen.get("unknown") or len(segs) != 1 or segs[0].get("gloss") != name:
                return None
            top = read_span(args.api, gen, [segs[0]["start"], segs[0]["end"]])
            if top is None:
                return None
            hit1, hit5, prob = judge(top, items_of[name], name)
            rows.append({"hit1": hit1, "hit5": hit5, "prob": round(prob, 4), "frames": gen["frames"], "print": fingerprint(gen), "read": (top[0].get("name") or top[0].get("item")) if top else None})
        return rows

    began = time.time()
    result: dict = {"table": {"glosses": len(glosses), "word_default": len(word_default), "sen_default_with_word": len(sen_default)}}

    # ── A: 낱말 데이터에서 온 낱말을 무작위로 ──
    order = word_default[:]
    random.Random(args.seed).shuffle(order)
    a_rows, a_skipped = [], 0
    for name in order:
        if len(a_rows) >= args.words:
            break
        rows = one_word(name, args.tries)
        if rows is None:
            a_skipped += 1
            continue
        a_rows.append({"word": name, "tries": rows})
    result["A"] = {
        "words": len(a_rows), "skipped": a_skipped, "tries": args.tries,
        "top1_first": rate([r["tries"][0]["hit1"] for r in a_rows]),
        "top5_first": rate([r["tries"][0]["hit5"] for r in a_rows]),
        "top1_all_tries": rate([t["hit1"] for r in a_rows for t in r["tries"]]),
        "top5_all_tries": rate([t["hit5"] for r in a_rows for t in r["tries"]]),
        "top1_any_try": rate([any(t["hit1"] for t in r["tries"]) for r in a_rows]),
        "top1_every_try": rate([all(t["hit1"] for t in r["tries"]) for r in a_rows]),
        "differs_between_tries": rate([len({t["print"] for t in r["tries"]}) > 1 for r in a_rows]),
        "rows": a_rows,
    }

    # ── B: 문장 데이터에서 온 낱말 (낱말 데이터에도 같은 이름이 있는 것 전부) ──
    b_rows, b_skipped = [], 0
    for name in sen_default:
        rows = one_word(name, 1)
        if rows is None:
            b_skipped += 1
            continue
        b_rows.append({"word": name, "tries": rows})
    result["B"] = {
        "words": len(b_rows), "skipped": b_skipped,
        "top1": rate([r["tries"][0]["hit1"] for r in b_rows]),
        "top5": rate([r["tries"][0]["hit5"] for r in b_rows]),
        "rows": b_rows,
    }

    # ── C: 문장 안의 낱말 구간 ──
    if args.sentences:
        sentences = json.load(open(args.sentences, encoding="utf-8"))
        c_rows, drawn, no_label = [], 0, 0
        for text in sentences:
            status, gen = call(args.api, "/api/sign/generate", {"text": text})
            segs = gen.get("segments") or [] if status == 200 else []
            if status != 200 or not gen.get("frames") or gen.get("unknown") or not segs:
                continue
            drawn += 1
            for seg in segs:
                name = seg.get("gloss")
                if name not in items_of:  # 읽는 모델에 그 낱말이 없으면 맞힐 수 없으니 세지 않는다
                    no_label += 1
                    continue
                top = read_span(args.api, gen, [seg["start"], seg["end"]])
                if top is None:
                    continue
                hit1, hit5, prob = judge(top, items_of[name], name)
                source = "W" if str(glosses.get(name, {}).get("default", "")).startswith("W:") else "S"
                c_rows.append({"sentence": text, "word": name, "source": source, "hit1": hit1, "hit5": hit5, "prob": round(prob, 4), "length": seg["end"] - seg["start"]})
        result["C"] = {
            "sentences": drawn, "segments": len(c_rows), "segments_without_label": no_label,
            "top1": rate([r["hit1"] for r in c_rows]),
            "top5": rate([r["hit5"] for r in c_rows]),
            "top1_word_source": rate([r["hit1"] for r in c_rows if r["source"] == "W"]),
            "top1_sentence_source": rate([r["hit1"] for r in c_rows if r["source"] == "S"]),
            "n_word_source": sum(r["source"] == "W" for r in c_rows),
            "n_sentence_source": sum(r["source"] == "S" for r in c_rows),
            "rows": c_rows,
        }

    result["seconds"] = round(time.time() - began, 1)
    json.dump(result, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    summary = {k: ({kk: vv for kk, vv in v.items() if kk != "rows"} if isinstance(v, dict) else v) for k, v in result.items()}
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
