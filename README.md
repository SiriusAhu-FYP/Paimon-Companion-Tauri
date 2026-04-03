# Paimon Companion Tauri

Tauri-first desktop host for PAIMON:
Player-Aware Intelligent Monitoring and Operations Navigator.

## Status

This repository is the new active implementation trunk for the Tauri-based direction.

It is initialized from `paimon-live` as a host-platform base, then trimmed for PAIMON work.

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

Build a clean Tauri-based PAIMON host that will eventually support:

- game window discovery and capture
- orchestrator loop
- perception -> decide -> execute -> verify flow
- companion UI and Live2D feedback
- external model services such as vLLM and GPT-SoVITS

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
