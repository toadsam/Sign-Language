"""Public baseline / word GPT / coordinate regressor Generator adapter.

Nonmanual tags are accepted but do not condition baseline or word models. Coordinates
retain the source normalization (neck origin, shoulder width 1, y down).
"""
from collections import Counter
from pathlib import Path

import numpy as np

from gen.baselines import trimmed
from gen.vocab import read_json, select_train


class Generator:
    def __init__(self, run_dir: str, device: str = "cpu"):
        self.run_dir = Path(run_dir).resolve()
        self.device = device  # Baseline uses NumPy on CPU.
        config = read_json(self.run_dir / "generator.json")
        if not isinstance(config, dict):
            raise ValueError("generator config must be a JSON object")
        if type(config.get("schema_version")) is not int or config["schema_version"] != 1:
            raise ValueError("unsupported generator schema_version")
        self.kind = config.get("kind")
        if self.kind not in ("baseline", "word_gpt", "word_regress"):
            raise ValueError("unsupported Generator kind; sentence adapter is not implemented")
        self.supported_nonmanual = ()

        def path(key):
            value = config.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{self.kind} requires {key}")
            return (self.run_dir / value).resolve()

        # Resolve all required paths before opening any model/data files.
        vocab_path = path("vocab_map")
        if self.kind == "baseline":
            data_path, split_path = path("baseline_data"), path("baseline_split")
        vocab = read_json(vocab_path)
        if not isinstance(vocab, dict):
            raise ValueError("vocab must be a JSON object")
        if type(vocab.get("schema_version")) is not int or vocab["schema_version"] != 1:
            raise ValueError("unsupported vocab schema_version")
        mapping, unmapped, ambiguous = (vocab.get(k) for k in ("mapping", "unmapped", "ambiguous"))
        if not isinstance(mapping, dict) or not isinstance(unmapped, list) or not isinstance(ambiguous, dict):
            raise ValueError("vocab requires mapping, unmapped, ambiguous")
        if any(not isinstance(k, str) or not k.strip() or not isinstance(v, str) or not v.startswith("WORD")
               for k, v in mapping.items()):
            raise ValueError("mapping must contain nonempty gloss -> WORD ID entries")
        if any(not isinstance(k, str) for k in unmapped) or set(mapping).intersection(unmapped) or set(mapping).intersection(ambiguous):
            raise ValueError("mapped and unresolved gloss entries must be disjoint")
        self.mapping = dict(mapping)
        self.blend = config.get("blend", 8 if self.kind == "baseline" else 0)
        if type(self.blend) is not int or not 0 <= self.blend <= 300:
            raise ValueError("blend must be an integer in [0, 300]")
        if self.kind != "baseline":
            # Keep baseline and its tests usable without importing Torch.
            from gen.infer_models import WordModelAdapter
            self._adapter = WordModelAdapter(config, path, self.mapping, device, self.blend)
            self.device = str(self._adapter.device)
            self.connection_policy = self._adapter.connection_policy
            return
        metas, self.selection_report = select_train(data_path, split_path,
                                                    data_mode=config.get("data_mode", "formal"))
        self.clips, self.selected_clips = {}, {}
        rejected = Counter()
        for meta in metas:
            item = meta["item"]
            if item not in mapping.values() or item in self.clips:
                continue
            active, frames = meta.get("active"), meta.get("frames")
            if (type(frames) is not int or frames <= 0 or not isinstance(active, list) or len(active) != 2
                    or any(type(v) is not int for v in active)
                    or not 0 <= active[0] <= active[1] < frames):
                rejected["empty_or_invalid_active"] += 1
                continue
            # Only one eligible exemplar per mapped item is retained in memory.
            coord_path = data_path / "npy" / f"{meta['clip']}.npy"
            if coord_path.resolve().parent != (data_path / "npy").resolve():
                raise ValueError("clip name must not escape the npy directory")
            x = np.load(coord_path, allow_pickle=False)
            if x.shape not in ((frames, 125, 3), (frames, 375)) or x.dtype.kind != "f":
                raise ValueError("baseline coordinates must be floating [T,125,3] or [T,375]")
            with np.errstate(over="ignore", invalid="ignore"):
                x = np.asarray(x, dtype=np.float32).reshape(frames, 375)
            if not np.isfinite(x).all():
                raise ValueError("baseline coordinates contain nonfinite float32 values")
            x.setflags(write=False)
            self.clips[item] = {"x": x, "active": active}
            self.selected_clips[item] = meta["clip"]
        self.selection_report.update(rejected)
        self.selection_report["exemplars"] = len(self.clips)
        self.selection_report["unavailable_mapped_items"] = sorted(set(mapping.values()) - self.clips.keys())

    def generate(self, gloss: list[str], nonmanual: list[str] = (), seed: int | None = None) -> dict:
        if not isinstance(gloss, (list, tuple)) or not gloss:
            raise ValueError("gloss must be a nonempty list of nonempty strings")
        if any(not isinstance(word, str) or not word.strip() for word in gloss):
            raise ValueError("gloss must contain nonempty strings")
        if not isinstance(nonmanual, (list, tuple)) or any(not isinstance(tag, str) for tag in nonmanual):
            raise ValueError("nonmanual must be a sequence of strings")
        if seed is not None and type(seed) is not int:
            raise ValueError("seed must be an integer or None")
        if self.kind != "baseline":
            return self._adapter.generate(gloss, seed)
        clips, unknown = [], []
        for word in gloss:
            item = self.mapping.get(word)
            if item in self.clips:
                clips.append(self.clips[item])
            else:
                unknown.append(word)
        motion = (np.asarray(trimmed(clips, blend=self.blend), dtype=np.float32).reshape(-1, 125, 3)
                  if clips else np.empty((0, 125, 3), dtype=np.float32))
        if not np.isfinite(motion).all():
            raise ValueError("baseline output contains nonfinite values")
        return {"fps": 30, "motion": motion, "tokens": [], "unknown": unknown, "source": "baseline"}
