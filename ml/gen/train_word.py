"""단어 단위 생성 모델 학습.

  코드 확인: python -m gen.train_word --model gpt --tokens data/sample/tokens.json --data data/sample --data-mode smoke --run runs/gen_gpt_smoke
  정식 학습은 --split, --vq-checkpoint, --vq-version을 명시한다.

두 모델은 같은 크기의 Transformer이고 같은 데이터(움직임 구간)로 학습한다. 다른 점은 출력뿐이다:
토큰을 하나씩 고르느냐(gpt), 좌표를 바로 맞추느냐(regress).
"""
import argparse
import json
import os

import numpy as np
from gen.data import DataValidationError, select_data


def load_setup(tokens_path, data_dir, *, split_path=None, mode="formal",
               meta_path=None, include_motion=False, return_selection=False):
    """Same four-value return as before, with validated train-only clips.

    Formal callers must supply split_path. GPT leaves include_motion=False;
    include_motion=True retains the A1 eager helper for small callers only.
    The A2 B2 entrypoint leaves it False and uses training.MotionSegments per batch.
    return_selection=True appends the Selection as a fifth return value.
    """
    selection = select_data(tokens_path, meta_path or os.path.join(data_dir, "meta.jsonl"),
                            split_path, kind="WORD", mode=mode)
    clips = [dict(c) for c in selection.train]
    if include_motion:
        for c in clips:
            motion = np.load(os.path.join(data_dir, "npy", f"{c['clip']}.npy"), allow_pickle=False)
            if motion.ndim not in (2, 3) or motion.shape[1:] not in ((375,), (125, 3)):
                raise DataValidationError("invalid_motion_shape", c["clip"])
            s, e = c["frames"]
            if len(motion) != c["total_frames"] or not np.isfinite(motion).all():
                raise DataValidationError("invalid_motion", c["clip"])
            c["motion"] = motion.reshape(-1, 375)[s:e]
    result = (selection.tokens, clips, selection.classes, selection.signers)
    return (*result, selection) if return_selection else result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["gpt", "regress"], required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", help="formal: explicit fixed signer split JSON")
    ap.add_argument("--data-mode", choices=["formal", "smoke"], default="formal")
    ap.add_argument("--vq-checkpoint", help="explicit decoder model.pt; required for formal runs")
    ap.add_argument("--vq-version", help="declared decoder version; required for formal runs")
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--corrupt", type=float, default=0.3, help="gpt: 입력 토큰을 무작위로 바꾸는 최대 비율")
    ap.add_argument("--length", type=int, default=64, help="regress: 출력 프레임 수")
    ap.add_argument("--seed", type=int, default=0)
    add_training_arguments(ap)
    args = ap.parse_args()

    from gen.training import config_from_args, train
    _, _, _, _, selection = load_setup(
        args.tokens, args.data, split_path=args.split, mode=args.data_mode,
        return_selection=True)
    result = train(selection, args.run, kind=args.model, config=config_from_args(args),
                   data_dir=args.data, vq_path=args.vq_checkpoint, vq_version=args.vq_version,
                   resume=args.resume, stop_after=args.stop_after, tokens_path=args.tokens)
    print(json.dumps(result, ensure_ascii=False))


def load_generator(path, device="cpu"):
    """Compatible word loader: (eval model, checkpoint), CPU by default."""
    from gen.training import load_trained_model, TrainingError
    model, checkpoint = load_trained_model(path, device)
    if checkpoint["kind"] not in ("gpt", "regress"):
        raise TrainingError("word_checkpoint_required", "kind")
    return model, checkpoint


def add_training_arguments(parser):
    """Keep CLI help and metadata helpers importable without Torch installed."""
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--eval-every", type=int, default=100)
    parser.add_argument("--save-every", type=int, default=100)
    parser.add_argument("--max-src", type=int, default=64)
    parser.add_argument("--max-len", type=int, default=None)
    parser.add_argument("--generation-signer", default=None)
    parser.add_argument("--resume", action="store_true", help="resume run/latest.pt with unchanged total --iters")
    parser.add_argument("--stop-after", type=int, default=None, help="smoke interruption: absolute stop step")


if __name__ == "__main__":
    main()
