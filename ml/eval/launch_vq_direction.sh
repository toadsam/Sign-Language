#!/usr/bin/env bash
# Requires the current experiment's shared-GPU booking/notice.
set -euo pipefail
project_ml=/data/work/ryush2002/Sign-Language-recog/ml
python_bin=/home/jk636/venv/bin/python
experiment_dir="$project_ml/runs/vq_direction_20261101"
candidate_dir="$experiment_dir/direction01"
control_dir="$project_ml/runs/vq_hand_pair_20261101/lam2"
control_val="$project_ml/runs/vq_hand_pair_20261101/token_handoff/val"
training_data="$project_ml/data/recog_dedup3_20261027_1738/full"
cd "$project_ml"
mkdir -p "$experiment_dir"
active_gpu_jobs=$(nvidia-smi --query-compute-apps=pid --format=csv,noheader)
while read -r gpu_pid; do
  [[ -z "$gpu_pid" ]] && continue
  gpu_command=$(ps -p "$gpu_pid" -o args=)
  if [[ "$gpu_pid" != "${AUTHORIZED_INFERENCE_PID:-}" || "$gpu_command" != '/data/work/jiheon/envs/serve-py311/bin/python -m uvicorn serve.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1' ]]; then
    echo "Unexpected GPU process $gpu_pid; refusing to start." >&2
    exit 1
  fi
done <<< "$active_gpu_jobs"
(set -o noclobber; echo "$$" > "$experiment_dir/launched")
finish_experiment() {
  experiment_status=$?
  trap - EXIT
  echo "$experiment_status" > "$experiment_dir/exit_status.txt"
  echo "Experiment exit status: $experiment_status"
  echo 'VM remains running after completion or failure, as requested by user.'
  exit "$experiment_status"
}
trap finish_experiment EXIT
"$python_bin" -u -m eval.vq_direction_ablation --mode train --base /data/runs/vq_e5 --data "$training_data" --out "$candidate_dir" --lam-hand 2 --lam-direction 0.1 --steps 10000
checkpoint_hash=$("$python_bin" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$candidate_dir/model.pt")
"$python_bin" -u -m eval.token_handoff --partition val --candidate "$candidate_dir" --expected-candidate-sha "$checkpoint_hash" --candidate-id vq_direction_20261101_d01 --baseline /data/runs/vq_e5 --data "$training_data" --recog "$project_ml/runs/recog_3000_dedup3_20261027_1738" --out "$experiment_dir/val"
"$python_bin" -m eval.compare_direction_candidate --control "$control_dir" --candidate "$candidate_dir" --control-val "$control_val" --candidate-val "$experiment_dir/val" --out "$experiment_dir/comparison.json"
