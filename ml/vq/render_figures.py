"""발표용 그림: 원본과 자모표 복원 동작을 나란히 그린 PNG.

  python -m vq.render_figures --run runs/vq_sample --data data/sample \
      --pair WORD1501_REAL01:75 --pair WORD1517_REAL01:70 --timeline WORD1501_REAL01
"""
import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

from common.skeleton import BODY, FACE, FEAT_DIM, LHAND, N_JOINTS, RHAND, all_edges
from vq.model import MotionVQVAE
from vq.train import load_data, split

plt.rcParams["font.family"] = ["Malgun Gothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

COLOR = {"body": "#2b2f3a", "lhand": "#1a9e77", "rhand": "#d95f02", "face": "#9aa0ad"}
EDGES = all_edges()


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
    ck = torch.load(os.path.join(run, "model.pt"), map_location="cpu")
    c = ck["config"]
    m = MotionVQVAE(FEAT_DIM, c["width"], c["code_dim"], c["nb_code"], depth=c["depth"])
    m.load_state_dict(ck["model"])
    return m.eval(), c


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
    label = "학습에 사용한 단어" if split_name == "train" else "학습에 사용하지 않은 단어"
    fig.suptitle(f"{clip['item']} · {label} · {frame}프레임 · 토큰 {tokens[frame // model.down]}번 · "
                 f"클립 평균 오차 {err:.1f}mm", fontsize=12, color="#4a4e5a", y=0.97)
    legend(fig)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.86, bottom=0.09, wspace=0.04)
    fig.savefig(out, facecolor="white")
    plt.close(fig)
    return err


def fig_timeline(model, clip, out, n=6):
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
    fig.suptitle(f"{clip['item']} 움직임 구간 · 원본과 자모표 복원 · 클립 평균 오차 {err:.1f}mm",
                 fontsize=13, color="#4a4e5a")
    legend(fig)
    fig.subplots_adjust(left=0.035, right=0.995, top=0.88, bottom=0.12, wspace=0.02, hspace=0.16)
    fig.savefig(out, facecolor="white")
    plt.close(fig)


def fig_tokens(model, clip, out):
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
    ax.text(0, -0.45, f"{clip['item']} 한 단어({len(orig) / 30:.1f}초) = 토큰 {len(tokens)}개.  "
                      "진한 칸 = 움직임 구간, 흐린 칸 = 손 내린 대기 자세", fontsize=10, color="#4a4e5a")
    fig.subplots_adjust(left=0.01, right=0.99, top=0.98, bottom=0.02)
    fig.savefig(out, facecolor="white")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--pair", action="append", default=[], help="클립:프레임")
    ap.add_argument("--timeline", action="append", default=[])
    args = ap.parse_args()

    model, cfg = load_model(args.run)
    train, test = split(load_data(args.data), cfg)
    clips = {m["clip"]: (m, "train") for m in train} | {m["clip"]: (m, "test") for m in test}
    out_dir = os.path.join(args.run, "figures")
    os.makedirs(out_dir, exist_ok=True)

    for spec in args.pair:
        name, frame = spec.split(":")
        clip, sp = clips[name]
        path = os.path.join(out_dir, f"비교_{clip['item']}_{sp}.png")
        err = fig_pair(model, clip, int(frame), sp, path)
        print(f"{path}  (클립 오차 {err:.1f}mm)")
    for name in args.timeline:
        clip, _ = clips[name]
        for fn, path in ((fig_timeline, f"시간순_{clip['item']}.png"), (fig_tokens, f"토큰열_{clip['item']}.png")):
            fn(model, clip, os.path.join(out_dir, path))
            print(os.path.join(out_dir, path))


if __name__ == "__main__":
    main()
