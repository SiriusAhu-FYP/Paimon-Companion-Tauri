# ASR Migration Strategy

This document records how `VoiceL2D-MVP` ASR should be restored inside the Tauri runtime.

## Goal

Bring back real voice input without forcing heavyweight ASR models into the desktop installer.

## Boundary

Tauri remains the product/runtime host.

That does not mean every AI workload must run inside Rust or TypeScript.

For ASR, the practical split is:

- React/TypeScript:
  - microphone permission and capture UX
  - voice toggle state
  - VAD state display
  - ASR provider/profile selection
  - upload orchestration and result routing
- Rust/Tauri:
  - secret access
  - file/path integration
  - download management when local assets are fetched by the app
  - local command or sidecar launching if later accepted
- external ASR runtime when needed:
  - Python `faster-whisper`
  - local HTTP service wrapping a native/Rust/Python recognizer
  - cloud ASR APIs such as Volcengine or Aliyun

## Packaging Rule

Local ASR weights are not part of the default app package.

Instead, ASR profiles must support three model-source modes:

- `cloud`
  - model stays remote
- `local-path`
  - user locates an existing local model/runtime
- `download`
  - user chooses to download model assets after install

This keeps the installer small and avoids forcing all users to carry local ASR assets.

## Provider Rule

The app should treat ASR the same way it already treats LLM and TTS:

- configurable provider type
- reusable profiles
- active profile switching in settings
- secrets stored in the system keyring

The first accepted provider families are:

- `mock`
- `openai-compatible`
- `faster-whisper-local`
- `volcengine`
- `aliyun`

The important point is the abstraction, not that every provider is fully wired on day one.

## Local Runtime Rule

For local ASR, a Python or native sidecar is acceptable.

This is not treated as architectural failure.

The requirement is only:

- the desktop app remains the main product runtime
- the ASR runtime is pluggable
- the dependency stays optional
- the user can point the app at an existing local runtime or download assets later

## Implementation Order

1. Add ASR provider/profile config and settings management.
2. Restore microphone capture in the Tauri UI.
3. Restore VAD segmentation and playback-time mic lock.
4. Connect at least one real ASR provider.
5. Validate voice -> LLM -> TTS -> Live2D end-to-end.
