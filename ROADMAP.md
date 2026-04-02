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

- [ ] P1: Functional Core Validation
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
  - [x] P1.5 Stardew Valley Extension
    - [x] define first small task set
    - [x] adapt perception prompts/context
    - [x] adapt control and verification logic
    - [x] run the same evaluation flow used in `2048`

- [ ] P1.5+: Support Systems
  - [-] connect knowledge retrieval to functional tasks where useful
    deferred: current functional loop is latency-bound, so embedding / retrieval / rerank stay out of the real-time path
  - [ ] add better debug panels for capture / action / verification
  - [ ] add reusable task templates for new games

- [ ] P2: Unified System Validation
  - [ ] P2.1 Relational Core Integration
    - [ ] integrate proactive companion behavior into the functional loop
    - [ ] expression mapping aligned with task/game state
    - [ ] speech output path for unified runs
    - [ ] voice input path where needed for interaction testing
  - [ ] P2.2 Minecraft Transfer
    - [ ] define initial Minecraft task set
    - [ ] adapt perception for high-DOF play
    - [ ] adapt action tools for Minecraft controls
    - [ ] stabilize long-horizon planning and recovery
  - [ ] P2.3 User Study
    - [ ] define Group A functional-only condition
    - [ ] define Group B full unified-system condition
    - [ ] prepare small-sample study materials
    - [ ] collect results
    - [ ] summarize companionship / proactivity / workload outcomes

- [ ] Stretch
  - [ ] Genshin Impact transfer test
  - [ ] broader pluginized multi-game support
  - [ ] release packaging polish
