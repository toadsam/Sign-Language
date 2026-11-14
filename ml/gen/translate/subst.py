"""대체어 표: 글로스 표에 없는 한국어 낱말 → 글로스 표 안 이름 하나 (11-15, v5).

왜: "주민등록증"은 글로스 표에 없고 madi가 주민 + 등록증으로 나누는데 둘 다 표에 없다. 구 대응표는
"주민 등록증 있으 → 신분증"처럼 학습 때 본 모양 그대로만 알아서, 조사가 붙거나 괄호에 싸이면 놓친다.
그래서 디코딩 전에 원문 단위에서 그 낱말을 표 안 이름(신분증)으로 바꾼다. 바뀐 단위는 규칙으로 찾아지므로
content_keep이 버리지 못한다.

키
  - 한 단위: 표에서 규칙으로 못 찾는 내용어 단위 (원형 그대로)
  - 이웃 단위 2~3개: 분석기가 나눈 합성어. 키는 단위를 붙인 겉모양(주민등록증)이다. 붙인 겉모양이 원문의
    한 어절 안에 있어야 한다(괄호 · 조사를 떼고 봐도 한 어절). 나누는 자리가 달라도 붙이면 같으므로
    "주민등록증이", "(주민등록증)"도 같은 키로 찾는다.

만드는 법 (학습 쌍만, 검증 · 시험은 쓰지 않는다)
  학습 쌍의 정렬에서 키가 나올 때마다 그 단위들에 정렬된 글로스 열을 센다. 같은 문장의 다른 단위가 규칙으로
  찾는 글로스는 그 단위 몫이라 빼고 센다(시간이 많이 걸려요: "많이"에 붙은 "시간"은 "시간"의 것).
  가장 많은 대상이 글로스 하나이고, 횟수 ≥ min_count, 서로 다른 한국어 문장 수 ≥ min_count,
  정렬된(비지 않은) 것 중 몫 ≥ min_share, 전체 나온 횟수 중 몫 ≥ min_keep(대개 생략되는 말은 빼려고)이면 넣는다.
  숫자만인 키(2, 10)는 넣지 않는다(뒤에 오는 말에 따라 2호선 · 2분으로 갈려서).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import collections
import json
from pathlib import Path

from gen.translate.units import is_marker

_BRACKETS = "()[]{}<>\"'“”‘’「」『』"


def eojeols(text):
    """괄호 · 따옴표를 띄어쓰기로 바꾼 어절들 (문장 부호는 남아도 부분 문자열 비교라 상관없다)."""
    s = str(text)
    for ch in _BRACKETS:
        s = s.replace(ch, " ")
    return s.split()


def _in_one_eojeol(key, words):
    return any(key in w for w in words)


def spans(units, text, max_parts=3):
    """키 후보 구간 [(i, j, 키)]. 한 단위 구간과, 한 어절 안에서 나온 이웃 내용어 2~max_parts개."""
    words = eojeols(text)
    out = []
    n = len(units)
    for i in range(n):
        if is_marker(units[i]):
            continue
        out.append((i, i + 1, units[i]))
        for j in range(i + 2, min(n, i + max_parts) + 1):
            if is_marker(units[j - 1]):
                break
            key = "".join(units[i:j])
            if _in_one_eojeol(key, words):
                out.append((i, j, key))
    return out


class SubstTable:
    """{키: 글로스 이름}. apply(units, text) → (새 단위 열, [{from, to, how: 'subst'}])."""

    def __init__(self, mapping, max_parts=3):
        self.map = dict(mapping or {})
        self.max_parts = max_parts

    def __len__(self):
        return len(self.map)

    def apply(self, units, text=""):
        if not self.map:
            return list(units), []
        words = eojeols(text)
        out, subst, i, n = [], [], 0, len(units)
        while i < n:
            hit = None
            for j in range(min(n, i + self.max_parts), i, -1):  # 긴 것부터
                part = units[i:j]
                if any(is_marker(u) for u in part):
                    continue
                key = "".join(part)
                if key in self.map and (j - i == 1 or _in_one_eojeol(key, words)):
                    hit = (j, key)
                    break
            if hit is None:
                out.append(units[i])
                i += 1
                continue
            j, key = hit
            out.append(self.map[key])
            subst.append({"from": key, "to": self.map[key], "how": "subst"})
            i = j
        return out, subst

    def to_json(self):
        return {"schema": "subst_v1", "max_parts": self.max_parts, "map": dict(sorted(self.map.items()))}


def build_subst(examples, alignments, lookup, min_count=2, min_share=0.8, min_keep=0.5, max_parts=3, stats=None):
    """examples: [(단위 열, 글로스 열, 한국어 문장)] (학습 쌍만), alignments: 쌍마다 {(i, j)} 링크.
    lookup(낱말) -> 글로스 이름 | None (글로스 표 규칙). 돌려주는 것: SubstTable."""
    seen = collections.defaultdict(collections.Counter)
    sents = collections.defaultdict(lambda: collections.defaultdict(set))
    for (units, gloss, text), links in zip(examples, alignments):
        ruled = [None if is_marker(u) else lookup(u) for u in units]
        for i, j, key in spans(units, text, max_parts):
            if lookup(key) is not None or key.isdigit():
                continue  # 이미 표에서 찾아지는 말(붙여 찾기 · 규칙)과 숫자는 바꾸지 않는다
            if j - i == 1 and is_marker(key):
                continue
            others = {r for k, r in enumerate(ruled) if r is not None and not i <= k < j}
            js = sorted({b for a, b in links if i <= a < j and gloss[b] not in others})
            tgt = tuple(gloss[b] for b in js)
            seen[key][tgt] += 1
            sents[key][tgt].add(text)
    mapping = {}
    for key, c in seen.items():
        total = sum(c.values())
        nonempty = total - c.get((), 0)
        if not nonempty:
            continue
        tgt, k = max(((t, v) for t, v in c.items() if t), key=lambda x: (x[1], x[0]))
        if len(tgt) != 1 or lookup(tgt[0]) != tgt[0]:
            continue
        if (k >= min_count and len(sents[key][tgt]) >= min_count and k / nonempty >= min_share
                and k / total >= min_keep):
            mapping[key] = tgt[0]
    if stats is not None:
        stats.update({"keys_seen": len(seen), "subst_entries": len(mapping)})
    return SubstTable(mapping, max_parts)


def save_subst(table, path, overwrite=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w" if overwrite else "x", encoding="utf-8") as fh:
        json.dump(table.to_json(), fh, ensure_ascii=False, indent=1)
        fh.write("\n")


def load_subst(path):
    """파일이 없으면 None."""
    if not path or not Path(path).exists():
        return None
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    return SubstTable(obj.get("map", {}), obj.get("max_parts", 3))
