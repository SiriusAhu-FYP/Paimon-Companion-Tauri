# Runtime Setup

This note describes the local runtime dependencies that matter when running `paimon-companion-tauri`.

It is not a promise of one-click reproduction for every machine-local setup. Its purpose is narrower: to make clear which local services are required, which are optional, and where the repository already provides a helper script.

## 1. Required Baseline

The tracked baseline assumes:

- Node.js `20.19+` or `22.12+`
- `pnpm 10+`
- Rust
- Windows Tauri prerequisites

The application can be started with:

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm setup:local-asr` first, which prepares the retained local sherpa ASR baseline before starting the frontend dev flow.

## 2. Local ASR

The repository includes a tracked helper script:

- `scripts/ensure-local-asr-model.ps1`

This script downloads:

- the default sherpa streaming bilingual ASR model
- the matching sherpa native runtime archive used by the host side

You can run it directly:

```powershell
pnpm setup:local-asr
```

This is the only local speech dependency that the repository prepares automatically.

## 3. Optional Local Vision Service

The repository also includes an optional helper:

- `scripts/start_local_vision_service_wsl.sh`

This script is not required for ordinary development. It is a convenience wrapper for one specific local WSL-based vLLM setup used during development.

In its current form it assumes:

- a Python virtual environment at `~/vLLM_server/.venv`
- a locally cached `Qwen/Qwen3-VL-2B-Instruct` snapshot
- a local HTTP service exposed on port `32183`

Typical use looks like:

```bash
bash ./scripts/start_local_vision_service_wsl.sh
```

If your local vLLM environment lives elsewhere, adjust the script to match your machine rather than treating it as a portable installer.

## 4. Local TTS

The retained local TTS path uses GPT-SoVITS.

This repository does not package a full GPT-SoVITS environment bootstrap. Treat that service as an external local dependency.

In practice, running the official GPT-SoVITS repository's API v2 service is sufficient.

For example, inside a GPT-SoVITS environment:

```bash
python api_v2.py --port 9880 -a 0.0.0.0
```

The `api_v2.py` entrypoint is provided by the official GPT-SoVITS repository.

## 5. Scope Boundary

The repository is meant to present the implementation clearly, not to freeze every external service layout into one portable environment.

The tracked codebase assumes some local runtime dependencies will remain machine-specific, especially for optional model-serving sidecars such as local vLLM and local GPT-SoVITS.
