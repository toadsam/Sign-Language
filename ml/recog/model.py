"""읽는 모델(수어 인식). 동작을 보고 어떤 단어인지 맞힌다.

두 곳에 쓴다: (1) 생성·복원 동작을 채점하는 채점관(역번역), (2) 확장 시 카메라 수어 인식.
구조: Conv1d(시간축 특징) → 양방향 GRU(앞뒤 문맥) → 어텐션 풀링 → 단어 분류.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class SignRecognizer(nn.Module):
    def __init__(self, in_dim, n_class, conv=256, hidden=256, dropout=0.3):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_dim, conv, 5, padding=2), nn.BatchNorm1d(conv), nn.ReLU(), nn.Dropout(dropout),
            nn.Conv1d(conv, conv, 5, padding=2), nn.BatchNorm1d(conv), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(conv, conv, 3, padding=1), nn.BatchNorm1d(conv), nn.ReLU(),
        )
        self.gru = nn.GRU(conv, hidden, num_layers=2, batch_first=True, bidirectional=True, dropout=dropout)
        self.attn = nn.Linear(2 * hidden, 1)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(2 * hidden, n_class))

    def embed(self, x):  # x [B, T, F] → [B, 2H] 동작 한 개를 요약한 벡터
        h = self.conv(x.transpose(1, 2)).transpose(1, 2)
        h, _ = self.gru(h)
        w = torch.softmax(self.attn(h), dim=1)
        return (w * h).sum(1)

    def forward(self, x):
        return self.head(self.embed(x))

    @torch.no_grad()
    def topk(self, x, k=5):
        p = F.softmax(self.forward(x), dim=-1)
        return p.topk(min(k, p.shape[-1]), dim=-1)
