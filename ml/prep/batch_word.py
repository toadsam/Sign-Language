"""Download keypoint archives sequentially; delete only after validating every clip.

  python -m prep.batch_word --delete-verified                 # WORD 16개 → C:/aihub/full
  python -m prep.batch_word --type SEN --delete-verified      # SEN 16개 → C:/aihub/full_sen

끊겨도 다시 실행하면 확인까지 끝난 압축 파일은 건너뛴다. 받다 끊긴 zip은 열리지 않으므로 지우고 다시 받는다.
"""
import argparse
import ctypes
from collections import Counter
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile

import numpy as np

from prep.preprocess import CLIP_RE, find_clips


# 종류별 (압축 파일 번호 → AI Hub filekey, 저장 폴더, 기록 폴더)
KINDS = {
    "WORD": {"key": lambda n: 39600 if n == 1 else 39600 + n, "out": "full", "logs": "word_batch"},
    "SEN": {"key": lambda n: 39583 if n == 1 else 39583 + n, "out": "full_sen", "logs": "sen_batch"},
}


def intact(path):
    """끝까지 받아진 zip인지 (중앙 디렉터리를 읽을 수 있는지)."""
    try:
        with zipfile.ZipFile(path) as z:
            return len(z.namelist()) > 0
    except (zipfile.BadZipFile, OSError):
        return False


def clean(work):
    """작업 폴더에서 기록(.log) 말고 모두 지운다: 받다 끊긴 tar, 조각(.partN), 병합 zip."""
    for old in work.iterdir():
        if old.suffix != ".log":
            shutil.rmtree(old) if old.is_dir() else old.unlink()


def validate(archive, output, kind="WORD"):
    clips = find_clips(str(archive), "F", {kind})
    if not clips:
        raise ValueError(f"No front-view {kind} clips")
    metas = []
    for name, _ in clips:
        match = CLIP_RE.match(name)
        clip = f"{match['item']}_{match['signer']}"
        meta = json.loads((output / "npy" / f"{clip}.json").read_text(encoding="utf-8"))
        x = np.load(output / "npy" / f"{clip}.npy", allow_pickle=False)
        if x.shape != (meta["frames"], 125, 3) and x.shape != (meta["frames"], 375):
            raise ValueError(f"Unexpected array shape: {clip}")
        if x.dtype != np.float32 or not np.isfinite(x).all():
            raise ValueError(f"Invalid array: {clip}")
        if not 0.1 < meta["norm"]["scale"] < 1:
            raise ValueError(f"Unexpected shoulder width: {clip}")
        metas.append(meta)
    return {
        "clips": len(metas),
        "signers": dict(Counter(m["signer"] for m in metas)),
        "mm": sum(m["check"].get("src_unit") == "mm" for m in metas),
        "shoulder_m_min_max": [min(m["norm"]["scale"] for m in metas), max(m["norm"]["scale"] for m in metas)],
        "wrist_gap_cm_p50_p95_max": np.percentile([max(m["check"]["wrist_gap_cm"]) for m in metas], [50, 95, 100]).tolist(),
    }


def run_checked(command, cwd, log_path, root, reserve):
    with log_path.open("ab") as log:
        process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
        while process.poll() is None:
            if shutil.disk_usage(root).free < reserve:
                # Stop the entire download process tree, including curl/tar.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
                process.wait()
                raise RuntimeError("Disk reserve reached; batch stopped")
            time.sleep(5)
        if process.returncode:
            raise RuntimeError(f"Command failed ({process.returncode}); see {log_path.name}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path("C:/aihub"))
    ap.add_argument("--bash", type=Path, default=Path("C:/Program Files/Git/bin/bash.exe"))
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--delete-verified", action="store_true")
    ap.add_argument("--type", choices=list(KINDS), default="WORD")
    ap.add_argument("--reserve-gb", type=float, default=20,
                    help="남길 최소 여유 공간. 파일 하나를 받는 동안 tar · 조각 · 병합 zip이 함께 있어 약 45GB까지 쓴다")
    args = ap.parse_args()
    root = args.root.resolve()
    kind, cfg = args.type, KINDS[args.type]
    output = root / cfg["out"]
    logs = root / cfg["logs"]
    logs.mkdir(exist_ok=True)
    ml = Path(__file__).resolve().parents[1]
    reserve = args.reserve_gb * 1024**3
    report = logs / "results.jsonl"
    completed = set()
    if report.exists():
        for line in report.read_text(encoding="utf-8").splitlines():
            previous = json.loads(line)
            if previous.get("status") == "validated":
                completed.add(previous["archive"])
    # Keep Windows awake for this process; the setting ends when it exits.
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
    for number in range(1, 17):
        if number in completed:
            continue
        key = cfg["key"](number)
        work = logs / f"{number:02d}"
        work.mkdir(exist_ok=True)
        record = {"archive": number, "filekey": key}
        try:
            if shutil.disk_usage(root).free < reserve:
                raise RuntimeError("Disk reserve reached; batch stopped")
            name = f"{number:02d}_real_{kind.lower()}_keypoint.zip"
            matches = [m for m in root.glob(f"**/{name}") if intact(m)]
            if not matches:
                if kind == "WORD" and number == 1:
                    continue
                clean(work)  # 지난번에 받다 끊긴 파일 정리
                # Each request has its own directory so partial downloads cannot mix.
                command = [str(args.bash), "-lc", 'export AIHUB_APIKEY=$(cat ~/.aihub_key); bash /c/aihub/aihubshell -mode d -datasetkey 103 -filekey ' + str(key)]
                run_checked(command, work, work / "download.log", root, reserve)
                matches = [m for m in work.glob(f"**/{name}") if intact(m)]
            if len(matches) != 1:
                raise ValueError("Expected exactly one downloaded archive")
            archive = matches[0].resolve()
            archive.relative_to(root)
            run_checked([sys.executable, "-u", "-m", "prep.preprocess", "--src", str(archive), "--out", str(output), "--types", kind, "--workers", str(args.workers)], ml, work / "preprocess.log", root, reserve)
            record.update(validate(archive, output, kind))
            record["status"] = "validated"
            if args.delete_verified:
                archive.unlink()
                if archive.is_relative_to(work):
                    clean(work)  # 남은 download.tar · 조각 파일 (zip 하나당 최대 20GB 넘게 남는다)
                record["deleted"] = True
        except Exception as exc:
            record.update(status="failed", error=str(exc))
        with report.open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(json.dumps(record, ensure_ascii=False), flush=True)
        if "Disk reserve" in record.get("error", ""):
            break


if __name__ == "__main__":
    main()
