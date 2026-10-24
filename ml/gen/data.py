"""Metadata-only training selection shared by token GPT and coordinate B2.

Formal selection never falls back to all clips. No coordinate arrays are opened
here; callers may load motion only after selecting ``result.train``.
"""
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path


class DataValidationError(ValueError):
    """Stable machine-readable ``code`` plus a short diagnostic."""

    def __init__(self, code, detail):
        self.code = code
        super().__init__(f"{code}: {detail}")


def _fail(code, detail):
    raise DataValidationError(code, detail)


def _unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            _fail("duplicate_key", key)
        out[key] = value
    return out


def _read(path, sources, key, jsonl=False):
    raw = Path(path).read_bytes()
    sources[key] = hashlib.sha256(raw).hexdigest()
    try:
        text = raw.decode("utf-8-sig")
        if jsonl:
            return [json.loads(line, object_pairs_hook=_unique_object)
                    for line in text.splitlines() if line.strip()]
        return json.loads(text, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise DataValidationError("invalid_json", str(path)) from exc


def _index(rows, source):
    out = {}
    if not isinstance(rows, list):
        _fail("invalid_rows", source)
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("clip"), str) or not row["clip"]:
            _fail("invalid_clip", source)
        clip = row["clip"]
        if clip in out:
            _fail("duplicate_clip", f"{source}: {clip}")
        out[clip] = row
    return out


def _strings(values, field, nonempty=False):
    if (not isinstance(values, list) or (nonempty and not values)
            or any(not isinstance(v, str) or not v.strip() for v in values)):
        _fail("invalid_field", field)
    return values


def _positive_int(value, field):
    if type(value) is not int or value <= 0:
        _fail("invalid_integer", field)
    return value


def _validate_clip(clip, token, meta, nb, down):
    if not isinstance(token, dict):
        _fail("invalid_token_record", clip)
    for field in ("item", "signer", "type"):
        if (not isinstance(meta.get(field), str) or not meta[field]
                or token.get(field) != meta[field]):
            _fail("metadata_mismatch", f"{clip}: {field}")
    if "clip" in token and token["clip"] != clip:
        _fail("metadata_mismatch", f"{clip}: clip")
    ts = token.get("tokens")
    if not isinstance(ts, list) or not ts or any(type(t) is not int or not 0 <= t < nb for t in ts):
        _fail("invalid_tokens", clip)
    frames = token.get("frames")
    total = _positive_int(meta.get("frames"), f"{clip}: frames")
    if (not isinstance(frames, list) or len(frames) != 2
            or any(type(f) is not int for f in frames)):
        _fail("invalid_frames", clip)
    start, end = frames
    if not 0 <= start < end <= total or end - start != len(ts) * down:
        _fail("invalid_frames", clip)
    # Same metadata-only interval calculation as gen.tokenize.segment.
    if meta["type"] == "WORD":
        active = meta.get("active")
        if (not isinstance(active, list) or len(active) != 2
                or any(type(f) is not int for f in active)
                or not 0 <= active[0] <= active[1] < total):
            _fail("invalid_active", clip)
        expected_start = max(active[0] - 4, 0)
        expected_end = min(active[1] + 5, total)
    else:
        expected_start, expected_end = 0, total
    expected_end = expected_start + (expected_end - expected_start) // down * down
    if frames != [expected_start, expected_end]:
        _fail("segment_mismatch", clip)


def validate_partitions(partitions, *, signer_disjoint=True):
    """Validate ordinary and holdout buckets, including within-bucket duplicates."""
    clips, signers = {}, {}
    for bucket, rows in partitions.items():
        base = bucket.removeprefix("holdout_")
        for row in rows:
            clip, signer = row["clip"], row["signer"]
            if clip in clips:
                _fail("clip_overlap", f"{clip}: {clips[clip]} / {bucket}")
            clips[clip] = bucket
            if signer_disjoint and signer in signers and signers[signer] != base:
                _fail("signer_overlap", signer)
            signers[signer] = base


def _split_assignments(split, mode):
    if split is None:
        if mode == "formal":
            _fail("split_required", "formal selection requires an explicit split path")
        return None
    if not isinstance(split, dict):
        _fail("invalid_split", "split must be an object")
    if split.get("mode") == "item" and mode == "smoke":
        _strings(split.get("test_items"), "test_items")
        return None
    if split.get("mode") != "signer":
        _fail("split_mode", "formal data requires signer mode")
    groups = split.get("signers")
    if not isinstance(groups, dict) or set(groups) != {"train", "val", "test"}:
        _fail("invalid_split", "train/val/test signer lists required")
    assignments = {}
    for bucket, values in groups.items():
        for signer in _strings(values, f"signers.{bucket}"):
            if signer in assignments:
                _fail("signer_overlap", signer)
            assignments[signer] = bucket
    return assignments


def source_symbols(row):
    return row["gloss"] + [f"<{tag}>" for tag in row.get("nonmanual", [])]


@dataclass
class Selection:
    tokens: dict
    partitions: dict
    classes: dict
    signers: dict
    vocab: dict
    report: dict

    @property
    def train(self):
        return self.partitions["train"]

    def write(self, path):
        """Persist exact clip lists, policy, coverage and source hashes locally."""
        from gen.artifacts import write_json_atomic
        write_json_atomic(path, self.report)
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def select_data(tokens_path, meta_paths, split_path=None, *, kind="WORD",
                mode="formal", sentences_path=None):
    """Return validated partitions and train-only dictionaries.

    ``meta_paths`` is a path (one type) or a mapping such as
    ``{"word": word_meta_path, "sen": sen_meta_path}``. A combined token file
    may be paired with just the metadata of the requested type. Holdout buckets
    are named ``holdout_train``, ``holdout_val`` and ``holdout_test``.
    Smoke mode permits missing label/duration fields and an absent split, and is
    always recorded as smoke. Present invalid quality fields are still rejected.
    """
    if mode not in ("formal", "smoke") or kind not in ("WORD", "SEN"):
        _fail("invalid_mode", "expected formal/smoke and WORD/SEN")
    sources = {}
    tk = _read(tokens_path, sources, "tokens_sha256")
    if not isinstance(tk, dict):
        _fail("invalid_tokens", "token header must be an object")
    nb = _positive_int(tk.get("nb_code"), "nb_code")
    down = _positive_int(tk.get("down"), "down")
    if not isinstance(tk.get("clips"), dict):
        _fail("invalid_tokens", "clips must be an object")
    if not isinstance(meta_paths, dict):
        meta_paths = {kind.lower(): meta_paths}
    meta_sources, metas = {}, {}
    for name, path in meta_paths.items():
        if name not in ("word", "sen"):
            _fail("invalid_meta_type", str(name))
        rows = _read(path, meta_sources, name, jsonl=True)
        indexed = _index(rows, f"{name} metadata")
        for clip, row in indexed.items():
            if row.get("type") != name.upper():
                _fail("metadata_mismatch", f"{clip}: type")
            if clip in metas:
                _fail("duplicate_clip", clip)
            metas[clip] = row
    # Only metadata of the requested type is used by this selection.
    sources["meta_sha256"] = {kind.lower(): meta_sources[kind.lower()]} if kind.lower() in meta_sources else {}
    selected_metas = {c: m for c, m in metas.items() if m["type"] == kind}
    target_tokens = {}
    for clip, token in tk["clips"].items():
        if not isinstance(token, dict) or token.get("type") not in ("WORD", "SEN"):
            _fail("invalid_token_record", clip)
        if token["type"] == kind:
            target_tokens[clip] = token
    if set(selected_metas) != set(target_tokens):
        _fail("clip_set_mismatch", "requested-type token and metadata clip sets differ")
    split = _read(split_path, sources, "split_sha256") if split_path is not None else None
    sources.setdefault("split_sha256", None)
    assignments = _split_assignments(split, mode)
    excluded = set(_strings((split or {}).get("exclude", {}).get("clips", []), "exclude.clips"))
    holdout = (split or {}).get("heldout_sentences", {})
    if (not isinstance(holdout, dict) or (mode == "formal" and kind == "SEN"
            and not {"sequences", "items", "question_items"} <= holdout.keys())):
        _fail("holdout_required", "formal SEN requires sequences/items/question_items in split")
    if not isinstance(holdout.get("sequences", []), list):
        _fail("invalid_field", "heldout sequences")
    sequences = set()
    for sequence in holdout.get("sequences", []):
        sequences.add(tuple(_strings(sequence, "heldout sequence", nonempty=True)))
    items = set(_strings(holdout.get("items", []), "heldout items"))
    questions = set(_strings(holdout.get("question_items", []), "heldout question_items"))
    sentences = {}
    sources["sentences_sha256"] = None
    if kind == "SEN":
        if sentences_path is None:
            _fail("sentences_required", "SEN selection requires sentences.jsonl")
        sentences = _index(_read(sentences_path, sources, "sentences_sha256", jsonl=True), "sentences")
    partitions = {k: [] for k in ("train", "val", "test", "holdout_train", "holdout_val", "holdout_test")}
    rejected, counts = {}, Counter()
    relaxed = Counter()
    for clip in sorted(target_tokens):
        token, meta = target_tokens[clip], selected_metas[clip]
        _validate_clip(clip, token, meta, nb, down)
        row = {**meta, **token, "clip": clip, "total_frames": meta["frames"]}
        reasons = []
        if clip in excluded:
            reasons.append("quality_excluded")
        for field in ("label", "dur_ratio"):
            if field not in meta:
                if mode == "smoke":
                    relaxed[field] += 1
                else:
                    reasons.append(f"missing_{field}")
        if "label" in meta and meta["label"] != "ok":
            reasons.append("invalid_label")
        ratio = meta.get("dur_ratio")
        if "dur_ratio" in meta and (type(ratio) not in (int, float)
                or not math.isfinite(ratio) or not 0.85 <= ratio < 1.5):
            reasons.append("invalid_dur_ratio")
        if split is None:
            bucket = "train"
        elif split["mode"] == "item":
            bucket = "test" if row["item"] in split["test_items"] else "train"
        else:
            bucket = assignments.get(row["signer"])
        if bucket is None:
            reasons.append("unknown_signer")
        if reasons:
            rejected[clip] = reasons
            counts.update(reasons)
            continue
        if kind == "SEN":
            sentence = sentences.get(clip)
            if sentence is None:
                _fail("sentence_missing", clip)
            _strings(meta.get("gloss"), f"{clip}: gloss", nonempty=True)
            if sentence.get("gloss") != meta["gloss"]:
                _fail("sentence_mismatch", f"{clip}: gloss")
            for field in ("item", "signer", "type"):
                if field in sentence and sentence[field] != row[field]:
                    _fail("sentence_mismatch", f"{clip}: {field}")
            tags = _strings(sentence.get("nonmanual", []), f"{clip}: nonmanual")
            if "nonmanual" in meta and meta["nonmanual"] != tags:
                _fail("sentence_mismatch", f"{clip}: nonmanual")
            row["nonmanual"] = tags
            if tuple(row["gloss"]) in sequences or row["item"] in items or row["item"] in questions:
                bucket = f"holdout_{bucket}"
        partitions[bucket].append(row)
    validate_partitions(partitions, signer_disjoint=bool(split and split["mode"] == "signer"))
    train = partitions["train"]
    if not train:
        _fail("empty_train", "no eligible training clips")
    classes = {v: i for i, v in enumerate(sorted({r["item"] for r in train}))}
    signers = {v: i for i, v in enumerate(sorted({r["signer"] for r in train}))}
    vocab = {"<pad>": 0}
    if kind == "SEN":
        symbols = {s for r in train for s in source_symbols(r)}
        if "<pad>" in symbols or any(g.startswith("<") and g.endswith(">") for r in train for g in r["gloss"]):
            _fail("reserved_symbol", "gloss must not collide with padding or nonmanual symbols")
        vocab.update({s: i for i, s in enumerate(sorted(symbols), 1)})
    coverage = {}
    for bucket, rows in partitions.items():
        oov_items = Counter(r["item"] for r in rows if r["item"] not in classes)
        oov_gloss, oov_tags = Counter(), Counter()
        covered = 0
        for r in rows:
            missing_gloss = [g for g in r.get("gloss", []) if kind == "SEN" and g not in vocab]
            missing_tags = [t for t in r.get("nonmanual", []) if f"<{t}>" not in vocab]
            oov_gloss.update(missing_gloss)
            oov_tags.update(missing_tags)
            covered += int(not missing_gloss and not missing_tags and (kind == "SEN" or r["item"] in classes))
        coverage[bucket] = {"clips": len(rows), "covered_clips": covered,
                            "oov_items": dict(oov_items), "oov_gloss": dict(oov_gloss), "oov_tags": dict(oov_tags),
                            "untrained_signers": sorted({r["signer"] for r in rows} - signers.keys())}
    report = {"schema_version": 1, "data_mode": mode, "kind": kind,
              "policy": {"label": "ok", "dur_ratio": "finite: 0.85 <= x < 1.5", "segment_pad": 4,
                         "holdout": ["sequences", "items", "question_items"], "dictionary_source": "train",
                         "smoke_missing_fields": dict(relaxed)},
              "sources": sources, "counts": {k: len(v) for k, v in partitions.items()},
              "clips": {k: [r["clip"] for r in v] for k, v in partitions.items()},
              "excluded_clips": rejected, "exclusion_counts": dict(counts),
              "excluded_total": len(rejected), "coverage": coverage,
              "classes": classes, "signers": signers, "vocab": vocab,
              "generation_signer": next(iter(signers))}
    return Selection(tk, partitions, classes, signers, vocab, report)
