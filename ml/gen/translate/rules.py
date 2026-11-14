"""규칙 보조(B0): 원문 단위 → 글로스 표의 이름.

찾는 순서 (먼저 맞는 것)
  1. 원형 그대로
  2. 띄어쓰기 제거
  3. "-하다" 붙이기 / 떼기 (공부 ↔ 공부하다), 용언이면 "-다"를 뗀 어간
  4. 숫자 이름: 표의 "거지1"은 "거지"로도 찾는다 (가장 작은 번호)
그래도 없으면 None (unknown).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import re

_NUM_TAIL = re.compile(r"^(.*[^\d])(\d+)$")


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
