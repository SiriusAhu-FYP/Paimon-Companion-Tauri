# Docs

Tracked project docs are kept here.

Current high-value entry points:

- `architecture/tauri-baseline.md`
- `architecture/core-repo-integration.md`
- `architecture/source-fusion-audit.md`
- `architecture/companion-runtime.md`
- `architecture/expression-protocol.md`
- `architecture/asr-migration-strategy.md`
- `architecture/game-task-templates.md`
- `evaluation/2048-baseline.md`

Current state:

- `P1 Functional Core Validation` is complete on `main`
- `P2` has been refocused to full source-repository fusion before any new game transfer
- `P2.2` has now accepted a local live-validation baseline: `local-sherpa` microphone input plus `GPT-SoVITS` output and Live2D response
- `P2.3` is now scoped first around companion expression / motion protocol, with game-plugin protocol work deferred to a later step
- the first `P2.3` implementation pass is a small emotion taxonomy plus randomized per-model expression candidates
- the next planning step now ties `LLMPlay-MVP` and `Video-Understanding-MVP` together through an MCP-facing companion runtime rather than through rigid reply formatting
- the functional desktop workflow now lives under the dedicated `功能实验` panel
