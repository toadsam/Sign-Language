"""자모표 그림 격자: 토큰(동작 글자) 하나하나가 어떤 동작 조각인지 한 화면에 보여 준다 (실행 계획 WS2 6단계).

  python -m vq.token_atlas --vq runs/vq_e5 --tokens C:/aihub/tokens/tokens_e5.json --word-meta C:/aihub/full/meta.jsonl

만드는 것 (runs/<vq>/figures/)
  token_atlas.html   512칸 격자. 칸마다 그 토큰을 디코더로 펼친 4프레임(0.13초)을 반복 재생, 많이 쓰는 단어 표시
  자모표_격자.png     발표용: 많이 쓰이는 토큰 48개, 4프레임을 겹쳐 그림 (흐린 것 → 진한 것이 시간 순서)

토큰 하나만 디코더에 넣으면 앞뒤 문맥이 없어 가장자리가 흔들리므로, 같은 토큰을 3번 이어 넣고 가운데 4프레임을 쓴다.
쓰임새는 토큰 파일(계약 ②)에서 세고, "많이 쓰는 단어"는 단어(WORD) 클립에서 그 토큰이 나온 횟수로 정한다.
"""
import argparse
import collections
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

from common.skeleton import BODY, LHAND, N_JOINTS, RHAND, all_edges
from vq.model import load_vqvae

plt.rcParams["font.family"] = ["Malgun Gothic", "sans-serif"]
NJ = RHAND.stop  # 상체 + 양손 55점 (얼굴은 평균이라 그리지 않음)
COLOR = {"body": "#2b2f3a", "lhand": "#1a9e77", "rhand": "#d95f02"}


def part(j):
    return "body" if j < BODY.stop else "lhand" if j < LHAND.stop else "rhand"


@torch.no_grad()
def decode_all(vq, nb):
    idx = torch.arange(nb)[:, None].repeat(1, 3)  # [nb, 3] 같은 토큰 3번
    x = vq.decode(idx).view(nb, 3 * vq.down, N_JOINTS, 3)[:, vq.down: 2 * vq.down, :NJ]  # 가운데 토큰의 4프레임
    return x.numpy()


def usage(tokens_path, word_meta, nb):
    tk = json.load(open(tokens_path, encoding="utf-8"))
    gloss = {}
    if word_meta:
        for l in open(word_meta, encoding="utf-8"):
            m = json.loads(l)
            if m.get("label") == "ok" and m.get("gloss"):
                gloss[m["clip"]] = m["gloss"][0]
    total = np.zeros(nb, int)
    by_type = collections.defaultdict(lambda: np.zeros(nb, int))
    hits = [collections.Counter() for _ in range(nb)]  # 토큰 → 단어별 그 토큰이 들어간 클립 수
    n_word = collections.Counter()
    for clip, c in tk["clips"].items():
        for t in c["tokens"]:
            total[t] += 1
            by_type[c["type"]][t] += 1
        if clip in gloss:
            n_word[gloss[clip]] += 1
            for t in set(c["tokens"]):
                hits[t][gloss[clip]] += 1
    # 많이 쓰는 단어 = 그 단어의 클립 중 이 토큰이 나오는 비율이 높은 단어 (대기 자세처럼 어디에나 나오는 토큰은 따로 표시)
    n_clips = sum(n_word.values())
    share = np.array([sum(h.values()) / max(n_clips, 1) for h in hits])
    words = []
    for t in range(nb):
        r = [(w, k / n_word[w]) for w, k in hits[t].items() if k >= 5 and n_word[w] >= 8]
        words.append([(w, round(f, 2)) for w, f in sorted(r, key=lambda z: -z[1])[:5]])
    return tk.get("vq_version", ""), total, {k: v.tolist() for k, v in by_type.items()}, words, share


def png_grid(x, order, total, words, out, n=48, cols=8):
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 1.7, rows * 2.25), dpi=170)
    edges = [(a, b) for a, b in all_edges() if a < NJ and b < NJ]
    lim = 1.35  # 어깨너비 = 1 기준, 상체가 꽉 차게
    for k, ax in enumerate(axes.flat):
        ax.axis("off")
        if k >= n:
            continue
        t = order[k]
        for f in range(x.shape[1]):
            alpha = 0.25 + 0.75 * f / (x.shape[1] - 1)
            p = x[t, f]
            for a, b in edges:
                ax.plot([p[a, 0], p[b, 0]], [-p[a, 1], -p[b, 1]], color=COLOR[part(b)], lw=0.9, alpha=alpha)
        ax.set_xlim(-lim, lim)
        ax.set_ylim(-2.15, 0.62)
        ax.set_aspect("equal")
        top = words[t][:1]
        ax.set_title(f"#{t}", fontsize=8, color="#4f46b8", pad=1)
        ax.text(0, -2.12, (top[0][0] if top else "–")[:7], ha="center", fontsize=7.5, color="#4a4e5a")
    fig.suptitle("자모표의 동작 글자 48개 (손을 쓰는 토큰 중 많이 쓰이는 순) — 토큰 하나 = 0.13초 · 흐린 선 → 진한 선이 시간 순서 · 아래는 이 토큰이 자주 나오는 단어",
                 fontsize=11, color="#2b2f3a", y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(out, facecolor="white")
    plt.close(fig)


HTML = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>자모표 그림 격자</title>
<style>
:root{--bg:#f6f6f8;--card:#fff;--ink:#1d2028;--ink2:#5a5f6d;--line:#e2e3ea;--acc:#4f46b8;--body:#2b2f3a;--lh:#1a9e77;--rh:#d95f02}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d24;--ink:#e7e8ec;--ink2:#a5abb8;--line:#2b2f39;--acc:#a39cf2;--body:#d5d8e0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 "Malgun Gothic",system-ui,sans-serif;padding:20px 16px 60px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--ink2);margin:0 0 14px;max-width:60rem}
.bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 14px;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
.bar label{color:var(--ink2);font-size:13px}select,input{font:inherit;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}
.legend span{display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:13px;color:var(--ink2)}.legend i{width:14px;height:3px;border-radius:2px;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}
.cell{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 6px 6px;cursor:pointer}
.cell:hover,.cell.sel{border-color:var(--acc)}.cell canvas{width:100%;aspect-ratio:1/1;display:block}
.cell .id{font:12px ui-monospace,Consolas,monospace;color:var(--acc)}.cell .w{font-size:12px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell .n{float:right;font:11px ui-monospace,Consolas,monospace;color:var(--ink2)}
#detail{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 14px;display:none;max-width:60rem}
#detail b{color:var(--acc)}
</style></head><body>
<h1>자모표 그림 격자</h1>
<p class="sub">수어 동작은 0.13초(4프레임)마다 아래 __NB__개 토큰 중 하나로 바뀝니다. 칸마다 그 토큰을 디코더로 펼친 동작 조각이 반복 재생됩니다.
얼굴은 이 자모표가 만들지 않아(평균 얼굴) 그리지 않았습니다. 칸을 누르면 그 토큰을 많이 쓰는 단어가 나옵니다. 자모표 __VQ__ · 토큰 파일 __VER__.</p>
<div class="bar">
 <label>정렬 <select id="sort"><option value="use">많이 쓰는 순</option><option value="id">번호 순</option><option value="hand">손 높이 순</option><option value="move">움직임 큰 순</option></select></label>
 <label><input type="checkbox" id="hideRest" checked> 대기 자세 토큰 숨기기</label>
 <label>단어 찾기 <input id="q" placeholder="예: 학교" size="10"></label>
 <span class="legend"><span><i style="background:var(--body)"></i>몸</span><span><i style="background:var(--lh)"></i>왼손</span><span><i style="background:var(--rh)"></i>오른손</span></span>
 <span id="cnt" style="color:var(--ink2);font-size:13px"></span>
</div>
<div id="detail"></div>
<div class="grid" id="grid"></div>
<script>
const D = __DATA__;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const grid = document.getElementById("grid"), cells = [];
const lim = D.lim;
function part(j){return j < D.body ? "--body" : j < D.lhand ? "--lh" : "--rh";}
function draw(cv, t, f){
  const c = cv.getContext("2d"), W = cv.width, s = W / (2 * lim), P = D.x[t][f];
  c.clearRect(0, 0, W, W); c.lineWidth = 1.6; c.lineCap = "round";
  for (const [a, b] of D.edges){ c.strokeStyle = css(part(b)); c.beginPath();
    c.moveTo(W/2 + P[a][0]*s, W*0.32 + P[a][1]*s); c.lineTo(W/2 + P[b][0]*s, W*0.32 + P[b][1]*s); c.stroke(); }
}
for (let t = 0; t < D.n; t++){
  const el = document.createElement("div"); el.className = "cell";
  const top = D.words[t];
  el.innerHTML = `<span class="id">#${t}</span><span class="n">${D.use[t].toLocaleString()}</span><canvas width="160" height="160"></canvas><div class="w">${D.rest[t] ? "대기 · 공통" : top.length ? top.map(w=>w[0]).slice(0,2).join(" · ") : "–"}</div>`;
  el.onclick = () => { document.querySelectorAll(".cell.sel").forEach(e=>e.classList.remove("sel")); el.classList.add("sel");
    const d = document.getElementById("detail"); d.style.display = "block";
    d.innerHTML = `<b>토큰 #${t}</b> · 전체 ${D.use[t].toLocaleString()}번 쓰임 (단어 클립 ${D.useWord[t].toLocaleString()} · 문장 클립 ${D.useSen[t].toLocaleString()})<br>` +
      (D.rest[t] ? `대기 자세이거나 거의 모든 단어에 나오는 토큰 (단어 클립의 ${Math.round(D.share[t]*100)}%)<br>` : "") +
      (top.length ? `이 토큰이 자주 나오는 단어 (그 단어 클립 중 비율): ` + top.map(w=>`${w[0]} ${Math.round(w[1]*100)}%`).join(", ") : "단어 클립에서는 5번 미만"); };
  grid.appendChild(el); cells.push({el, t, cv: el.querySelector("canvas")});
}
let f = 0, dir = 1;
setInterval(() => { f += dir; if (f === D.frames - 1 || f === 0) dir = -dir;
  for (const c of cells) if (c.el.style.display !== "none" && c.visible) draw(c.cv, c.t, f); }, 110);
const io = new IntersectionObserver(es => es.forEach(e => { const c = cells.find(c => c.el === e.target); c.visible = e.isIntersecting; if (c.visible) draw(c.cv, c.t, f); }));
cells.forEach(c => io.observe(c.el));
function apply(){
  const k = document.getElementById("sort").value, q = document.getElementById("q").value.trim();
  const key = {use: t => -D.use[t], id: t => t, hand: t => D.hand[t], move: t => -D.move[t]}[k];
  const order = [...cells].sort((a, b) => key(a.t) - key(b.t)); let shown = 0;
  const hide = document.getElementById("hideRest").checked;
  for (const c of order){ const ok = (!q || D.words[c.t].some(w => w[0].includes(q))) && !(hide && D.rest[c.t]); c.el.style.display = ok ? "" : "none"; if (ok) shown++; grid.appendChild(c.el); }
  document.getElementById("cnt").textContent = q ? `"${q}"가 들어간 토큰 ${shown}개` : `토큰 ${shown}개`;
}
document.getElementById("sort").onchange = apply; document.getElementById("hideRest").onchange = apply; document.getElementById("q").oninput = apply; apply();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => cells.forEach(c => c.visible && draw(c.cv, c.t, f)));
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vq", required=True)
    ap.add_argument("--tokens", required=True, help="같은 자모표로 만든 토큰 파일")
    ap.add_argument("--word-meta", default="", help="단어(WORD) meta.jsonl — 토큰별 많이 쓰는 단어")
    args = ap.parse_args()

    vq, cfg = load_vqvae(os.path.join(args.vq, "model.pt"))
    nb = cfg["nb_code"]
    x = decode_all(vq, nb)  # [nb, 4, 55, 3]
    ver, total, by_type, words, share = usage(args.tokens, args.word_meta, nb)
    wrist = x[:, :, [LHAND.start, RHAND.start]]  # 양 손목
    hand_h = wrist[..., 1].mean((1, 2))  # y 아래 방향 → 작을수록 손이 높다
    move = np.linalg.norm(np.diff(x, axis=1), axis=-1).mean((1, 2))
    rest = (wrist[..., 1].mean(1).min(1) > 1.2) | (share > 0.3)  # 양손이 다 내려가 있거나 단어 클립 30% 이상에 나오는 토큰
    order = np.argsort(-total)
    active = [t for t in order if not rest[t]]

    out = os.path.join(args.vq, "figures")
    os.makedirs(out, exist_ok=True)
    png_grid(x, active, total, words, os.path.join(out, "자모표_격자.png"))
    data = {"n": nb, "frames": x.shape[1], "body": BODY.stop, "lhand": LHAND.stop,
            "edges": [(a, b) for a, b in all_edges() if a < NJ and b < NJ],
            "lim": float(np.abs(x[..., :2]).max() * 1.1),
            "x": np.round(x[..., :2], 3).tolist(), "use": total.tolist(),
            "useWord": by_type.get("WORD", [0] * nb), "useSen": by_type.get("SEN", [0] * nb),
            "words": words,
            "hand": np.round(hand_h, 4).tolist(), "move": np.round(move, 5).tolist(),
            "rest": rest.tolist(), "share": np.round(share, 3).tolist()}
    html = (HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            .replace("__NB__", str(nb)).replace("__VQ__", os.path.basename(os.path.normpath(args.vq)))
            .replace("__VER__", ver or "–"))
    p = os.path.join(out, "token_atlas.html")
    open(p, "w", encoding="utf-8").write(html)
    used = int((total > 0).sum())
    print(f"{p} ({os.path.getsize(p) / 1e6:.1f}MB) · {os.path.join(out, '자모표_격자.png')}")
    print(f"대기 자세 · 어디에나 나오는 토큰 {int(rest.sum())}개 (그림 PNG에서는 뺌)")
    print(f"쓰인 토큰 {used}/{nb} · 가장 많이 쓰인 10개 {order[:10].tolist()} · 상위 10개가 전체의 {total[order[:10]].sum() / total.sum():.0%}")


if __name__ == "__main__":
    main()
