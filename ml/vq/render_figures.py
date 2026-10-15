"""발표용 그림: 원본과 자모표 복원 동작을 나란히 그린 PNG.

  python -m vq.render_figures --run runs/vq_sample --data data/sample \
      --pair WORD1501_REAL01:75 --pair WORD1517_REAL01:70 --timeline WORD1501_REAL01

정식 데이터도 고른 클립만 읽는다(전체를 메모리에 올리지 않음). --curve 는 log.jsonl 로 학습 곡선을 그린다.
"""
import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

from common.skeleton import BODY, FACE, LHAND, N_JOINTS, RHAND, all_edges
from vq.model import load_vqvae
from common.data import FEAT_DIM, apply_split, load_split
from vq.train import load_data, split

plt.rcParams["font.family"] = ["Malgun Gothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

COLOR = {"body": "#2b2f3a", "lhand": "#1a9e77", "rhand": "#d95f02", "face": "#9aa0ad"}
EDGES = all_edges()
# 분할 방식에 따라 "처음 보는 것"이 단어인지 사람인지 다르다. main에서 정한다
LABEL = {"train": "학습에 사용한 단어", "test": "학습에 사용하지 않은 단어"}


def title(clip):
    g = clip.get("gloss")
    return f"「{' '.join(g)}」({clip['item']})" if g else clip["item"]


def load_clips(data_dir, names):
    """meta.jsonl 에서 고른 클립만 읽는다."""
    names = set(names)
    metas = [json.loads(l) for l in open(os.path.join(data_dir, "meta.jsonl"), encoding="utf-8")]
    metas = [m for m in metas if m["clip"] in names]
    for m in metas:
        m["x"] = np.load(os.path.join(data_dir, "npy", f"{m['clip']}.npy")).reshape(-1, FEAT_DIM)
    return metas


def part(j):
    if j < BODY.stop:
        return "body"
    if j < LHAND.stop:
        return "lhand"
    if j < RHAND.stop:
        return "rhand"
    return "face"


def draw(ax, pose):
    """정면(카메라) 시점. y가 아래 방향이라 뒤집어 그린다."""
    x, y = pose[:, 0], -pose[:, 1]
    for a, b in EDGES:
        p = part(b)
        ax.plot([x[a], x[b]], [y[a], y[b]], color=COLOR[p], solid_capstyle="round",
                lw={"body": 3.2, "face": 0.9}.get(p, 1.5))
    hands = np.r_[LHAND.start:LHAND.stop, RHAND.start:RHAND.stop]
    ax.scatter(x[hands], y[hands], s=5, c=[COLOR[part(j)] for j in hands], zorder=3)
    ax.set_xlim(-1.45, 1.45)
    ax.set_ylim(-2.15, 0.7)
    ax.set_aspect("equal")
    ax.axis("off")


def load_model(run):
    return load_vqvae(os.path.join(run, "model.pt"))


@torch.no_grad()
def reconstruct(model, clip):
    T = len(clip["x"]) // model.down * model.down
    x = torch.from_numpy(clip["x"][:T])[None]
    xh, _, _, idx = model(x)
    orig, rec = x[0].view(T, N_JOINTS, 3).numpy(), xh[0].view(T, N_JOINTS, 3).numpy()
    err = np.linalg.norm(orig - rec, axis=-1).mean() * clip["norm"]["scale"] * 1000
    return orig, rec, idx[0].tolist(), float(err)


def legend(fig):
    handles = [plt.Line2D([], [], color=COLOR[k], lw=3) for k in ("body", "lhand", "rhand", "face")]
    fig.legend(handles, ["몸", "왼손", "오른손", "얼굴"], loc="lower center", ncol=4, frameon=False, fontsize=11)


def fig_pair(model, clip, frame, split_name, out):
    orig, rec, tokens, err = reconstruct(model, clip)
    frame = min(frame, len(orig) - 1)
    fig, axes = plt.subplots(1, 2, figsize=(8.6, 5.4), dpi=200)
    draw(axes[0], orig[frame])
    draw(axes[1], rec[frame])
    axes[0].set_title("원본 (AI Hub 3D 좌표)", fontsize=14, pad=8)
    axes[1].set_title("자모표로 바꿨다 되돌린 동작", fontsize=14, pad=8)
    fig.suptitle(f"{title(clip)} · {LABEL[split_name]} · {frame}프레임 · 토큰 {tokens[frame // model.down]}번 · "
                 f"클립 평균 오차 {err:.1f}mm", fontsize=12, color="#4a4e5a", y=0.97)
    legend(fig)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.86, bottom=0.09, wspace=0.04)
    fig.savefig(out, facecolor="white")
    plt.close(fig)
    return err


def fig_timeline(model, clip, split_name, out, n=6):
    orig, rec, tokens, err = reconstruct(model, clip)
    a, b = clip["active"]
    frames = np.linspace(a, min(b, len(orig) - 1), n).round().astype(int)
    fig, axes = plt.subplots(2, n, figsize=(2.3 * n, 6.6), dpi=200)
    for i, f in enumerate(frames):
        draw(axes[0, i], orig[f])
        draw(axes[1, i], rec[f])
        axes[0, i].set_title(f"{f / 30:.2f}초", fontsize=11)
        axes[1, i].text(0, -2.32, f"토큰 {tokens[f // model.down]}", ha="center", fontsize=10,
                        color="#4f46b8")
    fig.text(0.012, 0.72, "원본", fontsize=13, rotation=90, va="center")
    fig.text(0.012, 0.3, "복원", fontsize=13, rotation=90, va="center")
    fig.suptitle(f"{title(clip)} · {LABEL[split_name]} · 움직임 구간 · 원본과 자모표 복원 · 클립 평균 오차 {err:.1f}mm",
                 fontsize=13, color="#4a4e5a")
    legend(fig)
    fig.subplots_adjust(left=0.035, right=0.995, top=0.88, bottom=0.12, wspace=0.02, hspace=0.16)
    fig.savefig(out, facecolor="white")
    plt.close(fig)


def fig_tokens(model, clip, split_name, out):
    orig, rec, tokens, err = reconstruct(model, clip)
    a, b = clip["active"]
    fig, ax = plt.subplots(figsize=(12, 1.9), dpi=200)
    for k, t in enumerate(tokens):
        rest = (k + 1) * model.down <= a or k * model.down >= b
        ax.add_patch(plt.Rectangle((k, 0), 0.92, 1, color="#e6e6ec" if rest else "#eae8f8"))
        ax.text(k + 0.46, 0.5, str(t), ha="center", va="center", fontsize=8,
                color="#9aa0ad" if rest else "#3a3392", family="monospace")
    ax.set_xlim(0, len(tokens))
    ax.set_ylim(-0.6, 1.1)
    ax.axis("off")
    ax.text(0, -0.45, f"{title(clip)} 한 단어({len(orig) / 30:.1f}초) = 토큰 {len(tokens)}개.  "
                      "진한 칸 = 움직임 구간, 흐린 칸 = 손 내린 대기 자세", fontsize=10, color="#4a4e5a")
    fig.subplots_adjust(left=0.01, right=0.99, top=0.98, bottom=0.02)
    fig.savefig(out, facecolor="white")
    plt.close(fig)


def fig_curve(run, out):
    """평가 기록(log.jsonl)으로 test 오차와 코드 사용률 곡선."""
    rows = [json.loads(l) for l in open(os.path.join(run, "log.jsonl"), encoding="utf-8")]
    ev = [r for r in rows if r.get("eval_test")]
    nb = json.load(open(os.path.join(run, "config.json"), encoding="utf-8"))["nb_code"]
    it = [r["iter"] / 1000 for r in ev]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.6), dpi=200)
    for k, name, c in (("hand", "손", COLOR["rhand"]), ("body", "상체", COLOR["body"]),
                       ("finger_rel", "손가락(손목 기준)", COLOR["lhand"])):
        a1.plot(it, [r["eval_test"][k] for r in ev], "o-", color=c, label=name, ms=3)
    a1.set_xlabel("학습 반복 (천 회)")
    a1.set_ylabel("처음 보는 사람 평균 오차 (mm)")
    a1.legend(frameon=False)
    a1.grid(alpha=0.3)
    a2.plot(it, [r["codes_test"] / nb * 100 for r in ev], "o-", color="#4f46b8", ms=3, label="처음 보는 사람")
    a2.plot(it, [r["codes_train"] / nb * 100 for r in ev], "o--", color="#9aa0ad", ms=3, label="학습한 사람")
    a2.axhline(50, color="#d95f02", lw=1, ls=":")
    a2.text(it[0], 52, "관문 기준 50%", color="#d95f02", fontsize=9)
    a2.set_ylim(0, 105)
    a2.set_xlabel("학습 반복 (천 회)")
    a2.set_ylabel(f"자모표 {nb}개 중 쓰인 비율 (%)")
    a2.legend(frameon=False, loc="lower right")
    a2.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, facecolor="white")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--pair", action="append", default=[], help="클립:프레임")
    ap.add_argument("--timeline", action="append", default=[])
    ap.add_argument("--curve", action="store_true", help="학습 곡선 (log.jsonl)")
    args = ap.parse_args()

    model, cfg = load_model(args.run)
    out_dir = os.path.join(args.run, "figures")
    os.makedirs(out_dir, exist_ok=True)
    if args.curve:
        path = os.path.join(out_dir, "학습곡선.png")
        fig_curve(args.run, path)
        print(path)

    names = [p.split(":")[0] for p in args.pair] + args.timeline
    if not names:
        return
    sp = load_split(args.data)
    if sp is not None:  # 고정 분할표가 있으면 고른 클립만 읽어서 나눈다
        if sp["mode"] == "signer":
            LABEL.update(train="학습에 쓴 사람", test="처음 보는 사람")
        train, _, test = apply_split(load_clips(args.data, names), sp)
    else:
        train, test = split(load_data(args.data), cfg)
    clips = {m["clip"]: (m, "train") for m in train} | {m["clip"]: (m, "test") for m in test}

    for spec in args.pair:
        name, frame = spec.split(":")
        clip, s = clips[name]
        path = os.path.join(out_dir, f"비교_{clip['item']}_{s}.png")
        err = fig_pair(model, clip, int(frame), s, path)
        print(f"{path}  (클립 오차 {err:.1f}mm)")
    for name in args.timeline:
        clip, s = clips[name]
        for fn, path in ((fig_timeline, f"시간순_{clip['item']}.png"), (fig_tokens, f"토큰열_{clip['item']}.png")):
            fn(model, clip, s, os.path.join(out_dir, path))
            print(os.path.join(out_dir, path))


if __name__ == "__main__":
    main()
