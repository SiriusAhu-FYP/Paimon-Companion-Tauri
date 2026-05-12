# Paimon Companion Tauri

Tauri-first desktop host for PAIMON:
Player-Aware Intelligent Monitoring and Operations Navigator.

## Current Repository Status

This repository is the active FYP implementation trunk.

- `P1` to `P6` are accepted as complete in `ROADMAP.md`.
- `P7` is currently the repository/documentation close-out phase.
- Current phase goal is review clarity, not new core features, packaging, or release engineering.

## What This Repository Is

This codebase assembles capabilities inherited from:

- `LLMPlay-MVP`
- `VoiceL2D-MVP`
- `Video-Understanding-MVP`

`paimon-live` is treated as host/framework heritage only.

The accepted runtime direction is companion-first, with explicit Delegation Mode boundaries and MCP-facing semantic control.

## Accepted Scope For Final Review

The accepted repository-facing scope is:

- Windows host primitives (window discovery, capture, focus, keyboard/mouse input)
- companion runtime with Live2D, speech playback, and expression linkage
- validated semantic task loops for `2048` and retained `Sokoban`
- local-small / cloud-big runtime split from `P6`
- memory/stability convergence and evidence-oriented debug capture/export baseline

## Repository Layout

For repository review, the top-level structure can be read as:

- `src/`
  React UI plus TypeScript-side runtime/services
- `src-tauri/`
  Rust/Tauri host backend and native commands
- `docs/`
  compact current architecture note
- `prompts/`
  shared prompt/template artifacts retained as part of the project scope
- `.workbench/`
  harness, experiments, simulations, and other non-primary project surfaces

## Further Reading

For the phase record and current architecture snapshot, continue with:

1. `ROADMAP.md`
2. `docs/architecture.md`

## Research And Verification Surfaces

This repository intentionally keeps inspection-oriented UI surfaces visible:

- `Workbench` for runtime/delegation inspection workflows
- `Timeline` for round-by-round delegation trace review
- `Event Log` for runtime/memory/tool evidence observation

These are part of the FYP validation story (interpretability, delegation process checks, and evidence capture), not accidental leftover UI residue.

`Control Panel` remains the formal interaction entry; the inspection surfaces above support review, diagnosis, and thesis-facing system explainability.

## Mainline vs Experimental Surfaces

Mainline accepted scope is defined by:

- this `README.md`
- `ROADMAP.md`
- `docs/architecture.md`

The repository may also contain branch-local or machine-local experimental/harness surfaces (for example `.workbench/` artifacts and local evaluation assets). Those are contextual support materials, not separate productization gates.

## Evaluation Boundaries

From this repository alone, reviewers should primarily evaluate:

- architecture and scope clarity
- accepted capability boundaries
- representative runtime/control/evaluation paths

This repository does not target:

- one-click full reproducibility across all machines
- packaging/installer completeness as a phase gate
- full recreation of every local vision/vLLM runtime condition

Some local assets or sidecar environments are intentionally machine-dependent.

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

## Runtime Notes

- The app stays Tauri-first. Optional local sidecars remain acceptable where source projects already relied on them.
- External AI services may run outside the app over HTTP/SSE.
- Local TTS stays on the GPT-SoVITS path inherited from `VoiceL2D-MVP`.
- ASR families currently supported: `local-sherpa`, `volcengine`, `aliyun`.
- Default local ASR baseline: bundled `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`.
- `pnpm setup:local-asr` prepares local ASR model assets and sherpa native archive needed by Rust checks.
- Host input is foreground-oriented and does not guarantee coexistence with user typing/IME composition.
