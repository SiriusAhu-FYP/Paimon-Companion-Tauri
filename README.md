# Paimon Companion Tauri

Tauri-first desktop host for PAIMON:
Player-Aware Intelligent Monitoring and Operations Navigator.

## Status

This repository is the active Tauri implementation trunk.

`P1 Functional Core Validation` is complete and merged into `main`.

Current `P2` mainline is not new game expansion.

It is now focused on fully integrating the functional heritage of these source repositories:

- `E:\FYP-PROJECT\core\LLMPlay-MVP`
- `E:\FYP-PROJECT\core\VoiceL2D-MVP`
- `E:\FYP-PROJECT\core\Video-Understanding-MVP`

`paimon-live` is treated as the desktop host/framework origin only.

Current accepted baseline:

- Windows host primitives for window discovery, capture, focus, and input
- `2048` functional loop with capture -> decide -> execute -> verify
- evaluation harness and functional debug tooling
- companion UI, Live2D stage foundation, runtime/config/service scaffolding

What the baseline does not yet prove:

- full migration of `VoiceL2D-MVP` voice-input capabilities
- full migration of `LLMPlay-MVP` source scope
- full migration of `Video-Understanding-MVP` pipeline/evaluation capabilities
- full post-fusion validation across all three source lines

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

- The app stays Tauri-first, but local AI runtimes may still be attached as optional external services or sidecars when the ecosystem fit is better than forcing everything into Rust/TS.
- External AI services may still run outside the app over HTTP/SSE.
- ASR is being migrated with a provider/profile model rather than by bundling all speech-recognition weights into the installer.
- The functional path intentionally excludes knowledge retrieval / embedding / rerank due to latency sensitivity.
- The current host input model is foreground-oriented and does not guarantee coexistence with user typing or IME composition.
- New game transfer work is gated behind source-repository fusion and validation.
- Public progress is tracked in `ROADMAP.md`.
