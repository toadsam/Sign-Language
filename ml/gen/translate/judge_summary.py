"""사람 판정 결과 집계: 오류 종류별 개수 · 비율, 표시한 칩 수.

    python -m gen.translate.judge_summary <translate_judge_*.json> [더 많은 결과 파일 ...]

"뜻이 맞음" = 정답과 같음 + 다른 표현이지만 뜻이 맞음,
"빠짐 있음" = 단어가 빠짐 + 둘 다, "엉뚱함 있음" = 엉뚱한 글로스가 있음 + 둘 다.
글로스 이름 목록은 출력하지 않는다(--show-glosses를 줄 때만, 많이 표시된 순 상위 10개).
"""
import argparse
import collections
import json
from pathlib import Path

from gen.translate.judge_page import CHOICES


def summarize(results):
    """results: 결과 JSON의 results 목록 (여러 파일이면 이어 붙인 것)."""
    judged = [r for r in results if r.get("verdict")]
    n = len(judged)
    counts = collections.Counter(r["verdict"] for r in judged)
    by_kind = {k: {"label": label, "count": counts.get(k, 0), "ratio": counts.get(k, 0) / n if n else 0.0}
               for k, label in CHOICES}

    def ratio(keys):
        c = sum(counts.get(k, 0) for k in keys)
        return {"count": c, "ratio": c / n if n else 0.0}

    wrong = collections.Counter(w["gloss"] for r in judged for w in r.get("wrong", []))
    missing = collections.Counter(m["gloss"] for r in judged for m in r.get("missing", []))
    return {"total": len(results), "judged": n, "by_kind": by_kind,
            "meaning_ok": ratio(["same", "paraphrase"]), "has_missing": ratio(["missing", "both"]),
            "has_wrong": ratio(["wrong", "both"]),
            "marked_wrong_chips": sum(wrong.values()), "marked_missing_chips": sum(missing.values()),
            "notes": sum(1 for r in judged if r.get("note")),
            "_top_wrong": wrong.most_common(10), "_top_missing": missing.most_common(10)}


def table_md(s):
    lines = ["| 종류 | 개수 | 비율 |", "|---|---|---|"]
    for v in s["by_kind"].values():
        lines.append(f"| {v['label']} | {v['count']} | {v['ratio']:.1%} |")
    for key, label in (("meaning_ok", "뜻이 맞음 (같음 + 다른 표현)"), ("has_missing", "빠짐 있음"),
                       ("has_wrong", "엉뚱함 있음")):
        lines.append(f"| **{label}** | {s[key]['count']} | {s[key]['ratio']:.1%} |")
    lines.append(f"\n판정 {s['judged']} / {s['total']}문장, 표시한 칩: 엉뚱함 {s['marked_wrong_chips']} · "
                 f"빠짐 {s['marked_missing_chips']}, 메모 {s['notes']}개")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("files", nargs="+")
    p.add_argument("--show-glosses", action="store_true")
    a = p.parse_args()
    results = []
    for f in a.files:
        results.extend(json.loads(Path(f).read_text(encoding="utf-8"))["results"])
    s = summarize(results)
    print(table_md(s))
    if a.show_glosses:
        print("많이 표시된 엉뚱함:", s["_top_wrong"])
        print("많이 표시된 빠짐:", s["_top_missing"])


if __name__ == "__main__":
    main()
