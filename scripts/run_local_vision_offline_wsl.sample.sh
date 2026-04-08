#!/usr/bin/env bash
set -euo pipefail

source /home/playerAhu/vLLM_server/.venv/bin/activate

MODEL_ROOT="${HOME}/.cache/huggingface/hub/models--Qwen--Qwen3-VL-2B-Instruct"

if [[ ! -d "${MODEL_ROOT}/snapshots" ]]; then
  echo "Model cache not found: ${MODEL_ROOT}" >&2
  exit 1
fi

MODEL_SNAPSHOT="$(find "${MODEL_ROOT}/snapshots" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"

if [[ -z "${MODEL_SNAPSHOT}" ]]; then
  echo "No local snapshot found under ${MODEL_ROOT}/snapshots" >&2
  exit 1
fi

export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HF_DATASETS_OFFLINE=1
export VLLM_NO_USAGE_STATS=1

exec vllm serve "${MODEL_SNAPSHOT}" \
  --served-model-name "Qwen/Qwen3-VL-2B-Instruct" \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.5 \
  --enable-prefix-caching \
  --mm-processor-kwargs '{"max_dynamic_patch": 448, "min_dynamic_patch": 32}'
