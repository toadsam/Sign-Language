"""Download WORD archives sequentially; delete only after validating every clip."""
import argparse
import ctypes
from collections import Counter
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

import numpy as np

from prep.preprocess import CLIP_RE, find_clips


def validate(archive, output):
    clips = find_clips(str(archive), "F", {"WORD"})
    if not clips:
        raise ValueError("No front-view WORD clips")
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
    args = ap.parse_args()
    root = args.root.resolve()
    output = root / "full"
    logs = root / "word_batch"
    logs.mkdir(exist_ok=True)
    ml = Path(__file__).resolve().parents[1]
    reserve = 40 * 1024**3
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
        key = 39600 if number == 1 else 39600 + number
        work = logs / f"{number:02d}"
        work.mkdir(exist_ok=True)
        record = {"archive": number, "filekey": key}
        try:
            if shutil.disk_usage(root).free < reserve:
                raise RuntimeError("Disk reserve reached; batch stopped")
            matches = list(root.glob(f"**/{number:02d}_real_word_keypoint.zip"))
            if not matches:
                if number == 1:
                    continue
                # Each request has its own directory so partial downloads cannot mix.
                command = [str(args.bash), "-lc", 'export AIHUB_APIKEY=$(cat ~/.aihub_key); bash /c/aihub/aihubshell -mode d -datasetkey 103 -filekey ' + str(key)]
                run_checked(command, work, work / "download.log", root, reserve)
                matches = list(work.glob(f"**/{number:02d}_real_word_keypoint.zip"))
            if len(matches) != 1:
                raise ValueError("Expected exactly one downloaded archive")
            archive = matches[0].resolve()
            archive.relative_to(root)
            run_checked([sys.executable, "-u", "-m", "prep.preprocess", "--src", str(archive), "--out", str(output), "--types", "WORD", "--workers", str(args.workers)], ml, work / "preprocess.log", root, reserve)
            record.update(validate(archive, output))
            record["status"] = "validated"
            if args.delete_verified:
                archive.unlink()
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
