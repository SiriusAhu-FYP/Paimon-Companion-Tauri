# Paimon Companion Tauri

Tauri-first desktop host for PAIMON:
Player-Aware Intelligent Monitoring and Operations Navigator.

## Status

This repository is the new active implementation trunk for the Tauri-based direction.

It is initialized from `paimon-live` as a host-platform base, then trimmed for PAIMON work.

`P1 Functional Core Validation` is now merged into `main` as the accepted baseline.

What was intentionally kept:

- Tauri desktop host and Rust command layer
- React + TypeScript app shell
- Live2D rendering and stage window foundation
- Runtime, logger, config, HTTP proxy, LLM and TTS service scaffolding

What was intentionally removed from the initial fork:

- Old phase blueprints
- Research and migration notes from `paimon-live`
- Dev reports and editor-local project baggage

## Current Goal

Build on the accepted Tauri-based PAIMON host baseline and move into unified-system validation:

- game window discovery and capture
- orchestrator loop
- perception -> decide -> execute -> verify flow
- companion UI and Live2D feedback
- external model services such as vLLM and GPT-SoVITS
- relational companion behavior integrated with the functional loop

The current desktop UI separates:

- `控制面板`: runtime, character, behavior, and context controls
- `功能实验`: host-window tools, functional loops, evaluation harness, and debug drill-down

## Development

### Prerequisites

- Node.js 18+
- pnpm
- Rust
- Tauri prerequisites for Windows

### Start

```bash
pnpm install
pnpm tauri dev
```

## Notes

- This repo does not treat Python as an in-app sidecar baseline.
- External AI services may still run outside the app over HTTP/SSE.
- The old Python-first integration repo is frozen and kept only as a local historical reference.
- Public implementation progress is tracked in `ROADMAP.md`.
- The current host input model is foreground-oriented and does not guarantee coexistence with user typing or IME composition.
