# Core Repo Integration

This document defines the current source-of-truth repositories that must be fused into `paimon-companion-tauri`.

## Source Split

There are two different kinds of inheritance:

- framework inheritance: `paimon-live`
- functional inheritance:
  - `LLMPlay-MVP`
  - `VoiceL2D-MVP`
  - `Video-Understanding-MVP`

`paimon-live` is already accepted as the host/framework base and does not need further audit here.

The functional fusion task is about the three MVP repositories only.

## Planning Rule

Before any new game transfer work is treated as mainline:

- the three source repositories must be audited against the Tauri codebase
- missing capabilities must be either merged or explicitly retired
- the combined runtime must be validated as one coherent system

## Current High-Level Status

`LLMPlay-MVP`

- current Tauri repo already has a validated `2048` action loop
- current implementation is not a literal `FastMCP` copy of the MVP
- full scope mapping is documented in the source-fusion audit, but implementation gaps remain
- `Sokoban` remains in scope because it is a faster reasoning-quality validation game than many open-world tasks
- the next `LLMPlay-MVP` fusion step is to recover semantic game control, stronger reflection, and prompt-template discipline
- future direction is still MCP, but with game semantics exposed above raw key/mouse steps

`VoiceL2D-MVP`

- current Tauri repo already has Live2D, LLM, TTS, chat, and expression control
- local microphone / VAD / `local-sherpa` ASR / GPT-SoVITS / Live2D response is now an accepted live baseline
- remaining open work is protocol quality and cloud-path validation, not basic voice restoration

`Video-Understanding-MVP`

- current Tauri repo already has window capture and screenshot-driven decision making
- the original project’s broader video-understanding pipeline is not yet fully represented
- reusable pipeline/evaluation pieces still need explicit audit and migration decisions
- the intended direction is local fast VLM descriptions plus cloud temporal summarization, not cloud-only frame-by-frame reasoning

For the detailed capability matrix, use `source-fusion-audit.md`.

## Accepted Interpretation Rule

Capability status should be recorded using one of these labels:

- `merged`: present and accepted in current Tauri runtime
- `partial`: some behavior exists, but the source capability is not fully covered
- `missing`: source capability is still absent
- `replaced`: source capability is intentionally superseded by a different implementation in Tauri

This rule is intended to keep future fusion work concrete and auditable.
