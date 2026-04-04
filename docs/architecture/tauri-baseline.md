# Tauri Baseline

## Purpose

This document records the current architectural baseline of `paimon-companion-tauri`.

## Source Of Truth

For planning purposes, there are two different kinds of heritage:

- framework heritage: `paimon-live`
- functional heritage: `LLMPlay-MVP`, `VoiceL2D-MVP`, `Video-Understanding-MVP`

`paimon-live` is only the host/framework origin.

The current product/mainline task is to fully fuse the functional heritage of the three MVP repositories into this Tauri runtime.

That means new game transfer work is not the immediate next priority until the three-source fusion is audited and validated.

## Core Shape

- Rust host for OS-facing capabilities
- TypeScript services for orchestration and runtime logic
- React UI for companion presentation, controls, and inspection
- external model services over HTTP/SSE when needed

## Responsibility Split

Rust owns:

- window discovery
- screen capture
- input injection
- secret access
- local OS integration
- HTTP / SSE proxy where browser constraints apply

TypeScript owns:

- orchestrator loop
- safety and verification policy
- runtime coordination
- perception/game-task services
- unified companion coordination for validated runs
- companion state and feedback
- reusable game task templates

React owns:

- stage output
- control layout
- debug surfaces
- user-triggered inspection actions
- unified-run validation controls
- microphone capture UX and provider selection surfaces

## Current Unified Run Groundwork

The current branch already contains a thin unified runtime layer above the validated `2048` path.

It is responsible for:

- triggering a functional run from a companion-facing entry point
- mapping run state to character emotion
- speaking the companion summary through the existing TTS pipeline
- accepting testing-oriented voice text input and routing simple `2048` commands

Current scope:

- `功能实验 -> Unified Run` supports direct unified single-step execution
- speech output is real and uses the normal `PipelineService` TTS path
- voice input is currently a manual/mock ASR path for interaction validation, not a full microphone capture stack

This should be treated as groundwork only.

It does not by itself prove that the three functional source repositories have been fully fused.

## ASR Direction

For `VoiceL2D-MVP` restoration, ASR is not being forced into one implementation shape.

The current direction is:

- Tauri app owns settings, capture UX, orchestration, and secret handling
- local heavy ASR can stay in an optional external runtime if that is the most practical path
- local ASR weights are not part of the default installer
- settings should let the user choose cloud API, existing local runtime/model path, or later a download flow

Reference:

- `docs/architecture/asr-migration-strategy.md`

## Functional Latency Policy

For the current functional path:

- knowledge retrieval is not in the real-time control path
- embedding and rerank requests are excluded from live execution
- vision/game-task services call the configured model endpoint directly when needed

The knowledge module is still retained for:

- chat / companion experiments
- manual context injection
- future non-real-time workflows

## Input Execution Model

The current host-control implementation is foreground-oriented:

- the target window is focused before key or mouse input is emitted
- keyboard and mouse events use standard Windows input APIs

This should be treated as foreground-exclusive control, not background-safe automation.

It does not guarantee coexistence with:

- user typing in another window
- IME composition
- parallel local mouse interaction

If future stages require non-interfering control, the design will need:

- app-specific automation hooks
- target-specific background injection that is known to work
- or an isolated execution environment such as a VM or remote session

## Reusable Game Tasks

For games with a small finite task set, the functional layer supports reusable task templates.

This fits tasks such as:

- menu toggles
- short movement probes
- one-step interaction tasks

Reference:

- `docs/architecture/game-task-templates.md`
