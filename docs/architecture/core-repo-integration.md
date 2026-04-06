# Core Repo Integration

This document defines the current source-of-truth repositories that must be fused into `paimon-companion-tauri`.

## Source Split

There are two different kinds of inheritance:

- framework inheritance: `paimon-live`
- functional inheritance:
  - `E:\FYP-PROJECT\core\LLMPlay-MVP`
  - `E:\FYP-PROJECT\core\VoiceL2D-MVP`
  - `E:\FYP-PROJECT\core\Video-Understanding-MVP`

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
- full scope mapping still needs to be documented
- immediate next fusion task is the companion expression / motion protocol, not full game pluginization yet

`VoiceL2D-MVP`

- current Tauri repo already has Live2D, LLM, TTS, chat, and expression control
- local microphone / VAD / `local-sherpa` ASR / GPT-SoVITS / Live2D response is now an accepted live baseline
- remaining open work is protocol quality and cloud-path validation, not basic voice restoration

`Video-Understanding-MVP`

- current Tauri repo already has window capture and screenshot-driven decision making
- the original project’s broader video-understanding pipeline is not yet fully represented
- reusable pipeline/evaluation pieces still need explicit audit and migration decisions

## Accepted Interpretation Rule

Capability status should be recorded using one of these labels:

- `merged`: present and accepted in current Tauri runtime
- `partial`: some behavior exists, but the source capability is not fully covered
- `missing`: source capability is still absent
- `replaced`: source capability is intentionally superseded by a different implementation in Tauri

This rule is intended to keep future fusion work concrete and auditable.
