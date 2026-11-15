"""규칙 보조(B0): 원문 단위 → 글로스 표의 이름.

찾는 순서 (먼저 맞는 것)
  1. 원형 그대로
  2. 띄어쓰기 제거
  3. "-하다" 붙이기 / 떼기 (공부 ↔ 공부하다), 용언이면 "-다"를 뗀 어간
  4. 파생 · 보조 용언 떼기 (11-14 추가): -되다 · -시키다 · -받다 · -당하다 → 명사(+하다),
     -스럽다 · -롭다 · -답다 → 명사, -아지다 · -어지다 → 원래 형용사 (좋아지다 → 좋다)
  5. 숫자 이름: 표의 "거지1"은 "거지"로도 찾는다 (가장 작은 번호)
그래도 없으면 None (unknown).

join(units): 분석기가 나눈 이웃 내용어 2~3개를 붙인 것이 표 이름이면 그 이름 (합성어 · 고유 명사가 쪼개진 경우).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import re

_NUM_TAIL = re.compile(r"^(.*[^\d])(\d+)$")
_NOUN_VERB_SUFFIXES = ("시키다", "당하다", "되다", "받다")
_ADJ_NOUN_SUFFIXES = ("스럽다", "롭다", "답다")


class GlossLookup:
    def __init__(self, names):
        self.names = set(names)
        self.base = {}
        for n in sorted(self.names, key=lambda x: (len(x), x)):
            m = _NUM_TAIL.match(n)
            if m and m.group(1).strip():
                b = m.group(1)
                prev = self.base.get(b)
                if prev is None or int(_NUM_TAIL.match(prev).group(2)) > int(m.group(2)):
                    self.base[b] = n

    def _direct(self, w):
        if w in self.names:
            return w
        return self.base.get(w)

    def candidates(self, unit):
        """찾아볼 이름 후보 (순서대로)."""
        out = [unit]
        nospace = unit.replace(" ", "")
        out.append(nospace)
        if nospace.endswith("하다") and len(nospace) > 2:
            out.append(nospace[:-2])
        elif not nospace.endswith("다"):
            out.append(nospace + "하다")
        if nospace.endswith("다") and len(nospace) > 1:
            out.append(nospace[:-1])
        for suf in _NOUN_VERB_SUFFIXES:
            if nospace.endswith(suf) and len(nospace) > len(suf):
                base = nospace[: -len(suf)]
                out.extend([base + "하다", base])
        for suf in _ADJ_NOUN_SUFFIXES:
            if nospace.endswith(suf) and len(nospace) > len(suf):
                out.append(nospace[: -len(suf)])
        for suf in ("아지다", "어지다"):
            if nospace.endswith(suf) and len(nospace) > len(suf):
                out.append(nospace[: -len(suf)] + "다")
        seen, uniq = set(), []
        for c in out:
            if c and c not in seen:
                seen.add(c)
                uniq.append(c)
        return uniq

    def lookup(self, unit):
        for c in self.candidates(unit):
            hit = self._direct(c)
            if hit is not None:
                return hit
        return None

    def join(self, units):
        """이웃 단위들을 붙여 표 이름 찾기. 어미 · 부호 단위가 끼면 None. 앞쪽 용언은 "-다"를 뗀다."""
        if len(units) < 2 or any(u.startswith("~") or u == "?" for u in units):
            return None
        parts = [u[:-1] if (k < len(units) - 1 and u.endswith("다") and len(u) > 1) else u
                 for k, u in enumerate(units)]
        joined = "".join(p.replace(" ", "") for p in parts)
        if len(joined) < 2:
            return None
        return self._direct(joined)

    def split(self, unit, min_len=2):
        """표에 없는 합성어를 표 안 이름 둘로: 앞쪽이 긴 것부터. 각 부분은 min_len 글자 이상
        (뒤쪽은 용언 원형이어도 된다: 운동하다 → 운동 + 하다 꼴은 lookup이 먼저 처리)."""
        w = unit.replace(" ", "")
        if len(w) < 2 * min_len or w.endswith("다") or not w.isalnum():
            return None
        for k in range(len(w) - min_len, min_len - 1, -1):
            a, b = self._direct(w[:k]), self._direct(w[k:])
            if a is not None and b is not None:
                return (a, b)
        return None
