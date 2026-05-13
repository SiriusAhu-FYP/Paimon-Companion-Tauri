<h1 align="center">PAIMON</h1>

<p align="center">
  <strong>PAIMON the Attentive Interactive Multi-modal Observer-Navigator</strong>
</p>

<p align="center">
  A desktop companion-agent prototype that combines screen-aware companionship and bounded task delegation in one application runtime.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-Desktop%20Runtime-24C8D8?style=flat-square" alt="Tauri Desktop Runtime" />
  <img src="https://img.shields.io/badge/Interaction-Dual%20Mode-4C6FFF?style=flat-square" alt="Dual Mode Interaction" />
  <img src="https://img.shields.io/badge/Scope-Companion%20Agent%20Prototype-E6B35A?style=flat-square" alt="Companion Agent Prototype" />
</p>

<p align="center">
  <img src="./media/readme-banner.png" alt="PAIMON banner" width="100%" />
</p>

## Overview

`paimon-companion-tauri` is the main FYP implementation of PAIMON. It presents one desktop system with two separately activated interaction paths built on the same technical foundation:

- `Companion Mode`, which focuses on screen-aware presence, speech interaction, rolling memory, and affect-linked Live2D expression
- `Delegation Mode`, which handles explicit browser and game tasks through a bounded multi-role loop

The project is companion-first in overall direction. Delegated operation is intentionally constrained, verified, and task-bounded rather than framed as unrestricted autonomy.

## Screenshot

<p align="center">
  <img src="./media/app-screenshot-light.png" alt="PAIMON desktop application main interface" width="100%" />
</p>

## What It Includes

- a Tauri desktop host with Rust-side window, capture, focus, and input primitives
- a React and TypeScript runtime for companion interaction, orchestration, and visible inspection surfaces
- a dual-mode interaction design in which Companion Mode and Delegation Mode are activated separately
- a three-role delegation pipeline built around `Mission Analyst -> Operations Planner -> Progress Evaluator`
- semantic task handling for retained browser and game validation cases such as `2048` and `Sokoban`
- memory, debug capture, timeline inspection, and evidence-oriented runtime surfaces

## System Direction

PAIMON combines several ideas in one runtime:

- `General Computer Control (GCC)` for screen-grounded desktop interaction
- an MCP-facing tool boundary for orchestration and host control
- a hybrid perception strategy that combines local observation with cloud reasoning when needed

This repository is therefore not a minimal demo of one isolated feature. It is the integrated project line where companion behavior, speech, Live2D presentation, bounded delegation, memory, and runtime inspection meet.

## Repository Structure

- `src/` - React UI and TypeScript runtime
- `src-tauri/` - Rust/Tauri backend and native host boundary
- `prompts/` - prompt and wording artifacts
- `docs/` - implementation-facing project documentation
- `ROADMAP.md` - phase history and milestone record

Machine-local or branch-specific working material may also exist around the repo, such as `.workbench/` or `.private/`, but those are support surfaces rather than the center of the tracked mainline implementation.

## Development

Prerequisites:

- Node.js 18+
- `pnpm`
- Rust
- Windows Tauri prerequisites

Install and run:

```bash
pnpm install
pnpm tauri dev
```

Rust-side check:

```bash
pnpm setup:local-asr
cargo check --manifest-path src-tauri/Cargo.toml
```

## Runtime Notes

- The host is desktop-oriented and Tauri-first.
- External AI services may run outside the app over HTTP or SSE.
- Local TTS remains on the GPT-SoVITS path retained from earlier work.
- Supported ASR families currently include `local-sherpa`, `volcengine`, and `aliyun`.
- The default bundled local ASR baseline is `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`.
- Host input is foreground-oriented and does not guarantee coexistence with user typing or IME composition.

## Scope Boundary

This repository is intended to present the main implementation clearly. It does not guarantee one-click reproduction of every machine-local runtime condition, external service setup, or evaluation harness.

The main review surface is the tracked codebase and the architecture/runtime it expresses.

## Further Reading

- `docs/architecture.md` for the system structure
- `ROADMAP.md` for the development phases and accepted milestones
- `README_zh.md` for the Chinese version of the repository introduction
