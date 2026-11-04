#!/usr/bin/env bash
# Run only after booking the shared GPU. All outputs stay in the personal folder.
set -euo pipefail
project_ml=/data/work/ryush2002/Sign-Language-recog/ml
python_bin=/home/jk636/venv/bin/python
pair_dir="$project_ml/runs/vq_hand_pair_20261101"
base_dir=/data/runs/vq_e5
training_data="$project_ml/data/recog_dedup3_20261027_1738/full"
baseline_dir="$project_ml/runs/recog_3000_dedup3_20261027_1738/evaluations/validation_e5_20261101"
cd "$project_ml"
mkdir -p "$pair_dir"
active_gpu_jobs=$(nvidia-smi --query-compute-apps=pid --format=csv,noheader)
if [[ -n "$active_gpu_jobs" ]]; then
  echo "GPU is occupied; refusing to start." >&2
  exit 1
fi
if [[ -e "$pair_dir/launched" ]]; then
  echo 'Existing launch marker: inspect outputs and resume explicitly; refusing duplicate launch.' >&2
  exit 1
fi
# Atomic marker prevents simultaneous duplicate launchers.
(set -o noclobber; echo "$$" > "$pair_dir/launched")
finish_pair() {
  pair_status=$?
  trap - EXIT
  echo "$pair_status" > "$pair_dir/exit_status.txt"
  echo "Pair exit status: $pair_status"
  sudo -n shutdown -h +2 || echo 'Automatic shutdown could not be scheduled; check VM.' >&2
  exit "$pair_status"
}
trap finish_pair EXIT
for hand_weight in 1 2; do
  arm_dir="$pair_dir/lam$hand_weight"
  "$python_bin" -u -m eval.vq_hand_ablation --mode train --base "$base_dir" --data "$training_data" --out "$arm_dir" --lam-hand "$hand_weight" --steps 10000
  checkpoint_hash=$("$python_bin" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$arm_dir/model.pt")
  "$python_bin" -u -m eval.validation_reconstruction --recog "$project_ml/runs/recog_3000_dedup3_20261027_1738" --vq "$arm_dir" --expected-vq-sha256 "$checkpoint_hash" --out "$arm_dir/validation"
done
"$python_bin" -m eval.compare_vq_hand_pair --pair "$pair_dir" --baseline "$baseline_dir"
