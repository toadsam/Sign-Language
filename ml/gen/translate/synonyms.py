"""동의어 표: 글로스 표에 없는 내용어 → 표 안 글로스 이름.

파일 형식 (.local/translate/synonyms_v1.json, 커밋하지 않음)
  {"schema": "synonyms_v1", "source": "...", "created": "...",
   "by_gloss": {글로스 이름: [사전상 비슷한 말, ...]},   받아 온 그대로
   "map": {비슷한 말: [글로스 이름, ...]}}               by_gloss를 뒤집은 것 (번역기가 쓴다)

사전상 비슷한 말이 같은 수어라는 보장은 없다. 번역기는 바꾼 경우를 결과의 substituted에 적어 사람이 검토하게 한다.
파일이 없으면 동의어 단계는 건너뛴다.

받아 오기 (우리말샘 오픈 API, 키는 환경 변수 URIMALSAM_API_KEY)
    python -m gen.translate.synonyms --gloss-table <gloss_table_v2.json> --out .local/translate/synonyms_v1.json
보내는 것은 글로스 이름(일반 한국어 낱말)뿐이다. 문장은 보내지 않는다.
API 응답 모양은 키가 없어 아직 확인하지 못했다(11-14). 파서는 여러 모양을 너그럽게 받는다. 첫 실행 때 --limit 5로 확인할 것.

설계 참고: 1학기 backend ExternalLexiconApiClient (같은 API, 코드 복사 없음)
"""
import argparse
import datetime
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

SCHEMA = "synonyms_v1"
SEARCH_URL = "https://opendict.korean.go.kr/api/search"
VIEW_URL = "https://opendict.korean.go.kr/api/view"
SIMILAR = ("비슷한말", "비슷한 말", "동의어", "유의어")
_HANGUL_WORD = re.compile(r"^[가-힣]+$")


def clean_word(w):
    """사전 표제어 표기(어깨번호, 붙임표, ^)를 떼어 낸 낱말. 한글만 남지 않으면 None."""
    w = re.sub(r"\d+$", "", str(w or "").strip())
    w = w.replace("-", "").replace("^", "").replace(" ", "")
    return w if _HANGUL_WORD.match(w) else None


def invert(by_gloss, glosses):
    """by_gloss → map. 이미 표에 있는 낱말과 자기 자신은 뺀다(표가 우선)."""
    out = {}
    for g, words in sorted(by_gloss.items()):
        for w in words:
            w = clean_word(w)
            if not w or w == g or w in glosses:
                continue
            out.setdefault(w, [])
            if g not in out[w]:
                out[w].append(g)
    return out


class SynonymTable:
    def __init__(self, mapping=None):
        self.map = {k: list(v) for k, v in (mapping or {}).items()}

    def __len__(self):
        return len(self.map)

    def lookup(self, unit):
        """내용어 원형 → 글로스 이름 하나 (후보가 여럿이면 None: 어느 것인지 모르면 바꾸지 않는다)."""
        for key in (unit, unit[:-2] if unit.endswith("하다") else None, unit + "하다" if not unit.endswith("다") else None):
            if key and key in self.map:
                c = self.map[key]
                return c[0] if len(c) == 1 else None
        return None


def load_synonyms(path):
    """파일이 없으면 None (동의어 단계 건너뜀)."""
    if not path or not Path(path).exists():
        return None
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if obj.get("schema") != SCHEMA:
        raise ValueError(f"not a {SCHEMA} file: {path}")
    return SynonymTable(obj.get("map", {}))


# ------------------------------------------------------------------ 받아 오기

def _walk(node, fn):
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            _walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            _walk(v, fn)


def parse_target_codes(payload, word):
    """search 응답에서 표제어가 word인 항목의 target_code들."""
    codes = []

    def fn(d):
        if "target_code" in d and clean_word(d.get("word")) == word:
            codes.append(str(d["target_code"]))
    _walk(payload, fn)
    return list(dict.fromkeys(codes))


def parse_similar(payload):
    """view 응답에서 관계 종류가 비슷한말인 낱말들."""
    words = []

    def fn(d):
        kind = str(d.get("type", "") or d.get("relation_type", ""))
        if any(s in kind for s in SIMILAR):
            w = d.get("word") or d.get("relation_word")
            if w:
                words.append(str(w))
    _walk(payload, fn)
    return list(dict.fromkeys(words))


def http_get_json(url, params, timeout=10):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{q}", timeout=timeout) as r:  # noqa: S310 (고정된 https 주소)
        return json.loads(r.read().decode("utf-8"))


def fetch_similar(word, key, get=http_get_json, max_codes=3):
    """글로스 이름 하나 → 사전상 비슷한 말 목록."""
    res = get(SEARCH_URL, {"key": key, "q": word, "req_type": "json", "num": 10, "advanced": "y", "method": "exact"})
    out = []
    for code in parse_target_codes(res, word)[:max_codes]:
        view = get(VIEW_URL, {"key": key, "q": code, "req_type": "json", "method": "target_code"})
        out.extend(parse_similar(view))
    return list(dict.fromkeys(out))


def build(glosses, key, get=http_get_json, limit=None, sleep=0.1, log=print):
    names = [g for g in sorted(glosses) if clean_word(g)]
    if limit:
        names = names[:limit]
    by_gloss, errors = {}, 0
    for k, g in enumerate(names, 1):
        try:
            sims = fetch_similar(g, key, get)
        except Exception as e:  # noqa: BLE001 (한 낱말 실패는 건너뛴다)
            errors += 1
            log(f"skip {k}: {type(e).__name__}")
            continue
        if sims:
            by_gloss[g] = sims
        if sleep:
            time.sleep(sleep)
    return {"schema": SCHEMA, "source": "우리말샘 오픈 API (opendict.korean.go.kr)",
            "created": datetime.date.today().isoformat(), "queried": len(names), "errors": errors,
            "by_gloss": by_gloss, "map": invert(by_gloss, set(glosses))}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--gloss-table", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--limit", type=int)
    p.add_argument("--overwrite", action="store_true")
    a = p.parse_args()
    key = os.environ.get("URIMALSAM_API_KEY", "").strip()
    if not key:
        raise SystemExit("URIMALSAM_API_KEY 환경 변수가 없다. 우리말샘 오픈 API 키를 받아 넣고 다시 실행한다.")
    glosses = json.loads(Path(a.gloss_table).read_text(encoding="utf-8"))["glosses"]
    obj = build(glosses, key, limit=a.limit)
    with Path(a.out).open("w" if a.overwrite else "x", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
    print(json.dumps({"queried": obj["queried"], "errors": obj["errors"], "glosses_with_synonyms": len(obj["by_gloss"]),
                      "map_words": len(obj["map"])}))


if __name__ == "__main__":
    main()
