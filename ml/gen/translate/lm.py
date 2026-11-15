"""글로스 3-gram 언어 모델: 보간 Kneser-Ney (할인 D 하나).

  P(w | u v) = max(c(uvw) − D, 0)/c(uv·) + D·N1+(uv·)/c(uv·) · P_kn(w | v)
  P_kn(w | v) = max(N1+(·vw) − D, 0)/N1+(·v·) + D·N1+(v·)/N1+(·v·) · P_kn(w)   (이어짐 횟수)
  P_kn(w)     = N1+(·w) / N1+(··), 처음 보는 낱말은 unk_prob

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import collections
import math

BOS, EOS = "<s>", "</s>"


class KneserNeyLM:
    def __init__(self, discount=0.75, unk_prob=1e-4):
        self.d = discount
        self.unk = unk_prob
        self.tri = {}   # (u, v) -> {w: c}
        self.cont2 = {}  # v -> {w: N1+(·vw)}
        self.cont1 = {}  # w -> N1+(·w)
        self.total1 = 0

    def fit(self, sequences):
        tri = collections.defaultdict(collections.Counter)
        for seq in sequences:
            s = [BOS, BOS] + list(seq) + [EOS]
            for k in range(2, len(s)):
                tri[(s[k - 2], s[k - 1])][s[k]] += 1
        cont2 = collections.defaultdict(collections.Counter)
        for (u, v), ws in tri.items():
            for w in ws:
                cont2[v][w] += 1
        cont1 = collections.Counter()
        for v, ws in cont2.items():
            for w in ws:
                cont1[w] += 1
        self.tri = {k: dict(v) for k, v in tri.items()}
        self.cont2 = {k: dict(v) for k, v in cont2.items()}
        self.cont1 = dict(cont1)
        self.total1 = sum(cont1.values())
        return self

    def _p1(self, w):
        c = self.cont1.get(w, 0)
        if self.total1 == 0:
            return self.unk
        return max(c / self.total1, self.unk) if c else self.unk

    def _p2(self, v, w):
        ws = self.cont2.get(v)
        if not ws:
            return self._p1(w)
        tot = sum(ws.values())
        return max(ws.get(w, 0) - self.d, 0) / tot + self.d * len(ws) / tot * self._p1(w)

    def prob(self, u, v, w):
        ws = self.tri.get((u, v))
        if not ws:
            return self._p2(v, w)
        tot = sum(ws.values())
        return max(ws.get(w, 0) - self.d, 0) / tot + self.d * len(ws) / tot * self._p2(v, w)

    def logprob(self, u, v, w):
        return math.log(self.prob(u, v, w))

    def score(self, seq):
        s = [BOS, BOS] + list(seq) + [EOS]
        return sum(self.logprob(s[k - 2], s[k - 1], s[k]) for k in range(2, len(s)))

    def to_json(self):
        return {"discount": self.d, "unk_prob": self.unk,
                "tri": [[u, v, ws] for (u, v), ws in self.tri.items()]}

    @classmethod
    def from_json(cls, obj):
        lm = cls(obj["discount"], obj["unk_prob"])
        tri = {(u, v): ws for u, v, ws in obj["tri"]}
        # 이어짐 횟수는 3-gram 횟수에서 다시 계산한다
        lm.tri = tri
        cont2 = collections.defaultdict(dict)
        for (u, v), ws in tri.items():
            for w in ws:
                cont2[v][w] = cont2[v].get(w, 0) + 1
        cont1 = collections.Counter()
        for v, ws in cont2.items():
            for w in ws:
                cont1[w] += 1
        lm.cont2 = dict(cont2)
        lm.cont1 = dict(cont1)
        lm.total1 = sum(cont1.values())
        return lm
