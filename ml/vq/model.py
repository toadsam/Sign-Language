"""동작 자모표(VQ-VAE). T2M-GPT(Zhang et al., CVPR 2023)의 1D 합성곱 VQ-VAE 구조를 따른다.

동작 [B, T, 375] → 인코더(시간축 1/4) → 코드북에서 가장 가까운 코드로 교체 → 디코더 → [B, T, 375]
코드북은 EMA로 갱신하고, 쓰이지 않는 코드는 현재 배치의 인코더 출력으로 다시 채운다(코드북 붕괴 방지).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class ResBlock(nn.Module):
    def __init__(self, ch, dilation):
        super().__init__()
        self.conv1 = nn.Conv1d(ch, ch, 3, padding=dilation, dilation=dilation)
        self.conv2 = nn.Conv1d(ch, ch, 1)

    def forward(self, x):
        return x + self.conv2(F.relu(self.conv1(F.relu(x))))


def resnet1d(ch, depth, growth=3):
    return nn.Sequential(*[ResBlock(ch, growth ** d) for d in reversed(range(depth))])


class Encoder(nn.Module):
    def __init__(self, in_dim, width, code_dim, down_t=2, depth=2):
        super().__init__()
        layers = [nn.Conv1d(in_dim, width, 3, padding=1), nn.ReLU()]
        for _ in range(down_t):
            layers += [nn.Conv1d(width, width, 4, stride=2, padding=1), resnet1d(width, depth)]
        layers += [nn.Conv1d(width, code_dim, 3, padding=1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


class Decoder(nn.Module):
    def __init__(self, out_dim, width, code_dim, down_t=2, depth=2):
        super().__init__()
        layers = [nn.Conv1d(code_dim, width, 3, padding=1), nn.ReLU()]
        for _ in range(down_t):
            layers += [resnet1d(width, depth), nn.Upsample(scale_factor=2, mode="nearest"),
                       nn.Conv1d(width, width, 3, padding=1)]
        layers += [nn.Conv1d(width, width, 3, padding=1), nn.ReLU(), nn.Conv1d(width, out_dim, 3, padding=1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


class QuantizeEMAReset(nn.Module):
    def __init__(self, nb_code, code_dim, mu=0.99):
        super().__init__()
        self.nb_code, self.code_dim, self.mu = nb_code, code_dim, mu
        self.register_buffer("codebook", torch.zeros(nb_code, code_dim))
        self.register_buffer("code_sum", torch.zeros(nb_code, code_dim))
        self.register_buffer("code_count", torch.zeros(nb_code))
        self.register_buffer("initted", torch.tensor(False))

    def _tile(self, x):
        n = x.shape[0]
        if n < self.nb_code:
            reps = (self.nb_code + n - 1) // n
            x = x.repeat(reps, 1) + torch.randn(n * reps, x.shape[1], device=x.device) * 0.01 / (x.shape[1] ** 0.5)
        return x

    @torch.no_grad()
    def _init(self, x):
        y = self._tile(x)
        self.codebook.copy_(y[torch.randperm(y.shape[0], device=x.device)[: self.nb_code]])
        self.code_sum.copy_(self.codebook)
        self.code_count.fill_(1.0)
        self.initted.fill_(True)

    def quantize(self, x):  # x [N, D]
        dist = (x.pow(2).sum(1, keepdim=True) - 2 * x @ self.codebook.t()
                + self.codebook.pow(2).sum(1)[None])
        return dist.argmin(1)

    @torch.no_grad()
    def _update(self, x, idx):
        onehot = F.one_hot(idx, self.nb_code).float().t()  # [K, N]
        code_sum = onehot @ x
        code_count = onehot.sum(1)
        rand = self._tile(x)
        rand = rand[torch.randperm(rand.shape[0], device=x.device)[: self.nb_code]]
        self.code_sum.mul_(self.mu).add_(code_sum, alpha=1 - self.mu)
        self.code_count.mul_(self.mu).add_(code_count, alpha=1 - self.mu)
        usage = (self.code_count >= 1.0).float()[:, None]
        new = self.code_sum / self.code_count[:, None].clamp(min=1e-6)
        self.codebook.copy_(usage * new + (1 - usage) * rand)

    @staticmethod
    def perplexity(idx, nb_code):
        p = torch.bincount(idx, minlength=nb_code).float()
        p = p / p.sum()
        return torch.exp(-(p * torch.log(p + 1e-10)).sum())

    def forward(self, z):  # z [B, D, T']
        B, D, Tq = z.shape
        x = z.permute(0, 2, 1).reshape(-1, D)
        if self.training and not bool(self.initted):
            self._init(x)
        idx = self.quantize(x)
        xq = F.embedding(idx, self.codebook)
        if self.training:
            self._update(x, idx)
        commit = F.mse_loss(x, xq.detach())
        xq = x + (xq - x).detach()  # straight-through
        xq = xq.view(B, Tq, D).permute(0, 2, 1)
        return xq, commit, self.perplexity(idx, self.nb_code), idx.view(B, Tq)


class MotionVQVAE(nn.Module):
    def __init__(self, feat_dim=375, width=256, code_dim=256, nb_code=512, down_t=2, depth=2):
        super().__init__()
        self.down = 2 ** down_t
        self.encoder = Encoder(feat_dim, width, code_dim, down_t, depth)
        self.quantizer = QuantizeEMAReset(nb_code, code_dim)
        self.decoder = Decoder(feat_dim, width, code_dim, down_t, depth)

    def forward(self, x):  # x [B, T, F], T는 self.down의 배수
        z = self.encoder(x.permute(0, 2, 1))
        zq, commit, ppl, idx = self.quantizer(z)
        out = self.decoder(zq).permute(0, 2, 1)
        return out, commit, ppl, idx

    @torch.no_grad()
    def encode(self, x):
        z = self.encoder(x.permute(0, 2, 1))
        B, D, Tq = z.shape
        return self.quantizer.quantize(z.permute(0, 2, 1).reshape(-1, D)).view(B, Tq)

    @torch.no_grad()
    def decode(self, idx):  # idx [B, T']
        zq = F.embedding(idx, self.quantizer.codebook).permute(0, 2, 1)
        return self.decoder(zq).permute(0, 2, 1)


def load_vqvae(path):
    """학습된 자모표 불러오기. (model, config)"""
    ck = torch.load(path, map_location="cpu")
    c = ck["config"]
    m = MotionVQVAE(375, c["width"], c["code_dim"], c["nb_code"], depth=c["depth"])
    m.load_state_dict(ck["model"])
    return m.eval(), c
