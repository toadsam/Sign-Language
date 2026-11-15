"""SentenceGPT: 위치마다 조건 열을 받는 MotionGPT 확장 (P3 문장 GPT).

설계 참고: sign-motion-gloss (코드 복사 없음). 구조는 gen.model.MotionGPT를 넓힌 것이다.

MotionGPT와 다른 점
  - 조건이 토큰마다 다르다: cur(지금 단위 / <conn> / <pause>) + prev + next (앞뒤 단위) + phase(구역 안 위치).
  - 위치 i의 입력 = (i==0 ? BOS : 토큰 i-1) + 위치 i의 조건 + 화자 + 위치 → 토큰 i를 예측한다.
  - 길이는 일정표가 정하므로 END가 없다. 출력은 자모 nb_code개.
같은 점: 화자 조건(모든 위치에 더함), null 조건(cur/prev/next를 <null>/<none>으로 바꾼 것, guidance용),
top-k 표본 추출.
"""
import torch
import torch.nn as nn

from gen.model import causal_mask, sample_next
from gen.sentence_data import MAX_PHASE

NULL_ID, NONE_ID = 0, 1  # gen.sentence_data.SPECIAL 순서


class SentenceGPT(nn.Module):
    def __init__(self, n_units, nb_code, d=384, layers=6, heads=6, max_len=128, n_signer=12, dropout=0.1):
        super().__init__()
        self.nb_code, self.bos, self.max_len = nb_code, nb_code, max_len
        self.cur = nn.Embedding(n_units, d)
        self.prev = nn.Embedding(n_units, d)
        self.next = nn.Embedding(n_units, d)
        self.phase_a = nn.Embedding(MAX_PHASE, d)
        self.phase_b = nn.Embedding(MAX_PHASE, d)
        self.signer = nn.Embedding(n_signer, d)
        self.tok = nn.Embedding(nb_code + 1, d)  # + BOS
        self.pos = nn.Embedding(max_len, d)
        layer = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout, batch_first=True, norm_first=True)
        self.blocks = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, nb_code)

    def condition(self, cur, prev, nxt, phase_a, phase_b, signer):
        return (self.cur(cur) + self.prev(prev) + self.next(nxt) + self.phase_a(phase_a)
                + self.phase_b(phase_b) + self.signer(signer)[:, None])

    def forward(self, cur, prev, nxt, phase_a, phase_b, signer, tokens):
        """조건 [B, L] 다섯 개, signer [B], tokens [B, L](정답 토큰; 맨 끝은 입력으로 안 씀) → logits [B, L, nb_code]."""
        bos = torch.full((cur.shape[0], 1), self.bos, dtype=torch.long, device=cur.device)
        return self.logits(cur, prev, nxt, phase_a, phase_b, signer, torch.cat([bos, tokens[:, :-1]], 1))

    def logits(self, cur, prev, nxt, phase_a, phase_b, signer, inputs):
        """inputs [B, L] = 위치마다 앞 토큰(맨 앞은 BOS 또는 창 밖의 토큰)."""
        L = cur.shape[1]
        if L > self.max_len:
            raise ValueError("sequence longer than max_len")
        h = self.tok(inputs) + self.condition(cur, prev, nxt, phase_a, phase_b, signer)
        h = h + self.pos(torch.arange(L, device=cur.device))[None]
        h = self.blocks(h, mask=causal_mask(L, cur.device), is_causal=True)
        return self.head(self.norm(h))

    @torch.no_grad()
    def generate(self, cur, prev, nxt, phase_a, phase_b, signer, top_k=10, temperature=1.0, guidance=1.0):
        """조건 일정표 [B, L] → 토큰 [B, L]. L > max_len이면 마지막 max_len 위치만 보고 이어 쓴다(창 밀기).

        guidance != 1: 같은 위치에서 null 조건(cur=<null>, prev/next=<none>, phase · 화자는 그대로) 예측과의
        차이를 키운다."""
        B, L = cur.shape
        conds = [cur, prev, nxt, phase_a, phase_b]
        if guidance != 1.0:
            conds = [torch.cat([c, torch.full_like(c, NULL_ID if k == 0 else NONE_ID) if k < 3 else c])
                     for k, c in enumerate(conds)]
            signer = torch.cat([signer, signer])
        n = conds[0].shape[0]
        inputs = torch.full((n, L), self.bos, dtype=torch.long, device=cur.device)  # 위치 i의 입력 = 토큰 i-1
        out = torch.empty(B, L, dtype=torch.long, device=cur.device)
        for t in range(L):
            lo = max(0, t + 1 - self.max_len)
            logits = self.logits(*[c[:, lo:t + 1] for c in conds], signer, inputs[:, lo:t + 1])[:, -1]
            if guidance != 1.0:
                logits = logits[B:] + guidance * (logits[:B] - logits[B:])
            out[:, t] = sample_next(logits, top_k, temperature)
            if t + 1 < L:
                inputs[:, t + 1] = out[:, t].repeat(n // B)
        return out
