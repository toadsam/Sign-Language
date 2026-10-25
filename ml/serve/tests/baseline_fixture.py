"""Self-authored temporary B1 bundles; never imports gen.tests or real datasets."""
import json
from pathlib import Path

import numpy as np


WORDS = {"화장실": ("WORD1", 1), "있다": ("WORD2", 2)}
TRIM_START, TRIM_STOP = 2, 15  # active [6,10], plus four frames on either side


def synthetic_motion(marker: int) -> np.ndarray:
    """Exact binary fractions identify every word/frame/joint/axis independently."""
    return (np.float32(marker * 8)
            + np.arange(20, dtype=np.float32)[:, None, None] / 32
            + np.arange(125, dtype=np.float32)[None, :, None] / 512
            + np.arange(3, dtype=np.float32)[None, None, :] / 4096)


def expected_motion(gloss: list[str]) -> np.ndarray:
    clips = [synthetic_motion(WORDS[word][1])[TRIM_START:TRIM_STOP]
             for word in gloss if word in WORDS]
    return np.concatenate(clips) if clips else np.empty((0, 125, 3), dtype=np.float32)


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def make_baseline_bundle(root: Path) -> Path:
    """Build a formal-policy synthetic WORD bundle with only train exemplars."""
    root = Path(root)
    data, run = root / "data", root / "run"
    (data / "npy").mkdir(parents=True)
    run.mkdir()
    metas = []
    for word, (item, marker) in WORDS.items():
        clip = f"{item}_SYNTH_TRAIN"
        metas.append(dict(clip=clip, item=item, signer="SYNTH_TRAIN", type="WORD",
                          label="ok", dur_ratio=1.0, frames=20, active=[6, 10], gloss=[word]))
        np.save(data / "npy" / f"{clip}.npy", synthetic_motion(marker), allow_pickle=False)
    (data / "meta.jsonl").write_text(
        "".join(json.dumps(meta, ensure_ascii=False) + "\n" for meta in metas), encoding="utf-8")
    write_json(root / "split.json", {"mode": "signer", "signers": {
        "train": ["SYNTH_TRAIN"], "val": ["SYNTH_VAL"], "test": ["SYNTH_TEST"]},
        "exclude": {"clips": []}})
    write_json(run / "vocab_map.json", {"schema_version": 1,
               "mapping": {word: item for word, (item, _) in WORDS.items()},
               "unmapped": [], "ambiguous": {}})
    write_json(run / "generator.json", {"schema_version": 1, "kind": "baseline",
               "vocab_map": "vocab_map.json", "baseline_data": "../data",
               "baseline_split": "../split.json", "data_mode": "formal", "blend": 0})
    return run
