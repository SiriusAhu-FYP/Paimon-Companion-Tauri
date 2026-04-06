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

- full migration of `LLMPlay-MVP` source scope
- full migration of `Video-Understanding-MVP` pipeline/evaluation capabilities
- full post-fusion validation across all three source lines

Current next-step priority:

- `P2.3` now focuses first on a companion expression / motion protocol
- game-plugin protocol work is intentionally deferred until after that layer is settled
- a first-pass emotion taxonomy is now being landed around `neutral`, `happy`, `angry`, `sad`, `delighted`, `alarmed`, and `dazed`, with randomized per-model expression candidates

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

Rust-only check:

```bash
pnpm setup:local-asr
cargo check --manifest-path src-tauri/Cargo.toml
```

## Notes

- The app stays Tauri-first. Optional local sidecars remain acceptable for heavy workloads where the source projects already depend on them.
- External AI services may still run outside the app over HTTP/SSE.
- ASR is being migrated with a provider/profile model rather than by bundling all speech-recognition weights into the installer.
- A real chat-panel microphone path now exists, with browser-side capture/VAD plus pluggable cloud or local-runtime ASR upload.
- Local TTS stays on the GPT-SoVITS path inherited from `VoiceL2D-MVP`.
- Accepted ASR families are currently `local-sherpa`, `volcengine`, and `aliyun`.
- The default local ASR route is the bundled `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16` model.
- `pnpm setup:local-asr` prepares both the local ASR model assets and the sherpa native archive needed by `cargo check`.
- The current local bilingual ASR baseline is practical for both Chinese and English, but mixed-language recognition is still effectively resolved one utterance at a time rather than as robust intra-sentence code-switching.
- The currently accepted `P2.2` live voice baseline is local-only: `local-sherpa` microphone input -> companion pipeline -> `GPT-SoVITS` playback -> Live2D reaction.
- Cloud ASR providers remain supported configuration options, but they are not yet part of the accepted live-validation baseline.
- The next fusion step is not general game pluginization yet; it is to formalize how LLM or runtime output selects character emotion, expression, and motion in a reusable protocol.
- The functional path intentionally excludes knowledge retrieval / embedding / rerank due to latency sensitivity.
- The current host input model is foreground-oriented and does not guarantee coexistence with user typing or IME composition.
- New game transfer work is gated behind source-repository fusion and validation.
- Public progress is tracked in `ROADMAP.md`.
