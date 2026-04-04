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
  - [ ] P2.2 `VoiceL2D-MVP` Completion
    - [x] define ASR migration strategy around pluggable providers instead of bundled desktop weights
    - [x] add ASR provider/profile configuration surface in settings
    - [ ] restore a real voice-input path instead of manual/mock-only ASR
    - [ ] support at least one cloud ASR provider and one local-runtime provider
    - [ ] support local model management via locate-existing-path or post-install download flow
    - [ ] restore microphone / VAD / ASR behavior needed for end-to-end interaction
    - [ ] validate voice -> LLM -> TTS -> Live2D end-to-end in the Tauri host
  - [ ] P2.3 `LLMPlay-MVP` Completion
    - [ ] confirm the `2048` command-to-action loop fully covers the intended MVP scope
    - [ ] decide which `LLMPlay-MVP` concepts are intentionally reimplemented instead of copied literally
    - [ ] either merge the missing MVP capabilities or explicitly retire them in docs
  - [ ] P2.4 `Video-Understanding-MVP` Completion
    - [ ] decide which video-understanding pipeline pieces belong in the Tauri runtime
    - [ ] integrate the missing reusable perception pieces that are still required
    - [ ] carry over the relevant evaluation/benchmark logic where it still serves the product goal
  - [ ] P2.5 Post-Fusion Validation
    - [ ] verify that all three source lines coexist in one Tauri runtime
    - [ ] verify companion behavior, expression, speech, and functional execution together
    - [ ] define the accepted post-fusion baseline

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
- the ASR restoration strategy is recorded in `docs/architecture/asr-migration-strategy.md`
