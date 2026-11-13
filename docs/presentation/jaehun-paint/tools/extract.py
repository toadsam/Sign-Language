"""발표용 동작 데이터를 data/ 폴더에 JSON으로 뽑는다.

numpy만 있으면 원본 동작·귀 오류·토큰·자모표 격자(2D)를 뽑고,
--decode 와 torch가 있으면 E5·E4b 디코더로 복원 동작까지 만든다.

python tools/extract.py --repo <저장소 루트> --aihub C:/aihub [--decode --mlsrc <ml 소스 루트>]
출력: data/clips.json, data/atlas.json, data/tokens_meta.json
data/ 는 .gitignore 에 있다 (AI Hub 파생물).
"""
import argparse, json, os, re, sys
import numpy as np

ROUND = 3


def load_clip(aihub, kind, clip):
    base = f"{aihub}/{'full' if kind == 'WORD' else 'full_sen'}"
    x = np.load(f"{base}/npy/{clip}.npy").astype(np.float32)
    meta = json.load(open(f"{base}/npy/{clip}.json", encoding="utf8"))
    return x, meta


def arr(x):
    return np.round(np.asarray(x, dtype=np.float32), ROUND).tolist()


def html_json(path, marker):
    s = open(path, encoding="utf8").read()
    m = re.search(marker, s)
    return json.JSONDecoder().raw_decode(s[m.end() - 1:])[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--aihub", default="C:/aihub")
    ap.add_argument("--out", default=None)
    ap.add_argument("--decode", action="store_true")
    ap.add_argument("--mlsrc", default=None, help="ml/ 폴더를 담은 루트 (vq/model.py 가 있어야 함)")
    a = ap.parse_args()
    out = a.out or os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(out, exist_ok=True)

    tokens = json.load(open(f"{a.aihub}/tokens/tokens_e5.json", encoding="utf8"))
    clips = {}

    # 1) 단어 예시 「인력」, 2) 문장 예시 「여의도 곳 방법」 (평가 사람 REAL03)
    for kind, clip in [("WORD", "WORD0773_REAL03"), ("SEN", "SEN1384_REAL03")]:
        x, meta = load_clip(a.aihub, kind, clip)
        t = tokens["clips"][clip]
        clips[clip] = {
            "kind": kind, "gloss": meta.get("gloss"), "frames": int(meta["frames"]),
            "active": meta["active"], "segments": meta.get("segments", []),
            "scale": meta["norm"]["scale"], "tokenFrames": t["frames"], "tokens": t["tokens"],
            "orig": arr(x),
        }

    # 3) 귀 오류 예시: 수리 전(backup) vs 수리 후(full). 평가 사람 REAL03, 왼쪽 귀가 내내 틀린 클립
    ear_clip = "WORD2891_REAL03"
    before = np.load(f"{a.aihub}/repair_backup/ears_v2/{ear_clip}.npy").astype(np.float32)
    after, meta = load_clip(a.aihub, "WORD", ear_clip)
    sc = meta["norm"]["scale"]
    dist = np.linalg.norm(before[:, 12] - before[:, 0], axis=1) * sc * 100
    clips[ear_clip] = {
        "kind": "WORD", "gloss": meta.get("gloss"), "frames": int(meta["frames"]), "active": meta["active"],
        "scale": sc, "before": arr(before), "after": arr(after),
        "leftEarNoseCmMean": float(dist.mean()), "leftEarNoseCmMax": float(dist.max()),
    }

    # 4) 기준선 B1: 단어 3개 이어붙인 문장 (그대로 잇기 vs 토큰 잇기) 한 조합
    b1 = html_json(f"{a.repo}/ml/runs/b1/viewer_sentences.html", r"const DATA = \{")
    c = b1["clips"][0]
    clips["B1_" + c["name"]] = {
        "kind": "B1", "labels": b1["labels"], "name": c["name"], "frames": c["frames"],
        "concat": arr(np.array(c["orig"]).reshape(-1, 125, 3)),
        "tokenJoin": arr(np.array(c["recon"]).reshape(-1, 125, 3)),
        "edges": b1["edges"],
    }

    # 5) 디코더 복원 (torch 필요)
    if a.decode:
        sys.path.insert(0, os.path.join(a.mlsrc, "ml"))
        import torch
        from vq.model import load_vqvae
        for run, tag in [("vq_e5", "e5"), ("vq_e4_200k", "e4b")]:
            vq, cfg = load_vqvae(f"{a.repo}/ml/runs/{run}/model.pt")
            vq.eval()
            for clip in ["WORD0773_REAL03", "SEN1384_REAL03"]:
                x = np.array(clips[clip]["orig"], dtype=np.float32)
                f0, f1 = clips[clip]["tokenFrames"]
                seg = x[f0:f1].reshape(1, -1, 375)
                with torch.no_grad():
                    idx = vq.encode(torch.from_numpy(seg))
                    rec = vq.decode(idx)[0].numpy().reshape(-1, 125, 3)
                clips[clip][f"recon_{tag}"] = arr(rec)
                clips[clip][f"tokens_{tag}"] = idx[0].tolist()
                hand = np.linalg.norm(rec[:, 13:55] - x[f0:f0 + len(rec), 13:55], axis=2).mean() * clips[clip]["scale"] * 1000
                clips[clip][f"handMm_{tag}"] = float(hand)
                print(clip, tag, "hand mm", round(float(hand), 1))

    json.dump(clips, open(f"{out}/clips.json", "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print("clips.json", {k: list(v.keys()) for k, v in clips.items()})

    # 6) 자모표 격자 (디코더 출력만, 2D 55점) — token_atlas.html 의 D
    D = html_json(f"{a.repo}/ml/runs/vq_e5/figures/token_atlas.html", r"const D *= *\{")
    atlas = {k: D[k] for k in ["n", "frames", "body", "lhand", "edges", "lim", "x", "use", "useWord", "useSen", "words", "hand", "move", "rest", "share"] if k in D}
    json.dump(atlas, open(f"{out}/atlas.json", "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print("atlas.json tokens", len(atlas["x"]))

    # 7) 토큰 통계 (길이 분포) — 숫자만
    lens = {"WORD": [], "SEN": []}
    for v in tokens["clips"].values():
        lens[v["type"]].append(len(v["tokens"]))
    stat = {k: {"n": len(v), "min": int(min(v)), "max": int(max(v)), "mean": float(np.mean(v))} for k, v in lens.items()}
    json.dump(stat, open(f"{out}/tokens_meta.json", "w", encoding="utf8"), ensure_ascii=False)
    print("tokens_meta", stat)


if __name__ == "__main__":
    main()
