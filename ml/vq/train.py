"""동작 자모표(VQ-VAE) 학습.

샘플 과적합 테스트:
  python -m vq.train --data data/sample --run runs/vq_sample --iters 3000 --nb-code 128

실행 계획의 실험 (정식 데이터):
  E1 상체+손:    python -m vq.train --data data/full --run runs/vq_e1 --split signer --parts body_hand --note "E1"
  E2 얼굴 포함:  python -m vq.train --data data/full --run runs/vq_e2 --split signer --parts all --note "E2"

끊겨도 이어서 학습 (Colab 등): 같은 명령에 --resume 을 붙인다. runs/<이름>/ckpt.pt 에서 이어 간다.

기록하는 것: 손실, 코드북 사용률·perplexity, 부위별 복원 오차(MPJPE, mm)
끝나면 runs/<이름>/viewer.html 에 원본·복원 비교 뷰어를 만들고, ml/experiments.md 에 결과 한 줄을 붙인다.
"""
import argparse
import datetime
import json
import os
import subprocess
import time

import numpy as np
import torch
import torch.nn.functional as F

from common.data import load_data, load_split, make_split
from common.viewer import write_viewer
from common.skeleton import BODY, FACE, FEAT_DIM, L_HAND_ROOT, LHAND, N_JOINTS, R_HAND_ROOT, RHAND
from vq.model import PARTS, MotionVQVAE

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 이어 학습할 때 바뀌면 안 되는 설정 (모델 모양·데이터·분할)
FIXED_KEYS = ["data", "subset", "parts", "width", "code_dim", "nb_code", "depth", "window", "split", "holdout", "test_signers", "seed"]


# ---------------------------------------------------------------- 데이터
def split(metas, cfg):
    """ml/splits/<데이터 폴더 이름>.json 이 있으면 그 고정 분할을 쓴다 (팀 전체가 같은 test 수행자).
    없으면 샘플(수행자 1명)은 단어 단위, 정식 데이터는 --split signer 로 수행자 단위로 그때그때 나눈다."""
    return make_split(metas, cfg.get("split", "item"), cfg.get("holdout", 4), cfg.get("test_signers", 2),
                      cfg.get("seed", 0), data_dir=cfg.get("data"))


def sample_batch(clips, batch, window, rng):
    out = np.empty((batch, window, FEAT_DIM), np.float32)
    for b in range(batch):
        x = clips[rng.integers(len(clips))]["x"]
        s = rng.integers(0, len(x) - window + 1)
        out[b] = x[s: s + window]
    return torch.from_numpy(out)


# ---------------------------------------------------------------- 손실
def joint_weights(w_body, w_hand, w_face, nj=N_JOINTS):
    w = torch.empty(N_JOINTS)
    w[BODY], w[LHAND], w[RHAND], w[FACE] = w_body, w_hand, w_hand, w_face
    w = w[:nj]  # 자모표가 맡는 관절만
    return w / w.mean()


def hand_relative(x):  # [B, T, 125, 3] → 손목 기준 손가락 좌표 [B, T, 42, 3]
    return torch.cat([x[:, :, LHAND] - x[:, :, L_HAND_ROOT: L_HAND_ROOT + 1],
                      x[:, :, RHAND] - x[:, :, R_HAND_ROOT: R_HAND_ROOT + 1]], dim=2)


def losses(x, xh, w, beta):
    """w의 길이(nj)만큼 앞 관절만 손실에 넣는다. 나머지는 자모표가 만들지 않는 관절이다."""
    B, T, _ = x.shape
    nj = len(w)
    x4, xh4 = x.view(B, T, N_JOINTS, 3)[:, :, :nj], xh.view(B, T, N_JOINTS, 3)[:, :, :nj]
    sl1 = lambda a, b: F.smooth_l1_loss(a, b, reduction="none", beta=beta)
    pos = (sl1(x4, xh4) * w[None, None, :, None]).mean()
    vel = (sl1(x4[:, 1:] - x4[:, :-1], xh4[:, 1:] - xh4[:, :-1]) * w[None, None, :, None]).mean()
    hand = sl1(hand_relative(x4), hand_relative(xh4)).mean()
    return pos, vel, hand


# ---------------------------------------------------------------- 평가
@torch.no_grad()
def evaluate(model, clips, down, device="cpu", keep=()):
    """클립 전체를 인코딩→복원해 부위별 MPJPE(mm)와 코드 사용 현황을 잰다.
    복원 결과는 keep 에 든 클립만 돌려준다 (전부 모으면 데이터만큼 메모리를 더 쓴다)."""
    model.eval()
    errs = {"body": [], "hand": [], "finger_rel": [], "face": [], "all": []}
    used, recon = set(), {}
    for m in clips:
        T = len(m["x"]) // down * down
        x = torch.from_numpy(m["x"][:T])[None]
        xh, _, _, idx = model(x.to(device))
        xh, idx = xh.cpu(), idx.cpu()
        used.update(idx.flatten().tolist())
        mm = m["norm"]["scale"] * 1000.0  # 정규화 단위(어깨너비) → mm
        x4, xh4 = x.view(1, T, N_JOINTS, 3), xh.view(1, T, N_JOINTS, 3)
        d = (x4 - xh4).norm(dim=-1)[0] * mm  # [T, 125]
        errs["body"].append(d[:, BODY].mean().item())
        errs["hand"].append(torch.cat([d[:, LHAND], d[:, RHAND]], 1).mean().item())
        errs["face"].append(d[:, FACE].mean().item())
        errs["all"].append(d.mean().item())
        errs["finger_rel"].append(((hand_relative(x4) - hand_relative(xh4)).norm(dim=-1) * mm).mean().item())
        if m["clip"] in keep:
            recon[m["clip"]] = (xh[0].numpy(), idx[0].tolist())
    model.train()
    return {k: float(np.mean(v)) for k, v in errs.items()}, used, recon


# ---------------------------------------------------------------- 뷰어 내보내기
def export_viewer(run_dir, train_clips, test_clips, recon, down, parts="all", per_split=4):
    chosen = [("test", m) for m in test_clips[:per_split]] + [("train", m) for m in train_clips[:per_split]]
    clips = []
    for sp, m in chosen:
        xh, tokens = recon[m["clip"]]
        clips.append({"name": m["clip"], "split": sp, "a": m["x"][:len(xh)], "b": xh,
                      "tokens": tokens, "active": m["active"]})
    labels = ("원본", "자모표로 바꿨다 되돌린 것" + (" (얼굴은 평균 고정)" if parts != "all" else ""))
    write_viewer(os.path.join(run_dir, "viewer.html"), clips, labels=labels, down=down)


# ---------------------------------------------------------------- 이어 학습
def save_ckpt(path, model, opt, it, rng, elapsed, args):
    """중간 저장. 쓰는 도중 끊겨도 이전 파일이 남도록 임시 파일에 쓴 뒤 바꿔치기한다."""
    tmp = path + ".tmp"
    torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "iter": it,
                "np_rng": rng.bit_generator.state, "torch_rng": torch.get_rng_state(),
                "cuda_rng": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None,
                "elapsed": elapsed, "config": vars(args)}, tmp)
    os.replace(tmp, path)


def load_ckpt(path, model, opt, rng, args):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    diff = [k for k in FIXED_KEYS if ck["config"].get(k) != getattr(args, k)]
    if diff:
        raise SystemExit(f"이어 학습할 수 없습니다. 처음 설정과 다른 값: "
                         + ", ".join(f"{k} {ck['config'].get(k)} → {getattr(args, k)}" for k in diff))
    model.load_state_dict(ck["model"])
    opt.load_state_dict(ck["opt"])
    rng.bit_generator.state = ck["np_rng"]
    torch.set_rng_state(ck["torch_rng"])
    if ck.get("cuda_rng") and torch.cuda.is_available():
        torch.cuda.set_rng_state_all(ck["cuda_rng"])
    return ck["iter"], ck["elapsed"]


# ---------------------------------------------------------------- 실험 기록
EXP_HEADER = """# 자모표(VQ-VAE) 실험 기록

`python -m vq.train` 이 끝날 때마다 한 줄씩 자동으로 붙는다. mm는 정규화를 되돌린 관절 평균 거리.
`parts=body_hand` 는 얼굴을 만들지 않으므로(평균 얼굴 고정) 전체 mm 대신 상체·손 열을 비교한다.
관문(11/7): test 표현자 기준 코드 사용률 50% 이상, 손 mm가 E1 첫 결과보다 뚜렷이 개선.

| 날짜 | run | 커밋 | 데이터 · 분할 | parts | 자모표 | 반복 | 분 | train 상체/손 mm | test 상체/손/얼굴 mm | 코드 사용 (train · test) | ppl | 메모 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
"""


def git_commit():
    try:
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ML_ROOT, capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "."], cwd=ML_ROOT, capture_output=True, text=True).stdout.strip()
        return (h + ("+수정" if dirty else "")) or "?"
    except OSError:
        return "?"


def record_experiment(args, summary):
    path = os.path.join(ML_ROOT, "experiments.md")
    tr, te = summary["train_mm"], summary["test_mm"]
    f1 = lambda v: f"{v:.1f}" if v is not None else "–"
    nb = summary["nb_code"]
    sp = load_split(args.data)
    split_label = f"고정 {sp['mode']}" if sp else args.split
    row = [datetime.date.today().isoformat(), os.path.basename(os.path.normpath(args.run)), git_commit(),
           f"{os.path.basename(os.path.normpath(args.data))} · {split_label}", args.parts, str(nb), str(args.iters),
           str(summary["minutes"]), f"{f1(tr['body'])} / {f1(tr['hand'])}",
           f"{f1(te.get('body'))} / {f1(te.get('hand'))} / {f1(te.get('face'))}" if te else "–",
           f"{summary['codes_used_train']} ({summary['codes_used_train'] / nb:.0%}) · "
           f"{summary['codes_used_test']} ({summary['codes_used_test'] / nb:.0%})",
           f1(summary["ppl_last"]), args.note.replace("|", "/")]
    new = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as fh:
        if new:
            fh.write(EXP_HEADER)
        fh.write("| " + " | ".join(row) + " |\n")
    print(f"실험 기록: {path}")


# ---------------------------------------------------------------- 학습
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--window", type=int, default=64)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--width", type=int, default=256)
    ap.add_argument("--code-dim", type=int, default=256)
    ap.add_argument("--nb-code", type=int, default=512)
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--w-body", type=float, default=1.0)
    ap.add_argument("--w-hand", type=float, default=2.0)
    ap.add_argument("--w-face", type=float, default=0.5)
    ap.add_argument("--lam-vel", type=float, default=0.5)
    ap.add_argument("--lam-hand", type=float, default=1.0)
    ap.add_argument("--commit", type=float, default=0.02)
    ap.add_argument("--beta", type=float, default=0.02, help="Smooth L1 경계 (정규화 단위, 약 7mm)")
    ap.add_argument("--split", choices=["item", "signer"], default="item",
                    help="item: 단어 단위(샘플용), signer: 수행자 단위(정식 데이터)")
    ap.add_argument("--holdout", type=int, default=4, help="item 분할에서 평가용으로 빼 둘 단어 수")
    ap.add_argument("--test-signers", type=int, default=2, help="signer 분할에서 평가용 수행자 수")
    ap.add_argument("--parts", choices=list(PARTS), default="all",
                    help="all: 125점(E2, Ours-HF) · body_hand: 상체+손 55점(E1, Ours-H), 얼굴은 평균으로 고정")
    ap.add_argument("--eval-every", type=int, default=500)
    ap.add_argument("--save-every", type=int, default=0, help="중간 저장 간격 (0이면 --eval-every와 같게)")
    ap.add_argument("--resume", action="store_true", help="runs/<이름>/ckpt.pt 에서 이어 학습")
    ap.add_argument("--threads", type=int, default=0, help="CPU 스레드 수 (0이면 PyTorch 기본값). 노트북이 느려지면 줄인다")
    ap.add_argument("--device", default="auto", help="auto: GPU가 있으면 cuda, 없으면 cpu")
    ap.add_argument("--subset", type=int, default=0, help="수행자마다 이 수만큼만 읽음 (0이면 전부). 노트북 확인용")
    ap.add_argument("--note", default="", help="experiments.md 메모 칸")
    ap.add_argument("--no-record", action="store_true", help="experiments.md 에 남기지 않음 (코드 확인용 짧은 실행)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    save_every = args.save_every or args.eval_every
    if args.threads:
        torch.set_num_threads(args.threads)
    device = torch.device(("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device)

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    os.makedirs(args.run, exist_ok=True)
    json.dump(vars(args), open(os.path.join(args.run, "config.json"), "w"), indent=2)

    metas = load_data(args.data, per_signer=args.subset, seed=args.seed)
    if args.subset:
        print(f"--subset {args.subset}: 수행자마다 {args.subset}클립만 읽음 (코드 확인용)")
    train_clips, test_clips = split(metas, vars(args))
    short = [m for m in train_clips if len(m["x"]) < args.window]
    if short:  # 학습 창보다 짧은 클립은 잘라 낼 구간이 없다 (정식 데이터에 소수 있음)
        train_clips = [m for m in train_clips if len(m["x"]) >= args.window]
        print(f"학습 창 {args.window}프레임보다 짧은 학습 클립 {len(short)}개 제외")
    print(f"학습 클립 {len(train_clips)}개, 평가 클립 {len(test_clips)}개 · 관절 {PARTS[args.parts]}점 ({args.parts})")

    model = MotionVQVAE(FEAT_DIM, args.width, args.code_dim, args.nb_code, depth=args.depth, parts=args.parts)
    # 자모표가 맡지 않는 관절(body_hand의 얼굴)은 학습 데이터의 평균 자세로 채운다
    # (클립을 한데 이어 붙이면 학습 데이터만큼 메모리를 한 번 더 쓰므로 더해 가며 평균)
    total = sum(m["x"].sum(0, dtype=np.float64) for m in train_clips)
    model.rest.copy_(torch.from_numpy((total / sum(len(m["x"]) for m in train_clips)).astype(np.float32)))
    model.to(device)
    down = model.down
    print(f"장치 {device} · 파라미터 {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.99), weight_decay=0.0)
    w = joint_weights(args.w_body, args.w_hand, args.w_face, PARTS[args.parts]).to(device)

    ckpt = os.path.join(args.run, "ckpt.pt")
    start, elapsed = 0, 0.0
    if args.resume:
        if os.path.exists(ckpt):
            start, elapsed = load_ckpt(ckpt, model, opt, rng, args)
            print(f"이어 학습: {start}번째 반복까지 했음 (지난 학습 {elapsed / 60:.1f}분)")
        else:
            print(f"{ckpt} 가 없어 처음부터 학습합니다.")
    log_path = os.path.join(args.run, "log.jsonl")
    if start and os.path.exists(log_path):  # 저장 시점 뒤에 쓰인 줄은 다시 학습하므로 지운다
        keep = [l for l in open(log_path, encoding="utf-8") if json.loads(l)["iter"] <= start]
        open(log_path, "w", encoding="utf-8").writelines(keep)
    log = open(log_path, "a" if start else "w", encoding="utf-8")

    t0 = time.time() - elapsed
    acc = {"pos": 0.0, "vel": 0.0, "hand": 0.0, "commit": 0.0, "ppl": 0.0}
    ppl_last = None
    for it in range(start + 1, args.iters + 1):
        for g in opt.param_groups:
            g["lr"] = args.lr * min(1.0, it / args.warmup)
        x = sample_batch(train_clips, args.batch, args.window, rng).to(device, non_blocking=True)
        xh, commit, ppl, _ = model(x)
        pos, vel, hand = losses(x, xh, w, args.beta)
        loss = pos + args.lam_vel * vel + args.lam_hand * hand + args.commit * commit
        opt.zero_grad()
        loss.backward()
        opt.step()
        for k, v in zip(acc, (pos, vel, hand, commit, ppl)):
            acc[k] += v.item()

        if it % 100 == 0:
            avg = {k: v / 100 for k, v in acc.items()}
            acc = {k: 0.0 for k in acc}
            ppl_last = avg["ppl"]
            print(f"[{it:5d}] pos {avg['pos']:.5f} vel {avg['vel']:.5f} hand {avg['hand']:.5f} "
                  f"commit {avg['commit']:.4f} ppl {avg['ppl']:.1f}  ({time.time() - t0:.0f}s)")
            log.write(json.dumps({"iter": it, **avg}) + "\n")
        if it % args.eval_every == 0 or it == args.iters:
            ev_tr, used_tr, _ = evaluate(model, train_clips, down, device)
            ev_te, used_te, _ = evaluate(model, test_clips, down, device) if test_clips else ({}, set(), {})
            fmt = lambda e: " ".join(f"{k} {v:.1f}" for k, v in e.items())
            print(f"  평가 train(mm): {fmt(ev_tr)} | 코드 {len(used_tr)}/{args.nb_code}")
            if test_clips:
                print(f"  평가 test (mm): {fmt(ev_te)} | 코드 {len(used_te)}/{args.nb_code}")
            log.write(json.dumps({"iter": it, "eval_train": ev_tr, "eval_test": ev_te,
                                  "codes_train": len(used_tr), "codes_test": len(used_te)}) + "\n")
        log.flush()
        if it % save_every == 0 and it < args.iters:
            save_ckpt(ckpt, model, opt, it, rng, time.time() - t0, args)

    torch.save({"model": model.state_dict(), "config": vars(args)}, os.path.join(args.run, "model.pt"))
    show = {m["clip"] for m in train_clips[:4] + test_clips[:4]}  # 뷰어에 넣을 클립 (export_viewer와 같은 선택)
    ev_tr, used_tr, rec_tr = evaluate(model, train_clips, down, device, show)
    ev_te, used_te, rec_te = evaluate(model, test_clips, down, device, show) if test_clips else ({}, set(), {})
    summary = {"parts": args.parts, "train_mm": ev_tr, "test_mm": ev_te, "codes_used_train": len(used_tr),
               "codes_used_test": len(used_te), "nb_code": args.nb_code,
               "usage_train": round(len(used_tr) / args.nb_code, 3), "ppl_last": ppl_last,
               "iters": args.iters, "minutes": round((time.time() - t0) / 60, 1)}
    json.dump(summary, open(os.path.join(args.run, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))
    export_viewer(args.run, train_clips, test_clips, {**rec_tr, **rec_te}, down, args.parts)
    if not args.no_record:
        record_experiment(args, summary)
    if os.path.exists(ckpt):
        os.remove(ckpt)  # 끝까지 학습했으면 model.pt 가 최종본이다


if __name__ == "__main__":
    main()
