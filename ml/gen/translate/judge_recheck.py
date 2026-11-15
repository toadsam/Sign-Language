"""사람 판정한 문장으로 새 번역기를 다시 확인 (집계 숫자만 출력).

    python -m gen.translate.judge_recheck --judge <판정 결과 JSON> --old-model <판정 때 학습 파일> \
        --new-model <새 학습 파일> --pairs <엑셀> [--out result.json]

  (a) 판정 때 "빠짐"으로 표시한 정답 글로스 중 새 출력에 들어온 개수
  (b) 판정 때 "엉뚱함"으로 표시한 번역기 글로스 중 새 출력에 아직 남은 개수
  (c) 새 출력에 새로 생긴 글로스(이전 출력보다 많아진 것) 중 그 한국어 문장의 어느 사람 번역에도 없는 것의 개수와 문장 수
      (새 엉뚱함 후보. 사람이 다시 봐야 확정된다)
  (d) 바뀐 문장 수
"""
import argparse
import collections
import json
from pathlib import Path

from gen.translate.evaluate import all_references
from gen.translate.pairs import read_pairs
from gen.translate.translator import load_translator


def recheck(results, by_id, old_t, new_t, all_pairs):
    c = collections.Counter()
    for r in results:
        p = by_id[r["id"]]
        old = old_t.translate(p["korean"])["gloss"]
        new = new_t.translate(p["korean"])["gloss"]
        newc, oldc = collections.Counter(new), collections.Counter(old)
        c["sentences"] += 1
        c["changed"] += old != new
        for m in r.get("missing", []):
            c["missing_marked"] += 1
            c["missing_recovered"] += newc[m["gloss"]] > oldc[m["gloss"]]  # 이전보다 많이 나오면 되살아남
        for w in r.get("wrong", []):
            c["wrong_marked"] += 1
            c["wrong_still"] += newc[w["gloss"]] > 0
        humans = {g for ref in all_references([p], all_pairs)[0] for g in ref}
        added = newc - collections.Counter(old)
        bad = sum(n for g, n in added.items() if g not in humans)
        c["added_glosses"] += sum(added.values())
        c["added_not_in_any_human"] += bad
        c["sentences_with_added_not_in_any_human"] += bad > 0
    return dict(c)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--judge", required=True)
    p.add_argument("--old-model", required=True)
    p.add_argument("--new-model", required=True)
    p.add_argument("--pairs", required=True)
    p.add_argument("--out")
    a = p.parse_args()
    results = json.loads(Path(a.judge).read_text(encoding="utf-8"))["results"]
    all_pairs = read_pairs(a.pairs)
    by_id = {x["id"]: x for x in all_pairs}
    out = recheck(results, by_id, load_translator(a.old_model), load_translator(a.new_model), all_pairs)
    print(json.dumps(out, ensure_ascii=False))
    if a.out:
        Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
