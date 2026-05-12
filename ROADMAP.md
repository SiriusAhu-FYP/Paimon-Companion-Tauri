# Roadmap

Public progress tracker for `paimon-companion-tauri`.

## Current Snapshot For Reviewers

- `P1` to `P6` are accepted as complete milestones.
- Current active phase is `P7: Repository And Documentation`.
- `P7` scope stays on repository clarity, documentation polish, and final-scope readability.
- Recommended first-read order: `README.md` -> `ROADMAP.md` -> `docs/architecture.md`.

## Status Legend

- `[x]` done
- `[ ]` not started
- `[-]` intentionally deferred

## Historical Note

The checked items below remain checked because they satisfied the acceptance bar active at the time.

Later scope tightening is tracked in later phases without reopening earlier milestones.

- [x] P0: Repository And Host Baseline
  - [x] Create `paimon-companion-tauri` from the reusable Tauri host base
  - [x] Rename app/package identity away from `paimon-live`
  - [x] Remove inherited docs and experiment baggage from the initial fork
  - [x] Remove livestream-only external event injection layer
  - [x] Keep the knowledge module as a support capability
  - [x] move planning/report material out of tracked repo content
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

- [x] P2: Core Repository Fusion
  - [x] groundwork: a thin unified runtime layer already exists for `2048` validation
  - [x] P2.1 Source Audit And Gap Mapping
    - [x] map `LLMPlay-MVP` features to the current Tauri codebase
    - [x] map `VoiceL2D-MVP` features to the current Tauri codebase
    - [x] map `Video-Understanding-MVP` features to the current Tauri codebase
    - [x] classify each capability as merged / partial / missing / replaced
    - [x] document the accepted replacement decisions where implementation shape has changed
  - [x] P2.2 `VoiceL2D-MVP` Completion
    - [x] define the ASR migration strategy around pluggable providers
    - [x] add ASR provider/profile configuration surface in settings
    - [x] restore a real voice-input path
    - [x] support at least one cloud ASR provider and one local-runtime provider
    - [x] keep GPT-SoVITS as the accepted local TTS baseline from `VoiceL2D-MVP`
    - [x] align accepted ASR providers with the current product plan: `local-sherpa`, `volcengine`, `aliyun`
    - [x] bundle the default local ASR model route around `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`
    - [x] restore microphone capture, VAD segmentation, and playback-time mic lock
    - [x] validate voice -> LLM -> TTS -> Live2D end-to-end in the Tauri host
    - [-] improve mixed-language recognition inside a single utterance
      deferred: the current bilingual local ASR baseline is acceptable for Chinese or English utterances, but intra-sentence code-switching is not yet treated as a solved requirement
  - [x] P2.3 Companion Expression Protocol
    - [x] define a first-pass emotion taxonomy and randomized per-model expression candidate mapping
    - [x] extend the same protocol to first-pass motion selection where models expose reusable motions
    - [x] validate visible Live2D expression changes through the real LLM and MCP tool path
    - [x] migrate the accepted expression-control path toward a formal MCP-facing contract
    - [-] keep motion as an optional enhancement outside the current acceptance gate
      deferred: expression linkage is accepted for `P2`; motion remains an optional follow-up enhancement
  - [x] P2.4 `LLMPlay-MVP` Completion
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
  - [x] P2.5 `Video-Understanding-MVP` Completion
    - [x] define the first local-fast / cloud-summarize companion runtime slice around `Qwen3-VL-2B-Instruct` style local frame descriptions plus cloud temporal reasoning
    - [x] start from `8-10s` rolling local-description windows and preserve at least the latest `1min` of summary context
    - [x] feed the latest rolling temporal summary into the companion prompt path
      - [x] split perception prompting into general observation plus lightweight game-specific focus overlays
      - [x] add lightweight change-based frame filtering so the runtime can coalesce visually unchanged captures and avoid re-describing every tick
      - [x] expose lightweight session metrics for runtime throughput, unchanged-frame ratio, and summary latency
      - [x] add a fixed-duration companion runtime benchmark so throughput and summary cadence can be sampled without ad hoc manual timing
      - [x] factor repeated OpenAI-compatible image reasoning calls into a shared vision client
      - [x] replace interval overlap with self-paced runtime scheduling and bounded queue pruning so long-running observation sessions stay stable
      - [-] integrate the missing reusable perception pieces that are still required
        deferred: the accepted `P2` runtime slice is in place; broader toolkit carry-over stays in future work
      - [x] carry over the relevant evaluation/benchmark logic where it still serves the product goal
      - [-] add no-progress escalation and selected-frame cloud rescue
        deferred: keep this as a future optimization path outside the current implementation gate
  - [x] P2.6 Post-Fusion Validation
    - [x] route `Unified Run` through the selected semantic game target and produce grounded companion follow-up text
    - [x] add a first fusion evaluation case that samples runtime-context usage, LLM follow-up generation, and speech in one pass
    - [x] refresh the active companion observation context after unified game rounds so follow-up replies can speak from fresher runtime state
    - [x] land the first real MCP server boundary for companion control and semantic game control
    - [x] verify that all three source lines coexist in one Tauri runtime with companion behavior, expression, speech, and functional execution on the same MCP-facing path
    - [x] define the accepted post-fusion baseline after MCP-backed fusion is working

- [x] P3: Emotion Runtime Foundation
  Goal: build the first bounded, inspectable emotion state that actually persists across turns and runtime events.
  This phase is about establishing the first shared relational core that later companion behavior and functional follow-up can reliably consume.
  - [x] define a bounded relational core model with explicit emotion labels, intensity, hold, and decay rules
  - [x] separate immediate reaction, short carry-over mood, and output-style hints into distinct layers
  - [x] unify emotion inputs from voice turns, runtime observations, task outcomes, and recent interaction context
  - [x] keep runtime summaries as neutral observation context for later companion reasoning
  - [x] make Live2D expression selection, reply wording, and speech delivery hints consume the same emotion state
  - [x] expose emotion state and transition reasons in runtime/debug surfaces so the loop is inspectable
  - [-] keep new game/plugin expansion out of scope unless it is strictly required to validate the emotion loop

- [x] P4: Full Emotion Companion Validation
  Goal: raise the emotion runtime from "state exists" to "companion feels coherently emotional" across chat, observation, and Delegation Mode execution.
  The acceptance bar here is a basic but believable full-emotion module with coherent text, voice, and expression behavior.
  This phase should prefer controllable video/scenario-based validation for companion behavior and move forward without waiting for full functional hardening.
  - [x] keep emotion continuity across multi-turn chat, passive companion runtime, and Delegation Mode follow-up
  - [x] let runtime observations and summaries support companion appraisal and proactive response, with relational-core changes tied to companion reply/appraisal
  - [x] define and validate a proactive response policy with event relevance gating and a minimum silence threshold
  - [x] build a small set of repeatable video/scenario validation cases for observation -> appraisal -> reply/expression consistency before relying on stronger game-solving quality
  - [x] let functional results and companion appraisal feed back into the persistent emotion state across turns
  - [x] validate consistency across text reply, speech output, Live2D expression, and runtime follow-up behavior
  - [x] add targeted evaluation cases for stale emotion, overreaction, failed recovery to neutral, and contradictory multimodal output
  - [x] define and meet the minimum accepted bar for a "basic full emotion module"
  - [-] proactive reply quality still needs tuning even though the accepted `P4` baseline is in place

- [x] P5: Functional Module Hardening
  Goal: after the companion-side emotional baseline is usable, harden the actual task/delegation stack into a reliable system.
  The accepted Delegation Mode architecture is a three-role chain: `Mission Analyst -> Operations Planner -> Progress Evaluator`, with a shared scratchpad for inter-role context passing.
  Browser and game Delegation Mode tasks share the same unified loop; scenario differences are profile-driven through TOML plug-and-play config.
  Click localization uses local Qwen3-VL-2B-Instruct as the primary path, with multi-sample consensus correction (`resolve_locator_consensus`).
  Focus supports a Delegation Mode viewport policy (`16:9` reduced-tier physical resize).
  - [x] refactor Delegation Mode loop to `Mission Analyst -> Operations Planner -> Progress Evaluator` and enable Mission Analyst thinking mode
  - [x] unify browser and `2048/Sokoban` Delegation Mode entry to one loop with profile-driven differences
  - [x] apply Delegation Mode focus viewport policy (`16:9` reduced-tier physical resize) in TS/Rust command chain
  - [x] add lightweight non-DOM click localization via local Qwen3-VL with multi-sample consensus correction
  - [x] land explicit Companion Mode / Delegation Mode state with clear entry and exit conditions
  - [x] make companion-first and Delegation Mode boundaries explicit in runtime/orchestration behavior
  - [x] structure Delegation Mode follow-up around explicit verification (Evaluator expectedMet/reflection loop) plus scratchpad memory update
  - [x] complete the generic Delegation Mode browser loop through `host.*` MCP tools and TOML task configs
  - [x] keep control panel as the only formal interaction entry; workbench is debug-only
  - [x] add Delegation Mode preflight health check (target window selected + local vision reachable)
  - [x] stabilize TTS pipeline: speechChain reset, failure queuing, opening reply deduplication
  - [x] add task completion/failure summary with TTS broadcast
  - [x] upgrade event logging: string truncation, data URL stripping, high-frequency event throttling
  - [x] add delegation timeline visualization panel (dock-level tab with per-round decision cards)
  - [-] raise `2048` / `Sokoban` to higher solving baselines — deferred to P6 if needed
  - [-] keep broader new-game transfer outside the acceptance bar until the existing functional pair is stable
  - [-] known issues deferred to P6: events.jsonl bloat, cookie/popup auto-bypass, cloud LLM latency, and preflight voice cue recordings

- [x] P6: Memory, Stability, And Final Runtime Convergence
  Goal: finish the last round of core product work so the system has a defensible final runtime shape.
  This phase is a core implementation phase, focused on memory, stability hardening, and the final local-small / cloud-big split.
  - [x] finalize the local-small / cloud-big split for the current product scope
    - Companion Mode: local observation first, cloud temporal summary/reply second
    - Delegation Mode: screenshot-driven cloud mission/planner/evaluator as the primary path; local vision stays as locator fallback
  - [x] complete the Companion Mode short-term memory loop for video understanding (rolling frame batches -> cloud summaries -> summary carry-over across later requests)
  - [x] deliver a file-backed pseudo-long-term memory prototype: session-end compression with timestamped structured entries (scene/task, key entities, event result, summary)
  - [x] keep Delegation Mode memory scope bounded in P6: one async memory retrieval after mission confirmation + event-level writeback (what/when/result/optional attempts), without per-round auto-recall
  - [x] support explicit long-term recall in P6 (user asks for past events, optional light session-start pre-read), while deferring fully automatic trigger-based recall to future work
  - [-] keep local fast-reaction language layer in Future Work for now; leave it outside the P6 acceptance path
  - [x] complete events.jsonl image reference-only storage (event payload data URLs are persisted as file refs, base64 removed from JSONL)
  - [-] keep site-specific cookie/popup bypass logic out of P6; stay within the GCC boundary and rely on generic host.* flow
  - [x] add browser cookie-handling policy into generic delegation profile (prefer reject, else essential/necessary, never accept-all unless explicitly requested)
  - [x] add unified log lifecycle management (TTL, size caps, session export baseline)
  - [x] finish Delegation Mode continuity quality work (grounded follow-up, cross-round reasoning continuity, and stable position/state narration)
  - [x] tighten bounded GCC scope, mode-aware orchestration, and layered memory into the final explicit product definition
  - [x] strengthen delegation route-state tracking with committed-route continuity, failure diagnosis, and reusable route lessons across retries
  - [x] add long-sequence Sokoban planning/execution mode with reset-based recovery and failed-prefix route learning
  - [x] turn debug capture into an exportable evidence pipeline with image refs, session export, scratchpad mirroring, and lifecycle cleanup
  - [x] add workbench-grade delegation inspection for live timeline, route diagnosis, and scratchpad-backed execution review
  - [-] keep complex dynamic game delegation (for example PVZ-like scenarios) in Future Work, outside the `P6` acceptance bar

- [ ] P7: Repository And Documentation
  Goal: leave the repository in a clean, defensible, and review-friendly FYP state.
  This phase focuses on documentation polish, structure cleanup, and making the final project scope understandable from the codebase itself.
  - [x] replace stale historical docs with a minimal current `docs/architecture.md`
  - [ ] rewrite `README.md` as a clear project introduction
  - [ ] tighten `ROADMAP.md` wording and checklist style so the phase record reads consistently end to end
  - [ ] clarify the boundary between stable mainline scope and branch-only or machine-local experimental/harness surfaces
  - [x] preserve `Workbench`, `Timeline`, and `Event Log` as intentional research/verification surfaces
