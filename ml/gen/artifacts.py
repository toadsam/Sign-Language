"""Provenance manifests for generation artifacts (no Torch dependency).

Validation errors expose ``code`` and ``field`` for B's model loader. This module
compares supplied facts; the caller must obtain decoder dimensions/version from
the actual loaded checkpoint, rather than trusting its directory name.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


class ArtifactValidationError(ValueError):
    def __init__(self, code, field):
        self.code, self.field = code, field
        super().__init__(f"{code}: {field}")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path, value):
    """Write a new run record; refuse to overwrite an existing record."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
    # A hard link publishes the completed file atomically without replacing an
    # existing run's record. Both paths are on the same filesystem.
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        os.unlink(temporary)


def code_revision():
    root = Path(__file__).resolve().parents[2]
    command = ["git", "-c", f"safe.directory={root.as_posix()}", "-C", str(root)]
    try:
        commit = subprocess.check_output(command + ["rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
        dirty = bool(subprocess.check_output(command + ["status", "--porcelain", "--untracked-files=normal"],
                                             text=True, stderr=subprocess.DEVNULL).strip())
    except (OSError, subprocess.CalledProcessError):
        raise ArtifactValidationError("code_revision_unavailable", "code_commit") from None
    return commit, dirty


def validate_artifact_manifest(manifest, *, expected=None, files=None, allow_smoke=False):
    """Validate schema and optional expected values / actual file SHA-256s.

    ``files`` maps manifest hash fields to paths; ``meta_sha256`` maps word/sen
    to paths. ``expected`` can contain decoder version, nb_code, down, parts,
    hashes, etc. Returns the manifest unchanged. Never silently accepts legacy
    checkpoints: absent manifests fail even when allow_smoke=True.
    """
    if not isinstance(manifest, dict):
        raise ArtifactValidationError("manifest_missing", "artifact_manifest")
    required = {"schema_version", "data_mode", "vq_version", "vq_sha256", "tokens_sha256",
                "split_sha256", "meta_sha256", "sentences_sha256", "nb_code", "down", "parts",
                "selection_sha256", "code_commit", "code_dirty"}
    for field in sorted(required - manifest.keys()):
        raise ArtifactValidationError("missing_field", field)
    if type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1:
        raise ArtifactValidationError("unsupported_schema", "schema_version")
    if manifest["data_mode"] not in ("formal", "smoke"):
        raise ArtifactValidationError("invalid_value", "data_mode")
    smoke = manifest["data_mode"] == "smoke"
    if smoke and not allow_smoke:
        raise ArtifactValidationError("smoke_not_allowed", "data_mode")
    for field in ("nb_code", "down"):
        if type(manifest[field]) is not int or manifest[field] <= 0:
            raise ArtifactValidationError("invalid_value", field)
    if manifest["parts"] not in ("body_hand", "all") and not (smoke and manifest["parts"] is None):
        raise ArtifactValidationError("invalid_value", "parts")
    if type(manifest["code_dirty"]) is not bool:
        raise ArtifactValidationError("invalid_value", "code_dirty")
    for field in ("vq_version", "code_commit"):
        if not isinstance(manifest[field], str) or not manifest[field].strip():
            raise ArtifactValidationError("invalid_value", field)

    def check_hash(value, field, optional=False):
        if value is None and optional:
            return
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise ArtifactValidationError("invalid_hash", field)

    for field in ("vq_sha256", "tokens_sha256", "split_sha256", "selection_sha256", "sentences_sha256"):
        check_hash(manifest[field], field, optional=(field == "sentences_sha256" or
                   (smoke and field in ("vq_sha256", "split_sha256"))))
    meta = manifest["meta_sha256"]
    if not isinstance(meta, dict) or (not smoke and not meta) or set(meta) - {"word", "sen"}:
        raise ArtifactValidationError("invalid_value", "meta_sha256")
    for kind, digest in meta.items():
        check_hash(digest, f"meta_sha256.{kind}")
    if "sen" in meta and manifest["sentences_sha256"] is None:
        raise ArtifactValidationError("missing_field", "sentences_sha256")
    for field, value in (expected or {}).items():
        if field not in manifest or manifest[field] != value:
            raise ArtifactValidationError("manifest_mismatch", field)
    for field, path in (files or {}).items():
        if field == "meta_sha256":
            if set(path) != set(meta):
                raise ArtifactValidationError("manifest_mismatch", field)
            for kind, meta_path in path.items():
                if sha256_file(meta_path) != meta[kind]:
                    raise ArtifactValidationError("hash_mismatch", f"meta_sha256.{kind}")
        elif field not in manifest or sha256_file(path) != manifest[field]:
            raise ArtifactValidationError("hash_mismatch", field)
    return manifest


def create_artifact_manifest(selection, selection_path, *, vq_path=None,
                             vq_version=None, parts=None, code_commit=None, code_dirty=None):
    """Build from a Selection and its persisted selection.json, hashing the
    explicitly supplied decoder file. No use is made of the token ``vq`` hint.
    Decoder configuration compatibility must be checked by the training caller.
    """
    saved = json.loads(Path(selection_path).read_text(encoding="utf-8"))
    if saved != selection.report:
        raise ArtifactValidationError("selection_mismatch", "selection_sha256")
    if code_commit is None or code_dirty is None:
        code_commit, code_dirty = code_revision()
    manifest = {"schema_version": 1, "data_mode": selection.report["data_mode"],
                **selection.report["sources"], "vq_version": vq_version or "smoke-unverified",
                "vq_sha256": sha256_file(vq_path) if vq_path is not None else None,
                "parts": parts, "nb_code": selection.tokens["nb_code"], "down": selection.tokens["down"],
                "selection_sha256": sha256_file(selection_path), "code_commit": code_commit, "code_dirty": code_dirty}
    if selection.report["data_mode"] == "formal" and not vq_version:
        raise ArtifactValidationError("missing_field", "vq_version")
    return validate_artifact_manifest(manifest, allow_smoke=True)


def prepare_run(selection, run_dir, *, vq_path=None, vq_version=None):
    """Record A1 selection and manifest for both word and sentence entrypoints.

    When a decoder is provided, load it on CPU and compare the real dimensions
    with the token header. Formal runs require this decoder and a version label.
    """
    formal = selection.report["data_mode"] == "formal"
    if formal and (vq_path is None or not vq_version):
        raise ArtifactValidationError("decoder_required", "vq_checkpoint/vq_version")
    parts = None
    if vq_path is not None:
        from vq.model import load_vqvae
        model, config = load_vqvae(vq_path)
        for field, actual in (("nb_code", config["nb_code"]), ("down", model.down)):
            if actual != selection.tokens[field]:
                raise ArtifactValidationError("decoder_mismatch", field)
        token_version = selection.tokens.get("vq_version")
        if token_version is not None and token_version != vq_version:
            raise ArtifactValidationError("decoder_mismatch", "vq_version")
        parts = model.parts
    run_dir = Path(run_dir)
    # Existing outputs are never reused as a different run.
    if run_dir.exists() and any(run_dir.iterdir()):
        raise ArtifactValidationError("run_not_empty", "run_dir")
    selection_path = run_dir / "selection.json"
    selection.write(selection_path)
    manifest = create_artifact_manifest(selection, selection_path, vq_path=vq_path,
                                        vq_version=vq_version, parts=parts)
    write_json_atomic(run_dir / "artifact_manifest.json", manifest)
    return manifest
