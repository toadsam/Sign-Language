"""문장 GPT 추론: 동작 단위 열 → 동작 (공유 인터페이스 ②).

설계 참고: sign-motion-gloss (코드 복사 없음)

  gen = load_sentence_generator("/data/runs/sent_gpt_<태그>", device="cuda")
  out = gen.generate(["S:서울", "W:WORD0123"], signer=None, seed=0)
  # {"fps": 30, "motion": [T, 125, 3] float32, "tokens": [...],
  #  "segments": [{"unit", "start", "end"}],   프레임, end는 포함하지 않음, 연결 · 휴지 구간은 빠짐
  #  "source": "model" | "baseline", "unknown_units": [...]}  학습에 없는 단위(빼고 만든다)

모델: 일정표(단위 길이 = 학습 몫 중앙값, 연결 · 앞뒤 휴지 = 중앙값 토큰 수)를 만들고 자기회귀로 토큰을 쓴 뒤
VQ 디코더로 한 번에 복원한다. signer=None이면 학습 화자 전부 × per_signer개를 만들어 서로 가장 비슷한 것
(medoid, 55점 프레임 거리)을 고른다. 정답은 보지 않는다. 화자 이름을 주면 그 화자 조건으로 하나 만든다.
기준선 A(mode="baseline"): run 폴더 baseline.npz의 단위 대표 동작을 이어 붙이고 사이를 직선 보간한다.

2026-11-16 재훈 (통합, 브랜치 jjh-accuracy): word_source="exemplar" 선택지.
  낱말 데이터에서 온 단위(W:)를 모델이 만들면 읽는 모델이 1%만 원래 낱말로 읽었다(대표 동작은 86%, docs/ai-log/jaehun.md 11-16).
  그래서 이 선택지를 켜면 문장은 지금처럼 모델이 통째로 만들고, W: 단위 구간만 baseline.npz의 대표 동작으로 바꿔 끼운다.
  S: 단위와 휴지 · 얼굴은 모델이 만든 그대로다. 끼운 자리 앞뒤는 손목이 움직일 거리에 맞춘 길이로 직선 보간한다.
  이때 motion 길이는 tokens × down 과 달라진다(tokens 는 모델이 쓴 것 그대로 돌려준다). 기본값 "model"은 예전과 똑같다.
  word_trim 기본값 0.1 은 재서 고른 값이다: 문장 안 W 구간이 읽힌 비율이 0 → 95%, 0.1 → 93%, 0.2 → 77% 였고,
  구간 길이는 73 → 62 → 58 프레임이었다. 0.1 이 거의 그대로 읽히면서 손이 쉬는 시간을 줄인다.
"""
import json
from pathlib import Path

import numpy as np
import torch

from gen.sentence_data import encode_condition, make_schedule, sha256_path
from gen.sentence_gpt import SentenceGPT
from gen.sentence_motion import BODY_HANDS, WRISTS, concat_with_interp

# 끼운 자리 앞뒤를 잇는 직선 보간 길이: 손목이 어깨너비 1만큼 움직이면 8프레임, 3~14프레임 사이
BRIDGE_PER_UNIT, BRIDGE_MIN, BRIDGE_MAX = 8.0, 3, 14
MIN_ACTIVE = 8


def active_span(clip, trim):
    """대표 동작 [t, 55, 3]에서 손이 쉬는 자리에 머무는 앞뒤를 뺀 구간 (start, end_exclusive).

    낱말 데이터의 클립은 손을 내린 자세에서 시작해 내린 자세로 끝난다. 문장 속에 그대로 끼우면 낱말마다 손이
    내려갔다 올라온다. 앞은 첫 프레임, 뒤는 끝 프레임의 손목 자리를 "쉬는 자리"로 보고, 가장 멀리 간 거리의
    trim 배보다 가까운 앞뒤를 뺀다. trim 이 0 이면 통째로 쓴다."""
    clip = np.asarray(clip, dtype=np.float32)
    n = len(clip)
    if trim <= 0 or n < MIN_ACTIVE:
        return 0, n
    wrists = clip[:, list(WRISTS)]
    lead = np.linalg.norm(wrists - wrists[0], axis=-1).max(-1)
    tail = np.linalg.norm(wrists - wrists[-1], axis=-1).max(-1)
    reach = float(max(lead.max(), tail.max()))
    if reach < 1e-6:
        return 0, n
    start = int(np.argmax(lead > trim * reach))
    end = n - int(np.argmax(tail[::-1] > trim * reach))
    return (start, end) if end - start >= MIN_ACTIVE else (0, n)


def splice_exemplars(motion, segs, clips, trim=0.0):
    """모델이 만든 문장 motion [T, 125, 3]에서 clips {구간 번호: 대표 동작 [t, 55, 3]}의 구간만 바꿔 끼운다.

    → (새 motion, 새 segments). 바꾼 구간의 얼굴은 모델이 만든 그 구간의 얼굴을 길이에 맞춰 쓴다.
    끼운 조각의 앞뒤에는 직선 보간 프레임이 들어가고, 그 프레임은 어느 구간에도 들지 않는다."""
    motion = np.asarray(motion, dtype=np.float32)
    pieces, out, cursor, prev_end, pending = [], [], 0, 0, False
    wrists = list(WRISTS)

    def push(x):
        nonlocal cursor
        if len(x):
            pieces.append(np.asarray(x, dtype=np.float32))
            cursor += len(x)

    def bridge(target):
        if not pieces:
            return
        last = pieces[-1][-1]
        dist = float(np.linalg.norm(target[wrists] - last[wrists], axis=-1).max())
        n = int(np.clip(np.ceil(dist * BRIDGE_PER_UNIT), BRIDGE_MIN, BRIDGE_MAX))
        w = np.linspace(0, 1, n + 2, dtype=np.float32)[1:-1, None, None]
        push(last[None] * (1 - w) + target[None] * w)

    for i, seg in enumerate(segs):
        a, b = int(seg["start"]), int(seg["end"])
        if i not in clips:
            part = motion[prev_end:b]
            if pending and len(part):
                bridge(part[0])
            push(part)
            out.append({"unit": seg["unit"], "start": cursor - (b - a), "end": cursor})
            pending = False
        else:
            head = motion[prev_end:a]
            if len(head):
                if pending:
                    bridge(head[0])
                push(head)
            clip = np.asarray(clips[i], dtype=np.float32)
            s, e = active_span(clip, trim)
            body = clip[s:e]
            piece = motion[np.linspace(a, b - 1, len(body)).round().astype(int)].copy()
            piece[:, BODY_HANDS] = body
            bridge(piece[0])
            start = cursor
            push(piece)
            out.append({"unit": seg["unit"], "start": start, "end": cursor})
            pending = True
        prev_end = b
    tail = motion[prev_end:]
    if len(tail):
        if pending:
            bridge(tail[0])
        push(tail)
    return np.concatenate(pieces, 0).astype(np.float32), out


class SentenceGenerator:
    def __init__(self, model, vocab, signers, context, stats, decoder, device="cpu", baseline=None,
                 mode="model", top_k=10, temperature=1.0, guidance=1.0, per_signer=1, down=4,
                 word_source="model", word_trim=0.1):
        if mode not in ("model", "baseline"):
            raise ValueError("mode must be model or baseline")
        if word_source not in ("model", "exemplar"):
            raise ValueError("word_source must be model or exemplar")
        if word_source == "exemplar" and baseline is None:
            raise ValueError("word_source exemplar needs baseline.npz")
        if mode == "baseline" and baseline is None:
            raise ValueError("baseline mode needs baseline.npz")
        self.model, self.vocab, self.signers, self.context = model, vocab, signers, context
        self.stats, self.decoder, self.device, self.baseline = stats, decoder, torch.device(device), baseline
        self.mode, self.top_k, self.temperature, self.guidance = mode, top_k, temperature, guidance
        self.per_signer, self.down = per_signer, down
        self.word_source, self.word_trim = word_source, float(word_trim)

    def known(self, units):
        if self.mode == "baseline":
            ok = lambda u: u in self.baseline["motions"]
        else:
            ok = lambda u: u in self.vocab and u in self.stats["unit_tokens"] and not u.startswith("<")
        return [u for u in units if ok(u)], [u for u in units if not ok(u)]

    def condition_tensors(self, schedules, signer_ids):
        """일정표 목록 → (조건 [B, L] 다섯 개, signer [B], 길이 목록). 짧은 것은 뒤를 채운다(인과적이라 무관)."""
        L = max(len(c) for c, _, _ in schedules)
        arr = np.zeros((5, len(schedules), L), dtype=np.int64)
        arr[1:3] = 1
        for i, (cond, phase, _) in enumerate(schedules):
            cur, prev, nxt = encode_condition(cond, self.vocab, self.context)
            ph = np.asarray(phase, dtype=np.int64)
            n = len(cond)
            arr[0, i, :n], arr[1, i, :n], arr[2, i, :n] = cur, prev, nxt
            arr[3, i, :n], arr[4, i, :n] = ph[:, 0], ph[:, 1]
        t = [torch.from_numpy(a).to(self.device) for a in arr]
        return t, torch.tensor(signer_ids, dtype=torch.long, device=self.device), [len(s[0]) for s in schedules]

    @torch.no_grad()
    def sample_tokens(self, schedules, signer_ids, seed=None):
        conds, sig, lengths = self.condition_tensors(schedules, signer_ids)
        devices = [self.device.index or 0] if self.device.type == "cuda" else []
        with torch.random.fork_rng(devices=devices):
            if seed is not None:
                torch.manual_seed(seed)
            out = self.model.generate(*conds, sig, top_k=self.top_k, temperature=self.temperature,
                                      guidance=self.guidance)
        return [row[:n] for row, n in zip(out.tolist(), lengths)]

    @torch.no_grad()
    def decode(self, tokens):
        m = self.decoder.decode(torch.tensor([tokens], dtype=torch.long, device=self.device))
        return m[0].float().cpu().numpy().reshape(-1, 125, 3)

    def _baseline(self, units):
        parts = [self.baseline["motions"][u] for u in units]
        body, spans = concat_with_interp(parts, int(self.baseline["gap"]))
        motion = np.repeat(self.baseline["rest"][None], len(body), 0).copy()
        motion[:, BODY_HANDS] = body
        segs = [{"unit": u, "start": int(a), "end": int(b)} for u, (a, b) in zip(units, spans)]
        return motion.astype(np.float32), [], segs

    def generate(self, units, signer=None, seed=None):
        units = list(units)
        known, unknown = self.known(units)
        if not known:
            return {"fps": 30, "motion": np.zeros((0, 125, 3), np.float32), "tokens": [], "segments": [],
                    "source": self.mode, "unknown_units": unknown}
        if self.mode == "baseline":
            motion, tokens, segs = self._baseline(known)
            return {"fps": 30, "motion": motion, "tokens": tokens, "segments": segs, "source": "baseline",
                    "unknown_units": unknown}
        schedule = make_schedule(known, self.stats)
        if signer is not None:
            if signer not in self.signers:
                raise ValueError(f"untrained signer: {signer}")
            names = [signer]
        else:
            names = sorted(self.signers) * self.per_signer
        seqs = self.sample_tokens([schedule] * len(names), [self.signers[n] for n in names], seed)
        motions = [self.decode(s) for s in seqs]
        pick = 0
        if len(motions) > 1:
            x = torch.from_numpy(np.stack(motions)[:, :, BODY_HANDS])
            pick = int((x[:, None] - x[None]).norm(dim=-1).mean(dim=(2, 3)).sum(1).argmin())
        segs = [{"unit": u, "start": t0 * self.down, "end": t1 * self.down} for u, t0, t1 in schedule[2]]
        motion = motions[pick].astype(np.float32)
        if self.word_source == "exemplar":
            # 낱말 데이터에서 온 단위만 대표 동작으로 바꿔 끼운다 (대표 동작이 없는 단위는 모델 것 그대로)
            clips = {i: self.baseline["motions"][s["unit"]] for i, s in enumerate(segs)
                     if s["unit"].startswith("W:") and s["unit"] in self.baseline["motions"]}
            if clips:
                motion, segs = splice_exemplars(motion, segs, clips, self.word_trim)
        return {"fps": 30, "motion": motion, "tokens": seqs[pick], "segments": segs,
                "source": "model", "unknown_units": unknown}


def load_model(path, device="cpu"):
    ck = torch.load(path, map_location="cpu", weights_only=True)
    if ck.get("kind") != "sentence_gpt":
        raise ValueError("not a sentence_gpt checkpoint")
    c = ck["config"]
    model = SentenceGPT(len(ck["units"]), ck["nb_code"], c["d"], c["layers"], c["heads"], c["max_len"],
                        len(ck["signers"]), c["dropout"])
    model.load_state_dict(ck["model"])
    return model.to(device).eval(), ck


def load_baseline(path):
    z = np.load(path, allow_pickle=False)
    units = json.loads(str(z["units"]))
    return {"motions": {u: z[f"m{i}"] for i, u in enumerate(units)}, "rest": z["rest"], "gap": int(z["gap"])}


def save_baseline(path, table, rest, gap):
    """table {unit: (동작 [t, 55, 3], info)}, rest [125, 3] (얼굴을 채울 자세), gap = 연결 보간 프레임 수."""
    units = sorted(table)
    arrays = {f"m{i}": table[u][0].astype(np.float32) for i, u in enumerate(units)}
    np.savez_compressed(path, units=json.dumps(units, ensure_ascii=False), rest=np.asarray(rest, np.float32),
                        gap=np.int64(gap), **arrays)


def load_sentence_generator(run_dir, device="cpu", mode="model", vq_path=None, **sampling):
    """run 폴더 → SentenceGenerator. vq_path를 주면 generator.json의 경로 대신 쓴다(해시는 그대로 확인).

    sampling: top_k(10), temperature(1.0), guidance(1.0), per_signer(1), word_source("model"), word_trim(0.1).
    generator.json에 "sampling"이 있으면 그것을 기본으로 쓰고, 인자로 준 값이 우선한다(서버는 인자를 못 넘김)."""
    from vq.model import load_vqvae
    run = Path(run_dir)
    meta = json.loads((run / "generator.json").read_text(encoding="utf-8"))
    sampling = {**(meta.get("sampling") or {}), **sampling}
    vocab_file = json.loads((run / "vocab.json").read_text(encoding="utf-8"))
    stats = json.loads((run / "schedule.json").read_text(encoding="utf-8"))
    vq = Path(vq_path or meta["vq_checkpoint"])
    if meta.get("vq_sha256") and sha256_path(vq) != meta["vq_sha256"]:
        raise ValueError("VQ decoder hash differs from training run")
    decoder, _ = load_vqvae(str(vq))
    decoder = decoder.to(device).eval()
    if decoder.down != vocab_file["down"]:
        raise ValueError("decoder down mismatch")
    baseline = load_baseline(run / "baseline.npz") if (run / "baseline.npz").exists() else None
    model, ck = (None, None) if mode == "baseline" else load_model(run / meta.get("checkpoint", "model.pt"), device)
    if model is not None and (ck["units"] != vocab_file["units"] or ck["nb_code"] != decoder.quantizer.nb_code):
        raise ValueError("checkpoint / vocab / decoder mismatch")
    return SentenceGenerator(model, vocab_file["units"], vocab_file["signers"], vocab_file["context"], stats,
                             decoder, device, baseline, mode, down=vocab_file["down"], **sampling)
