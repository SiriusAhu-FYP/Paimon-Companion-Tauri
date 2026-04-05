# ASR Migration Strategy

This document records how `VoiceL2D-MVP` ASR should be restored inside the Tauri runtime.

## Goal

Bring back real voice input with a low-latency local default and cloud fallbacks.

## Boundary

Tauri remains the product/runtime host.

That does not mean every AI workload must run inside Rust or TypeScript.

For ASR, the practical split is:

- React/TypeScript:
  - microphone permission and capture UX
  - voice toggle state
  - VAD state display
  - ASR provider/profile selection
  - PCM capture orchestration and result routing
- Rust/Tauri:
  - secret access
  - file/path integration
  - local `sherpa-onnx` command execution
  - cloud request proxying when needed
- external ASR runtime when needed:
  - cloud ASR APIs such as Volcengine or Aliyun

## Packaging Rule

The accepted local default is `local-sherpa`.

The repo currently prepares it via `pnpm setup:local-asr`, which fetches:

- the local bilingual `sherpa-onnx` model assets
- the matching native static archive required by `sherpa-onnx-sys`

This is intentionally repository-local preparation rather than an always-tracked git asset.

## Provider Rule

The app should treat ASR the same way it already treats LLM and TTS:

- configurable provider type
- reusable profiles
- active profile switching in settings
- secrets stored in the system keyring

The first accepted provider families are:

- `mock`
- `local-sherpa`
- `volcengine`
- `aliyun`

## Local Runtime Rule

For local ASR, the accepted default is the bundled `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16` route. Cloud fallbacks remain acceptable through Volcengine and Aliyun.

Current implementation constraints:

- local ASR no longer uses Python HTTP services
- local ASR depends on a pre-fetched sherpa native archive exposed to Cargo through `.cargo/config.toml`
- standalone `cargo check` should be preceded by `pnpm setup:local-asr` on a fresh machine

## Implementation Order

1. Add ASR provider/profile config and settings management.
2. Restore microphone capture in the Tauri UI.
3. Restore VAD segmentation and playback-time mic lock.
4. Connect at least one real ASR provider.
5. Validate voice -> LLM -> TTS -> Live2D end-to-end.
