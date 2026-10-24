"""문장 단위 받아쓰기 모델 학습: 형태소(글로스) 열 → 자모 토큰 열.

정식 데이터 (문장 라벨이 있을 때):
  python -m gen.train_sentence --tokens <tokens.json> --data <SEN-dir> --sentences <sentences.jsonl> --split <split.json> --vq-checkpoint <model.pt> --vq-version v0.3-e5 --run <new-run>
  sentences.jsonl 한 줄 = {"clip": "SEN0001_REAL01", "gloss": ["화장실", "있다"], "nonmanual": ["의문"]}

코드 확인용 (문장 데이터가 없을 때, 단어 토큰을 이어 가짜 문장을 만든다):
  python -m gen.train_sentence --tokens data/sample/tokens.json --synthetic --run runs/gen_sent_smoke --iters 300

가짜 문장은 단어 사이 전환이 실제 수어와 달라서 품질 평가에는 쓰면 안 된다.
"""
import argparse
import json
import os

import numpy as np
from gen.data import (DataValidationError, Selection, _positive_int, _read,
                      select_data, source_symbols)


def build_pairs(tokens_path, sentences_path, synthetic, rng, n_synth=400, *,
                data_dir=None, meta_path=None, split_path=None, mode=None,
                return_selection=False):
    """Preserve the three-value return; formal SEN needs metadata and a split.

    --synthetic is a separate smoke path, never evidence of sentence quality.
    return_selection=True appends the Selection for local run provenance.
    """
    mode = mode or ("smoke" if synthetic else "formal")
    if synthetic:
        if mode != "smoke":
            raise DataValidationError("synthetic_mode", "synthetic data requires smoke mode")
        sources = {}
        tk = _read(tokens_path, sources, "tokens_sha256")
        nb = _positive_int(tk.get("nb_code"), "nb_code")
        _positive_int(tk.get("down"), "down")
        words = [(v["item"], v["tokens"]) for v in tk["clips"].values() if v["type"] == "WORD"]
        if len(words) < 2 or n_synth <= 0:
            raise DataValidationError("synthetic_input", "need at least two WORD clips and positive n_synth")
        if any(not t or any(type(i) is not int or not 0 <= i < nb for i in t) for _, t in words):
            raise DataValidationError("invalid_tokens", "synthetic WORD tokens")
        pairs = []
        for i in range(n_synth):
            count = int(rng.integers(2, min(3, len(words)) + 1))
            pick = [words[j] for j in rng.choice(len(words), size=count, replace=False)]
            pairs.append({"clip": f"SYN{i:06d}", "gloss": [w for w, _ in pick], "nonmanual": [], "signer": "SYN",
                          "tokens": sum((t for _, t in pick), [])})
        vocab = {"<pad>": 0}
        vocab.update({g: i for i, g in enumerate(sorted({g for p in pairs for g in p["gloss"]}), 1)})
        partitions = {k: [] for k in ("train", "val", "test", "holdout_train", "holdout_val", "holdout_test")}
        partitions["train"] = pairs
        report = {"schema_version": 1, "data_mode": "smoke", "kind": "synthetic",
                  "policy": {"synthetic": True, "quality_evaluation": False},
                  "sources": {**sources, "split_sha256": None, "meta_sha256": {}, "sentences_sha256": None},
                  "counts": {k: len(v) for k, v in partitions.items()},
                  "clips": {k: [p["clip"] for p in v] for k, v in partitions.items()},
                  "source_word_clips": sorted(c for c, v in tk["clips"].items() if v["type"] == "WORD"),
                  "vocab": vocab, "signers": {"SYN": 0}, "generation_signer": "SYN"}
        selection = Selection(tk, partitions, {}, {"SYN": 0}, vocab, report)
    else:
        if meta_path is None and data_dir is None:
            raise DataValidationError("metadata_required", "provide data_dir or meta_path")
        selection = select_data(tokens_path, meta_path or os.path.join(data_dir, "meta.jsonl"),
                                split_path, kind="SEN", mode=mode, sentences_path=sentences_path)
    result = (selection.tokens["nb_code"], selection.train, selection.vocab)
    return (*result, selection) if return_selection else result


def encode_src(p, vocab, max_src):
    symbols = source_symbols(p)
    unknown = [s for s in symbols if s not in vocab or vocab[s] == 0]
    if unknown:
        raise DataValidationError("source_oov", ", ".join(unknown))
    if len(symbols) > max_src:
        raise DataValidationError("source_too_long", f"{len(symbols)} > {max_src}")
    return [vocab[s] for s in symbols]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--sentences", default=None)
    ap.add_argument("--data", help="SEN metadata directory; required unless --synthetic")
    ap.add_argument("--split", help="formal: explicit fixed signer split JSON")
    ap.add_argument("--data-mode", choices=["formal", "smoke"], default=None)
    ap.add_argument("--vq-checkpoint", help="explicit decoder model.pt; required for formal runs")
    ap.add_argument("--vq-version", help="declared decoder version; required for formal runs")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--run", required=True)
    ap.add_argument("--iters", type=int, default=20000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--corrupt", type=float, default=0.3)
    ap.add_argument("--seed", type=int, default=0)
    from gen.train_word import add_training_arguments
    add_training_arguments(ap)
    args = ap.parse_args()
    if not args.synthetic and not args.sentences:
        raise SystemExit("--sentences 파일이 필요합니다. 문장 데이터가 없으면 --synthetic 으로 코드만 확인하세요.")

    from gen.training import config_from_args, train
    _, _, _, selection = build_pairs(
        args.tokens, args.sentences, args.synthetic, np.random.default_rng(args.seed),
        data_dir=args.data, split_path=args.split, mode=args.data_mode, return_selection=True)
    result = train(selection, args.run, kind="sentence", config=config_from_args(args),
                   vq_path=args.vq_checkpoint, vq_version=args.vq_version,
                   resume=args.resume, stop_after=args.stop_after, tokens_path=args.tokens)
    print(json.dumps(result, ensure_ascii=False))


def load_sentence_generator(path, device="cpu"):
    """Return (SentenceToMotion.eval(), checkpoint), CPU by default."""
    from gen.training import load_trained_model, TrainingError
    model, checkpoint = load_trained_model(path, device)
    if checkpoint["kind"] != "sentence":
        raise TrainingError("sentence_checkpoint_required", "kind")
    return model, checkpoint


if __name__ == "__main__":
    main()
