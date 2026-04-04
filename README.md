# Paimon Companion Tauri

Tauri-first desktop host for PAIMON:
Player-Aware Intelligent Monitoring and Operations Navigator.

## Status

This repository is the active Tauri implementation trunk.

`P1 Functional Core Validation` is complete and merged into `main`.

Current accepted baseline:

- Windows host primitives for window discovery, capture, focus, and input
- `2048` functional loop with capture -> decide -> execute -> verify
- evaluation harness and functional debug tooling
- companion UI, Live2D stage foundation, runtime/config/service scaffolding

## UI

The desktop UI is currently split into:

- `控制面板`: runtime, character, behavior, and context controls
- `功能实验`: host-window tools, functional loops, evaluation harness, and debug drill-down

## Development

Prerequisites:

- Node.js 18+
- pnpm
- Rust
- Tauri prerequisites for Windows

Start:

```bash
pnpm install
pnpm tauri dev
```

## Notes

- The app does not treat Python as an in-app sidecar baseline.
- External AI services may still run outside the app over HTTP/SSE.
- The functional path intentionally excludes knowledge retrieval / embedding / rerank due to latency sensitivity.
- The current host input model is foreground-oriented and does not guarantee coexistence with user typing or IME composition.
- Public progress is tracked in `ROADMAP.md`.
