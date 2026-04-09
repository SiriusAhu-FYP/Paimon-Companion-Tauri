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

The immediate next priority inside that fusion work has now shifted:

- accept the current expression-linkage baseline from `P2.3`
- use it as one part of a broader MCP-facing companion/game runtime
- fold in `LLMPlay-MVP` semantic control and `Video-Understanding-MVP` local/cloud perception design

## Core Shape

- Rust host for OS-facing capabilities
- TypeScript services for orchestration and runtime logic
- React UI for companion presentation, controls, and inspection
- external model services over HTTP/SSE when needed

The long-term external control boundary should be MCP.

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

Separate from `Unified Run`, the normal chat path now has a real microphone entry again:

- `对话` 面板提供麦克风开关
- browser/Tauri WebView captures microphone audio
- a light browser-side VAD gate cuts speech segments
- recognized text is routed back through the normal companion pipeline

This path is now accepted as the current `P2.2` live voice baseline.

`Unified Run` itself should still be treated as groundwork only.

It does not by itself prove that the three functional source repositories have been fully fused.

## Current Character Protocol State

The current runtime already supports:

- reply-driven emotion changes
- expression switching in the Stage window
- speaking-state and mouth-sync updates

What it does not yet have as a fully accepted protocol:

- a stable action vocabulary for motion selection
- a reusable contract that cleanly separates companion expression actions from future game-control actions

That protocol layer has now reached an accepted first-pass baseline in `P2.3`.

The current first implementation pass of `P2.3` should stay narrow:

- emotion categories stay semantically distinct instead of overfitting model-specific expression names
- current protocol target set: `neutral`, `happy`, `angry`, `sad`, `delighted`, `alarmed`, `dazed`
- each model may offer multiple expression candidates for one category, with runtime random selection
- motion remains secondary to expression linkage in the current acceptance baseline

Future direction:

- the expression-control path should be formalized as MCP
- the same MCP boundary should later carry gameplay actions as well

## Companion Runtime Direction

The intended runtime direction now follows the broad pattern already explored in `Video-Understanding-MVP`:

1. local fast visual descriptions
2. rolling description queue
3. cloud temporal reasoning
4. MCP tool calls for companion and gameplay actions

Current design target:

- local VLM runs in WSL or another low-latency Linux node
- local model baseline should be aligned with `Qwen3-VL-2B-Instruct` style fast image description
- rolling summary windows should start from `8-10s`
- the runtime should preserve at least the latest `1min` of summarized context

The local VLM is not the final reasoning authority.

Its job is to keep the companion perceptive at low latency.

The cloud model is responsible for:

- temporal understanding
- companion reply generation
- MCP tool usage when expression or gameplay actions are needed

Reference:

- `docs/architecture/companion-runtime.md`

## ASR Direction

For `VoiceL2D-MVP` restoration, the accepted baseline is now clear:

- the Tauri app owns capture UX, settings, orchestration, and secret handling
- the default local ASR route is bundled `local-sherpa`
- cloud fallbacks remain `volcengine` and `aliyun`

Current packaging rule:

- `pnpm setup:local-asr` prepares the local model assets and native sherpa archive required by Rust builds
- the accepted local live-validation baseline is `local-sherpa` microphone input -> companion pipeline -> `GPT-SoVITS` playback -> Live2D response
- cloud ASR remains a supported option, but not part of the accepted live baseline yet

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

The longer-term goal is to evolve these helpers into MCP-facing semantic game actions, where per-game config maps actions such as `open_inventory` to host-level execution details.
