"""글로스 표 v2: 번역기가 내는 글로스 이름 → 문장 GPT가 그리는 동작 단위.

동작 단위는 두 종류다.
  S:<이름>    문장 클립 속 단어 구간 (문장 메타 segments의 name, 449개)
  W:<WORD ID> 단어 클립 (단어 데이터 3,000개)

규칙
  - 문장 글로스 이름은 S 단위가 기본이다. 같은 이름이 단어 데이터에도 있으면 W 단위는 alts에 둔다.
  - 단어 데이터에만 있는 이름은 W 단위가 기본이다.
  - 같은 이름에 W 단위가 여럿(동음이의어 후보 164개)이면 ID가 가장 작은 것이 기본이다.
    지헌이 "진짜 동음이의어"로 표시한 이름만 senses(단위 → 뜻)를 채운다. 번역기는 senses가 있을 때만 뜻을 고른다.

  python -m gen.gloss_table --word-vocab <word_vocab_v1.json> --sen-meta <SEN meta.jsonl> \
      [--homonym <homonym_mark_result.json>] --out <gloss_table_v2.json>
"""
import argparse
import collections
import json
from pathlib import Path


def sen_unit(name):
    return f"S:{name}"


def word_unit(word_id):
    return f"W:{word_id}"


def read_sen_counts(meta_lines):
    """문장 메타 줄들에서 구간 이름별 횟수."""
    counts = collections.Counter()
    for line in meta_lines:
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row.get("type", "SEN") != "SEN":
            continue
        for seg in row.get("segments", []):
            counts[seg["name"]] += 1
    return counts


def build_table(word_vocab, sen_counts, homonym_marks=None):
    if word_vocab.get("schema_version") != 1:
        raise ValueError("word vocab must be schema_version 1")
    marks = {m["name"]: m for m in (homonym_marks or [])}
    units, glosses = {}, {}

    for name, count in sorted(sen_counts.items()):
        units[sen_unit(name)] = {"source": "SEN", "name": name, "count": int(count)}
        glosses[name] = {"default": sen_unit(name), "alts": [], "homonym": False, "senses": {}}

    word_names = collections.defaultdict(list)
    for name, word_id in word_vocab["mapping"].items():
        word_names[name].append(word_id)
    for name, ids in word_vocab["ambiguous"].items():
        word_names[name].extend(ids if isinstance(ids, list) else [ids])

    for name, ids in sorted(word_names.items()):
        ids = sorted(set(ids))
        for word_id in ids:
            units.setdefault(word_unit(word_id), {"source": "WORD", "name": name, "word_id": word_id})
        w = [word_unit(i) for i in ids]
        if name in glosses:  # 문장 글로스와 이름이 겹침: 문장 구간 동작 우선
            glosses[name]["alts"] = w
            continue
        mark = marks.get(name, {})
        homonym = mark.get("verdict") == "homonym" and len(ids) > 1
        senses = {word_unit(i): s.strip() for i, s in (mark.get("meanings") or {}).items()
                  if homonym and i in ids and isinstance(s, str) and s.strip()}
        glosses[name] = {"default": w[0], "alts": w[1:], "homonym": homonym, "senses": senses}

    multi = [g for g in glosses.values() if g["default"].startswith("W:") and g["alts"]]
    stats = {
        "units": len(units),
        "units_sen": sum(u["source"] == "SEN" for u in units.values()),
        "units_word": sum(u["source"] == "WORD" for u in units.values()),
        "glosses": len(glosses),
        "overlap_sen_word": sum(1 for g in glosses.values() if g["default"].startswith("S:") and g["alts"]),
        "word_multi_id": len(multi),
        "homonym_marked": sum(g["homonym"] for g in glosses.values()),
        "homonym_marks_read": len(marks),
    }
    return {"schema_version": 2, "units": units, "glosses": glosses, "stats": stats}


def resolve(table, name, sense=None):
    """글로스 이름 → 동작 단위. 표에 없으면 None. sense는 senses의 뜻 문자열."""
    g = table["glosses"].get(name)
    if g is None:
        return None
    if sense:
        for unit, meaning in g["senses"].items():
            if meaning == sense:
                return unit
    return g["default"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--word-vocab", required=True)
    p.add_argument("--sen-meta", required=True)
    p.add_argument("--homonym")
    p.add_argument("--out", required=True)
    p.add_argument("--overwrite", action="store_true")
    a = p.parse_args()
    word_vocab = json.loads(Path(a.word_vocab).read_text(encoding="utf-8"))
    with open(a.sen_meta, encoding="utf-8") as fh:
        counts = read_sen_counts(fh)
    marks = json.loads(Path(a.homonym).read_text(encoding="utf-8")) if a.homonym else None
    table = build_table(word_vocab, counts, marks)
    with Path(a.out).open("w" if a.overwrite else "x", encoding="utf-8") as fh:
        json.dump(table, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(json.dumps(table["stats"], ensure_ascii=True))


if __name__ == "__main__":
    main()
