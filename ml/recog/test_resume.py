"""실제 학습 중단·재개가 연속 학습과 같은 가중치·학습률·로그를 만드는지 검증한다."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import torch


class ResumeTest(unittest.TestCase):
    def test_interrupted_training_matches_continuous_and_preserves_completed_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "data"
            (data / "npy").mkdir(parents=True)
            rows = []
            rng = np.random.default_rng(15)
            for signer in "ABC":
                for item in ("WORD0001", "WORD0002"):
                    clip = f"{item}_{signer}"
                    np.save(data / "npy" / f"{clip}.npy", rng.normal(size=(12, 125, 3)).astype("float32"))
                    rows.append({"clip": clip, "item": item, "signer": signer, "type": "WORD",
                                 "active": [0, 11], "label": "ok", "dur_ratio": 1.0})
            (data / "meta.jsonl").write_text("".join(json.dumps(m)+"\n" for m in rows))
            cwd = Path(__file__).resolve().parents[1]
            env = {**os.environ, "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}

            def arguments(run):
                return ["--data", str(data), "--run", str(run), "--test-signers", "1",
                        "--iters", "6", "--batch", "2", "--length", "16",
                        "--eval-every", "2", "--save-every", "2", "--seed", "17"]

            def execute(args, script=None):
                cmd = [sys.executable, "-c", script] if script else [sys.executable, "-m", "recog.train", *args]
                return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)

            continuous, interrupted = root / "continuous", root / "interrupted"
            result = execute(arguments(continuous))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            script = f"""
import sys
from recog import train
original_save = train.atomic_save
def interrupt(value, path):
    original_save(value, path)
    if str(path).endswith('latest.pt') and value['iter'] == 2:
        raise SystemExit(75)
train.atomic_save = interrupt
sys.argv = ['recog.train', *{arguments(interrupted)!r}]
train.main()
"""
            result = execute([], script)
            self.assertEqual(result.returncode, 75, result.stdout + result.stderr)
            self.assertFalse((interrupted / "summary.json").exists())
            # 저장되지 않은 다음 구간 로그가 남았다면 재개 시 보관하고 되감아야 한다.
            with (interrupted / "log.jsonl").open("a") as f:
                f.write(json.dumps({"iter": 999, "loss": 0}) + "\n")
            mismatched = arguments(interrupted)
            mismatched[mismatched.index("--batch")+1] = "4"
            result = execute([*mismatched, "--resume"])
            self.assertNotEqual(result.returncode, 0)
            result = execute([*arguments(interrupted), "--resume"])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            a = torch.load(continuous / "latest.pt", weights_only=True)
            b = torch.load(interrupted / "latest.pt", weights_only=True)
            self.assertEqual(b["iter"], 6)
            self.assertEqual(a["scheduler"], b["scheduler"])
            self.assertEqual(a["numpy_rng"], b["numpy_rng"])
            self.assertTrue(torch.equal(a["torch_rng"], b["torch_rng"]))
            for name in a["model"]:
                self.assertTrue(torch.equal(a["model"][name], b["model"][name]), name)
            self.assertEqual((continuous / "log.jsonl").read_text(), (interrupted / "log.jsonl").read_text())
            self.assertTrue(list(interrupted.glob("log.jsonl.before-resume-*")))
            before = (interrupted / "model.pt").read_bytes()
            result = execute([*arguments(interrupted), "--resume"])
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(before, (interrupted / "model.pt").read_bytes())


if __name__ == "__main__":
    unittest.main()
