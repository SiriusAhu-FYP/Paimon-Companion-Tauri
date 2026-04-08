# Roadmap

Public progress tracker for `paimon-companion-tauri`.

## Status Legend

- `[x]` done
- `[ ]` not started
- `[-]` intentionally deferred

- [x] P0: Repository And Host Baseline
  - [x] Create `paimon-companion-tauri` from the reusable Tauri host base
  - [x] Rename app/package identity away from `paimon-live`
  - [x] Remove inherited docs and experiment baggage from the initial fork
  - [x] Remove livestream-only external event injection layer
  - [x] Keep the knowledge module as a support capability
  - [x] Move private planning/report material out of tracked repo content
  - [x] Copy owner-local `.cursor` workspace rules into the repo as ignored local files

- [x] P1: Functional Core Validation
  - [x] P1.1 Host OS Primitives
    - [x] `list_windows`
    - [x] `capture_window`
    - [x] `focus_window`
    - [x] `send_key`
    - [x] `send_mouse`
  - [x] P1.2 TypeScript Core
    - [x] `services/perception`
    - [x] `services/orchestrator`
    - [x] `services/safety`
    - [x] unified runtime state for functional execution
    - [x] task/result logging for evaluation runs
  - [x] P1.3 2048 Minimal Loop
    - [x] detect target window
    - [x] capture board image
    - [x] produce action-oriented understanding from VLM/LLM
    - [x] execute one valid move
    - [x] verify board changed as expected
    - [x] render companion feedback in UI
  - [x] P1.4 Functional Evaluation Harness
    - [x] define repeatable `2048` task cases
    - [x] track task success rate
    - [x] track latency
    - [x] track action validity
    - [x] document baseline results
  - [-] P1.5 Stardew Valley Extension
    deferred from the active codebase during pre-`P2` cleanup to reduce maintenance surface; task templates remain available for future reintroduction

- [x] P1.5+: Support Systems
  - [-] connect knowledge retrieval to functional tasks where useful
    deferred: current functional loop is latency-bound, so embedding / retrieval / rerank stay out of the real-time path
  - [-] add better debug panels for capture / action / verification
    event log and status bar now surface live runtime / functional events; control panel also exposes capture -> decision -> action -> verification drill-down, but richer artifact export is still pending
  - [x] add reusable task templates for new games

P1 close-out:

- accepted baseline: validated `2048` path on `2026-04-03`
- `P2` should start from a fresh branch

- [ ] P2: Core Repository Fusion
  - [x] groundwork: a thin unified runtime layer already exists for `2048` validation
  - [x] P2.1 Source Audit And Gap Mapping
    - [x] map `LLMPlay-MVP` features to the current Tauri codebase
    - [x] map `VoiceL2D-MVP` features to the current Tauri codebase
    - [x] map `Video-Understanding-MVP` features to the current Tauri codebase
    - [x] classify each capability as merged / partial / missing / replaced
    - [x] document the accepted replacement decisions where implementation shape has changed
  - [x] P2.2 `VoiceL2D-MVP` Completion
    - [x] define ASR migration strategy around pluggable providers instead of bundled desktop weights
    - [x] add ASR provider/profile configuration surface in settings
    - [x] restore a real voice-input path instead of manual/mock-only ASR
    - [x] support at least one cloud ASR provider and one local-runtime provider
    - [x] keep GPT-SoVITS as the accepted local TTS baseline from `VoiceL2D-MVP`
    - [x] align accepted ASR providers with the current product plan: `local-sherpa`, `volcengine`, `aliyun`
    - [x] bundle the default local ASR model route around `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`
    - [x] restore microphone capture, VAD segmentation, and playback-time mic lock
    - [x] validate voice -> LLM -> TTS -> Live2D end-to-end in the Tauri host
    - [-] improve mixed-language recognition inside a single utterance
      deferred: the current bilingual local ASR baseline is acceptable for Chinese or English utterances, but intra-sentence code-switching is not yet treated as a solved requirement
  - [ ] P2.3 Companion Expression Protocol
    - [x] define a first-pass emotion taxonomy and randomized per-model expression candidate mapping
    - [x] extend the same protocol to first-pass motion selection where models expose reusable motions
    - [x] validate that companion replies can consistently drive visible Live2D expression changes through this protocol
    - [ ] migrate the accepted expression-control path toward a formal MCP-facing contract
    - [ ] keep motion as an optional enhancement rather than the current acceptance gate
  - [ ] P2.4 `LLMPlay-MVP` Completion
    - [x] keep `Sokoban` in scope as the second reasoning-oriented validation game
    - [x] define a shared game prompt template (`example.md`) before rewriting per-game prompts
    - [x] lock the first companion MCP contract and game semantic action contract before broad plugin work
    - [x] define the minimum retained `Sokoban` validation scope before implementation
    - [x] replace the current weak reflection/history loop with a stronger decision-history design derived from `LLMPlay-MVP`
    - [x] define an MCP-facing semantic action contract so the model can call game actions without relying on rigid visible reply formatting
    - [x] land the first semantic action runtime foundation by migrating `2048` away from raw key assumptions
    - [x] move semantic game action definitions into lightweight per-game config manifests
    - [x] restore a first minimal `Sokoban` validation skeleton on the same semantic action foundation
    - [x] decide which gameplay semantics belong in core MCP tools and which belong in per-game config/plugins
    - [x] either merge the missing MVP capabilities or explicitly retire them in docs
  - [ ] P2.5 `Video-Understanding-MVP` Completion
    - [x] define the first local-fast / cloud-summarize companion runtime slice around `Qwen3-VL-2B-Instruct` style local frame descriptions plus cloud temporal reasoning
    - [x] start from `8-10s` rolling local-description windows and preserve at least the latest `1min` of summary context
    - [x] feed the latest rolling temporal summary into the companion prompt path instead of leaving it as a lab-only side panel
      - [x] split perception prompting into general observation plus lightweight game-specific focus overlays
      - [x] add lightweight change-based frame filtering so the runtime can coalesce visually unchanged captures instead of re-describing every tick
      - [x] expose lightweight session metrics for runtime throughput, unchanged-frame ratio, and summary latency
      - [x] add a fixed-duration companion runtime benchmark so throughput and summary cadence can be sampled without ad hoc manual timing
      - [x] factor repeated OpenAI-compatible image reasoning calls into a shared vision client instead of duplicating per-game/per-runtime request code
      - [x] replace interval overlap with self-paced runtime scheduling and bounded queue pruning so long-running observation sessions stay stable
      - [ ] integrate the missing reusable perception pieces that are still required
      - [x] carry over the relevant evaluation/benchmark logic where it still serves the product goal
      - [-] add no-progress escalation and selected-frame cloud rescue
        deferred: keep this as a future optimization path, not a current implementation gate
  - [ ] P2.6 Post-Fusion Validation
    - [x] route the current `Unified Run` entry through the selected semantic game target instead of keeping it 2048-only
    - [ ] verify that all three source lines coexist in one Tauri runtime
    - [ ] verify companion behavior, expression, speech, and functional execution together
    - [ ] define the accepted post-fusion baseline

Cross-cutting rule during `P2` and later:

- when work touches runtime-owned frontend modules that are already better suited to the backend, migrate that slice during the same implementation pass where practical
- current definite migration targets are recorded in `docs/architecture/runtime-backend-migration.md`
- each migration must be followed by a focused manual regression check before it is treated as accepted

- [-] P3: Expansion After Fusion
  - [-] Minecraft transfer
    gated until `P2` source fusion is accepted
  - [-] Genshin Impact transfer test
    gated until `P2` source fusion is accepted
  - [-] broader pluginized multi-game support
    gated until `P2` source fusion is accepted
  - [-] user study
    gated until `P2` source fusion is accepted
  - [-] release packaging polish
    gated until `P2` source fusion is accepted

P2 note:

- `paimon-live` is framework heritage only
- the functional source-of-truth repos for this stage are `LLMPlay-MVP`, `VoiceL2D-MVP`, and `Video-Understanding-MVP`
- the current `Unified Run` path is useful groundwork, but it is not by itself proof that source-repo fusion is complete
- the first-pass fusion matrix is recorded in `docs/architecture/source-fusion-audit.md`
- retained / replaced / retired `LLMPlay-MVP` decisions are recorded in `docs/architecture/llmplay-retained-scope.md`
- the ASR restoration strategy is recorded in `docs/architecture/asr-migration-strategy.md`
- the companion runtime direction is recorded in `docs/architecture/companion-runtime.md`
- accepted `P2.2` baseline: `local-sherpa` microphone input -> companion pipeline -> `GPT-SoVITS` playback -> Live2D response
- cloud ASR providers remain configured options, but they are not part of the accepted `P2.2` live-validation baseline
- `P2.3` is intentionally about companion expression / motion protocol first, not about full game-plugin protocol yet
- the first pass of `P2.3` should stay semantically small and distinct: `neutral`, `happy`, `angry`, `sad`, `delighted`, `alarmed`, `dazed`
- current accepted `P2.3` sub-baseline: companion replies can already drive model-aware Live2D expression changes
- future architecture requirement: this expression-control path should ultimately be exposed through MCP rather than remain an internal-only control contract
