"""받아쓰기 모델과 비교용 좌표 회귀 모델.

MotionGPT        단어 → 자모 토큰 열 (T2M-GPT의 GPT 부분: 조건을 맨 앞 토큰으로 두고 다음 토큰을 하나씩 예측)
SentenceToMotion 형태소(글로스) 열 → 자모 토큰 열 (인코더–디코더, 문장 단위)
MotionRegressor  단어 → 좌표 [L, 375] 직접 예측 (비교 기준선 ②, 토큰을 쓰지 않음)

토큰 번호: 0..nb_code-1 = 자모, nb_code = 끝(END), nb_code+1 = 빈칸(PAD)
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


def causal_mask(n, device):
    return torch.triu(torch.full((n, n), float("-inf"), device=device), diagonal=1)


def sample_next(logits, top_k, temperature):
    logits = logits / max(temperature, 1e-6)
    if top_k:
        v, _ = logits.topk(min(top_k, logits.shape[-1]))
        logits = logits.masked_fill(logits < v[..., -1:], float("-inf"))
    return torch.multinomial(F.softmax(logits, -1), 1).squeeze(-1)


class MotionGPT(nn.Module):
    """cond_every: 조건을 맨 앞뿐 아니라 모든 위치에 더한다.
    null_cond: 조건 번호 n_cond를 '단어 없음'으로 둔다(학습 때 일부를 바꿔 넣고, 생성 때 guidance에 쓴다).
    둘 다 끄면 기존 체크포인트와 같은 구조다."""

    def __init__(self, n_cond, nb_code, d=256, layers=4, heads=4, max_len=64, n_signer=0, dropout=0.1,
                 cond_every=False, null_cond=False):
        super().__init__()
        self.nb_code, self.end, self.pad, self.max_len = nb_code, nb_code, nb_code + 1, max_len
        self.cond_every, self.null = cond_every, (n_cond if null_cond else None)
        self.cond = nn.Embedding(n_cond + int(null_cond), d)
        self.signer = nn.Embedding(n_signer, d) if n_signer else None
        self.tok = nn.Embedding(nb_code + 2, d)
        self.pos = nn.Embedding(max_len + 1, d)
        layer = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout, batch_first=True, norm_first=True)
        self.blocks = nn.TransformerEncoder(layer, layers)
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, nb_code + 1)  # 자모 또는 END

    def forward(self, cond, tokens, signer=None):
        """cond [B], tokens [B, L] → logits [B, L+1, nb_code+1]. 위치 i의 출력이 i번째 토큰을 예측한다."""
        c = self.cond(cond)
        if self.signer is not None and signer is not None:
            c = c + self.signer(signer)
        h = torch.cat([c[:, None], self.tok(tokens)], 1)
        if self.cond_every:
            h = h + torch.cat([torch.zeros_like(c[:, None]), c[:, None].expand(-1, tokens.shape[1], -1)], 1)
        h = h + self.pos(torch.arange(h.shape[1], device=h.device))[None]
        h = self.blocks(h, mask=causal_mask(h.shape[1], h.device), is_causal=True)
        return self.head(self.norm(h))

    @torch.no_grad()
    def generate(self, cond, signer=None, top_k=10, temperature=1.0, min_len=2, guidance=1.0):
        """guidance > 1: 단어 없음 예측과의 차이를 키운다(null_cond 모델만)."""
        B = cond.shape[0]
        seq = torch.empty(B, 0, dtype=torch.long, device=cond.device)
        done = torch.zeros(B, dtype=torch.bool, device=cond.device)
        if guidance != 1.0 and self.null is None:
            raise ValueError("guidance requires null_cond")
        for t in range(self.max_len):
            logits = self.forward(cond, seq, signer)[:, -1]
            if guidance != 1.0:
                free = self.forward(torch.full_like(cond, self.null), seq, signer)[:, -1]
                logits = free + guidance * (logits - free)
            if t < min_len:
                logits[:, self.end] = float("-inf")
            nxt = sample_next(logits, top_k, temperature)
            nxt = torch.where(done, torch.full_like(nxt, self.pad), nxt)
            done |= nxt == self.end
            seq = torch.cat([seq, nxt[:, None]], 1)
            if done.all():
                break
        return [[t for t in row if t < self.nb_code] for row in seq.tolist()]


class SentenceToMotion(nn.Module):
    """형태소 열(+비수지 태그) → 자모 토큰 열. 문장 데이터가 오면 학습한다."""

    def __init__(self, n_vocab, nb_code, d=256, layers=4, heads=4, max_src=32, max_len=200, n_signer=0, dropout=0.1):
        super().__init__()
        self.nb_code, self.end, self.pad, self.bos, self.max_len = nb_code, nb_code, nb_code + 1, nb_code + 2, max_len
        self.src_emb = nn.Embedding(n_vocab, d, padding_idx=0)
        self.src_pos = nn.Embedding(max_src, d)
        self.tok = nn.Embedding(nb_code + 3, d)
        self.pos = nn.Embedding(max_len + 1, d)
        self.signer = nn.Embedding(n_signer, d) if n_signer else None
        self.tf = nn.Transformer(d, heads, layers, layers, 4 * d, dropout, batch_first=True, norm_first=True)
        self.head = nn.Linear(d, nb_code + 1)

    def forward(self, src, tokens, signer=None):
        """src [B, S] (0 = 빈칸), tokens [B, L] → logits [B, L+1, nb_code+1] (맨 앞 BOS 자동 추가)."""
        B = src.shape[0]
        s = self.src_emb(src) + self.src_pos(torch.arange(src.shape[1], device=src.device))[None]
        if self.signer is not None and signer is not None:
            s = s + self.signer(signer)[:, None]
        bos = torch.full((B, 1), self.bos, dtype=torch.long, device=src.device)
        t = self.tok(torch.cat([bos, tokens], 1))
        t = t + self.pos(torch.arange(t.shape[1], device=t.device))[None]
        h = self.tf(s, t, tgt_mask=causal_mask(t.shape[1], t.device), tgt_is_causal=True,
                    src_key_padding_mask=src == 0, memory_key_padding_mask=src == 0)
        return self.head(h)

    @torch.no_grad()
    def generate(self, src, signer=None, top_k=10, temperature=1.0, min_len=2):
        B = src.shape[0]
        seq = torch.empty(B, 0, dtype=torch.long, device=src.device)
        done = torch.zeros(B, dtype=torch.bool, device=src.device)
        for t in range(self.max_len):
            logits = self.forward(src, seq, signer)[:, -1]
            if t < min_len:
                logits[:, self.end] = float("-inf")
            nxt = sample_next(logits, top_k, temperature)
            nxt = torch.where(done, torch.full_like(nxt, self.pad), nxt)
            done |= nxt == self.end
            seq = torch.cat([seq, nxt[:, None]], 1)
            if done.all():
                break
        return [[t for t in row if t < self.nb_code] for row in seq.tolist()]


class MotionRegressor(nn.Module):
    """비교 기준선 ②: 토큰 없이 좌표를 직접 맞춘다. MotionGPT와 같은 크기의 Transformer."""

    def __init__(self, n_cond, feat_dim=375, length=64, d=256, layers=4, heads=4, n_signer=0, dropout=0.1):
        super().__init__()
        self.length = length
        self.cond = nn.Embedding(n_cond, d)
        self.signer = nn.Embedding(n_signer, d) if n_signer else None
        self.query = nn.Parameter(torch.randn(length, d) * 0.02)
        layer = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout, batch_first=True, norm_first=True)
        self.blocks = nn.TransformerEncoder(layer, layers)
        self.out = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, feat_dim))

    def forward(self, cond, signer=None):  # → [B, length, feat_dim]
        c = self.cond(cond)
        if self.signer is not None and signer is not None:
            c = c + self.signer(signer)
        return self.out(self.blocks(self.query[None] + c[:, None]))
