"""문장 → 동작 전체 성공률과 응답 시간 (P4 완료 기준). 문장 내용은 출력하지 않고 집계만 낸다.

  ml/에서:
  python -m serve.check_sentences --sentences <문장 파일> [--url http://127.0.0.1:8000] [--json out.json]

문장 파일: 한 줄에 문장 하나(.txt) 또는 {"text": ...} 줄(.jsonl). --url이 없으면 환경 변수(SIGN_*) 설정으로
서버 앱을 이 프로세스 안에 띄워(TestClient) 부른다. 각 문장은 /translate → /generate 순서다.

성공 = 두 요청 모두 200이고 frames > 0. 그릴 수 있는 비율 = 생성 응답에서 unknown이 아닌 글로스 / 번역 글로스.
"""
import argparse
import json
import statistics
import time
from pathlib import Path


def read_sentences(path):
    text = Path(path).read_text(encoding="utf-8")
    if str(path).endswith(".jsonl"):
        return [json.loads(line)["text"] for line in text.splitlines() if line.strip()]
    return [line.strip() for line in text.splitlines() if line.strip()]


def http_poster(url):
    import urllib.error
    import urllib.request

    def post(path, body):
        request = urllib.request.Request(url.rstrip("/") + path, data=json.dumps(body).encode("utf-8"),
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, None
    return post, None


def local_poster():
    from fastapi.testclient import TestClient

    from serve.app import create_app

    client = TestClient(create_app()).__enter__()

    def post(path, body):
        response = client.post(path, json=body)
        return response.status_code, response.json() if response.status_code == 200 else None
    return post, client


def pct(values, q):
    if not values:
        return None
    values = sorted(values)
    return round(values[min(len(values) - 1, int(round(q * (len(values) - 1))))], 1)


def run(sentences, post):
    rows = []
    for text in sentences:
        row = {"translate": None, "generate": None, "gloss": 0, "drawn": 0, "unknown_pieces": 0,
               "frames": 0, "tr_ms": None, "gen_ms": None}
        t = time.perf_counter()
        status, tr = post("/translate", {"text": text})
        row["tr_ms"], row["translate"] = (time.perf_counter() - t) * 1000, status
        if status == 200:
            row["gloss"], row["unknown_pieces"] = len(tr["gloss"]), len(tr["unknown"])
            if tr["gloss"]:
                t = time.perf_counter()
                status, gen = post("/generate", {"gloss": tr["gloss"], "nonmanual": []})
                row["gen_ms"], row["generate"] = (time.perf_counter() - t) * 1000, status
                if status == 200:
                    row["frames"], row["drawn"] = gen["frames"], len(tr["gloss"]) - len(gen["unknown"])
        rows.append(row)
    return rows


def summarize(rows):
    n = len(rows)
    ok = [r for r in rows if r["generate"] == 200 and r["frames"] > 0]
    gloss = sum(r["gloss"] for r in rows)
    tr = [r["tr_ms"] for r in rows if r["translate"] == 200]
    gen = [r["gen_ms"] for r in rows if r["generate"] == 200]
    return {
        "sentences": n,
        "translate_ok": sum(r["translate"] == 200 for r in rows),
        "no_gloss": sum(r["translate"] == 200 and r["gloss"] == 0 for r in rows),
        "generate_ok": len(ok),
        "success_rate": round(len(ok) / n, 4) if n else None,
        "all_drawn_rate": round(sum(r["gloss"] > 0 and r["drawn"] == r["gloss"] for r in ok) / n, 4) if n else None,
        "drawable_gloss_rate": round(sum(r["drawn"] for r in rows) / gloss, 4) if gloss else None,
        "unknown_pieces": sum(r["unknown_pieces"] for r in rows),
        "translate_ms_p50": pct(tr, 0.5), "translate_ms_p90": pct(tr, 0.9),
        "generate_ms_p50": pct(gen, 0.5), "generate_ms_p90": pct(gen, 0.9),
        "seconds_p50": pct([r["frames"] / 30 for r in ok], 0.5),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sentences", required=True)
    p.add_argument("--url")
    p.add_argument("--json")
    a = p.parse_args()
    post, client = http_poster(a.url) if a.url else local_poster()
    try:
        summary = summarize(run(read_sentences(a.sentences), post))
    finally:
        if client is not None:
            client.__exit__(None, None, None)
    for key, value in summary.items():
        print(f"{key:22s} {value}")
    if a.json:
        Path(a.json).write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
