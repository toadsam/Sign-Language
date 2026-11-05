"""발표용 자모표 실험 비교 그림 (PNG).

  python -m vq.plot_experiments --out runs/figures_midterm

① 실험별 처음 보는 사람 손 · 손가락 오차 (학습 중 평가, 단어 test)    runs/<run>/summary.json
② 단어로만 배운 자모표(E4b) vs 단어 + 문장(E5): 단어 · 문장 구간별 손 오차   runs/<run>/eval_*_test.json (vq.eval_clips)
"""
import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.family"] = ["Malgun Gothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

INK, MUTED, GRID = "#2b2f3a", "#6b7080", "#e6e6ec"
SERIES = ["#2a78d6", "#eb6834"]  # 범주 순서 고정 (dataviz 기본 팔레트 1 · 2번)
RUNS = [("vq_e1", "E1\n512 · 10만"), ("vq_e2", "E2\n얼굴 포함"), ("vq_e4_1024", "E4a\n1024개"),
        ("vq_e4_200k", "E4b\n512 · 20만")]


def style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=MUTED, length=0)
    ax.yaxis.grid(True, color=GRID, lw=0.8)
    ax.set_axisbelow(True)


def bars(ax, groups, series, values, ylabel):
    """values[s][g]. 막대 사이 2px 간격, 값은 막대 위에 작게."""
    n = len(series)
    w = 0.8 / n
    for i, (name, color) in enumerate(zip(series, SERIES)):
        xs = [g + (i - (n - 1) / 2) * w for g in range(len(groups))]
        ax.bar(xs, values[i], w * 0.94, color=color, label=name, edgecolor="white", linewidth=1)
        for x, v in zip(xs, values[i]):
            if v is not None:
                ax.text(x, v + 0.6, f"{v:.1f}", ha="center", va="bottom", fontsize=9, color=INK)
    ax.set_xticks(range(len(groups)), groups, color=INK)
    ax.set_ylabel(ylabel, color=MUTED)
    style(ax)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", default="runs")
    ap.add_argument("--out", default="runs/figures_midterm")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    # ① 실험별 (단어 test, 학습 중 평가)
    rows = [(label, json.load(open(os.path.join(args.runs, r, "summary.json"), encoding="utf-8"))["test_mm"])
            for r, label in RUNS if os.path.exists(os.path.join(args.runs, r, "summary.json"))]
    fig, ax = plt.subplots(figsize=(8, 3.8), dpi=200)
    bars(ax, [l for l, _ in rows], ["손", "손가락(손목 기준)"],
         [[t["hand"] for _, t in rows], [t["finger_rel"] for _, t in rows]], "처음 보는 사람 오차 (mm)")
    ax.set_ylim(0, 38)
    ax.legend(frameon=False, loc="upper right", labelcolor=INK)
    ax.set_title("자모표 실험 — 단어 데이터, 처음 보는 사람(REAL03 · REAL12)", color=INK, fontsize=12, loc="left")
    fig.tight_layout()
    p1 = os.path.join(args.out, "실험비교_단어.png")
    fig.savefig(p1, facecolor="white")
    plt.close(fig)

    # ② E4b vs E5, 구간별
    def ev(run, name):
        return json.load(open(os.path.join(args.runs, run, name), encoding="utf-8"))["mm"]["hand"]
    e4 = {"WORD": ev("vq_e4_200k", "eval_word_test.json"), "SEN": ev("vq_e4_200k", "eval_sen_test.json")}
    e5 = {"WORD": ev("vq_e5", "eval_full_test.json"), "SEN": ev("vq_e5", "eval_full_sen_test.json")}
    groups = [("단어 클립\n전체", "WORD", "전체"), ("단어 클립\n단어 구간", "WORD", "단어 구간"),
              ("문장 클립\n전체", "SEN", "전체"), ("문장 클립\n문장 속 단어", "SEN", "단어 구간"),
              ("문장 클립\n단어 사이 전환", "SEN", "전환")]
    fig, ax = plt.subplots(figsize=(9, 4), dpi=200)
    bars(ax, [g for g, _, _ in groups], ["E4b — 단어로만 학습", "E5 — 단어 + 문장 학습"],
         [[e4[d][k] for _, d, k in groups], [e5[d][k] for _, d, k in groups]], "손 오차 (mm, 프레임 평균)")
    ax.axvline(1.5, color=GRID, lw=1)
    ax.set_ylim(0, 60)
    ax.legend(frameon=False, loc="upper left", labelcolor=INK)
    ax.set_title("문장도 배우면 문장 속 손 오차가 크게 준다 (처음 보는 사람)", color=INK, fontsize=12, loc="left")
    fig.tight_layout()
    p2 = os.path.join(args.out, "E4b_vs_E5_구간별.png")
    fig.savefig(p2, facecolor="white")
    plt.close(fig)
    print(p1)
    print(p2)


if __name__ == "__main__":
    main()
