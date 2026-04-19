# Roadmap

Public progress tracker for `paimon-companion-tauri`.

## Status Legend

- `[x]` done
- `[ ]` not started
- `[-]` intentionally deferred

## Branch Snapshot And Working Model

This roadmap tracks product phases, but the repository has also accumulated a small set of long-lived historical branches that are worth recording explicitly.

Current surviving branch snapshot:

- `main`
  accepted stable baseline branch; `P1` is already merged here, and the accepted `P2` fusion baseline plus immediate post-`P2` performance follow-up currently also live here
- `chore/tauri-bootstrap-cleanup`
  repository/bootstrap cleanup line tied to the early host-base cleanup work
- `feat/p1-host-primitives`
  early `P1` functional-validation line centered on host primitives and the first runnable task loop
- `refactor/p2-preflight-shrink`
  pre-`P2` cleanup line used to reduce maintenance surface before the larger fusion pass
- `feat/p2-relational-core`
  main `P2` source-fusion branch where the three-source runtime merge was driven to the accepted baseline
- `perf/post-p2-runtime-profiling`
  first immediate post-`P2` branch for profiling and measurement after fusion close-out
- `perf/post-p2-latency-followup`
  second immediate post-`P2` branch for latency/stall reduction and runtime stabilization

Working branch model from this point onward:

- `main` should remain the feature-complete accepted baseline branch
- each new roadmap phase should start from `main` as its own phase branch
- smaller feature/fix branches should branch from the active phase branch and merge back there first
- only when a phase has passed its own acceptance/testing bar should that phase branch merge back into `main`

## Historical Acceptance Note

The checked items below remain checked because they satisfied the acceptance bar that was active when each milestone was closed.

Current final-version discussion has tightened the intended product definition:

- companion-first by default
- explicit delegation before gameplay takeover
- bounded GCC task scope instead of broad autonomous gameplay
- local lightweight VLM as the main perception direction
- stronger functional correctness bar for validated tasks, especially where real solving is expected

This means some already-checked roadmap items may still need follow-up work to meet the newer final-version bar.

They are not being re-opened as unfinished historical milestones.

Instead, the remaining gap is tracked as post-`P2` convergence phases on top of the accepted baseline.

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

- [x] P2: Core Repository Fusion
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
  - [x] P2.3 Companion Expression Protocol
    - [x] define a first-pass emotion taxonomy and randomized per-model expression candidate mapping
    - [x] extend the same protocol to first-pass motion selection where models expose reusable motions
    - [x] validate the real LLM path can consistently drive visible Live2D expression changes through MCP tools instead of mock-only/internal-only wiring
    - [x] migrate the accepted expression-control path toward a formal MCP-facing contract
    - [-] keep motion as an optional enhancement rather than the current acceptance gate
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
    - [x] feed the latest rolling temporal summary into the companion prompt path instead of leaving it as a lab-only side panel
      - [x] split perception prompting into general observation plus lightweight game-specific focus overlays
      - [x] add lightweight change-based frame filtering so the runtime can coalesce visually unchanged captures instead of re-describing every tick
      - [x] expose lightweight session metrics for runtime throughput, unchanged-frame ratio, and summary latency
      - [x] add a fixed-duration companion runtime benchmark so throughput and summary cadence can be sampled without ad hoc manual timing
      - [x] factor repeated OpenAI-compatible image reasoning calls into a shared vision client instead of duplicating per-game/per-runtime request code
      - [x] replace interval overlap with self-paced runtime scheduling and bounded queue pruning so long-running observation sessions stay stable
      - [-] integrate the missing reusable perception pieces that are still required
        deferred: the accepted `P2` runtime slice is in place; broader toolkit carry-over is future work, not a close-out gate
      - [x] carry over the relevant evaluation/benchmark logic where it still serves the product goal
      - [-] add no-progress escalation and selected-frame cloud rescue
        deferred: keep this as a future optimization path, not a current implementation gate
  - [x] P2.6 Post-Fusion Validation
    - [x] route the current `Unified Run` entry through the selected semantic game target instead of keeping it 2048-only
    - [x] let unified game results ask the active LLM for grounded companion follow-up text instead of relying only on hardcoded per-game copy
    - [x] add a first fusion evaluation case that samples runtime-context usage, LLM follow-up generation, and speech in one pass
    - [x] refresh the active companion observation context after unified game rounds so follow-up replies can speak from fresher runtime state
    - [x] land the first real MCP server boundary for companion control and semantic game control
    - [x] verify that all three source lines coexist in one Tauri runtime through that MCP-facing runtime path
    - [x] verify companion behavior, expression, speech, and functional execution together
    - [x] define the accepted post-fusion baseline after MCP-backed fusion is working

Cross-cutting rule during `P2` and later:

- when work touches runtime-owned frontend modules that are already better suited to the backend, migrate that slice during the same implementation pass where practical
- current definite migration targets are recorded in `docs/architecture/runtime-backend-migration.md`
- each migration must be followed by a focused manual regression check before it is treated as accepted

- [x] P3: Emotion Runtime Foundation
  Goal: build the first bounded, inspectable emotion state that actually persists across turns and runtime events instead of being treated as one-off reply flavoring.
  This phase is about establishing the first shared relational core that later companion behavior and functional follow-up can reliably consume.
  - [x] define a bounded relational core model with explicit emotion labels, intensity, hold, and decay rules
  - [x] separate immediate reaction, short carry-over mood, and output-style hints instead of treating emotion as one-shot reply decoration
  - [x] unify emotion inputs from voice turns, runtime observations, task outcomes, and recent interaction context
  - [x] keep runtime summaries as neutral observation context for later companion reasoning instead of treating summary text itself as a direct relational-core trigger
  - [x] make Live2D expression selection, reply wording, and speech delivery hints consume the same emotion state
  - [x] expose emotion state and transition reasons in runtime/debug surfaces so the loop is inspectable
  - [-] keep new game/plugin expansion out of scope unless it is strictly required to validate the emotion loop

- [x] P4: Full Emotion Companion Validation
  Goal: raise the emotion runtime from "state exists" to "companion feels coherently emotional" across chat, observation, and delegated execution.
  The acceptance bar here is a basic but believable full-emotion module rather than a loose collection of separate text/voice/expression tricks.
  This phase should prefer controllable video/scenario-based validation for companion behavior and should not wait for full functional hardening.
  - [x] keep emotion continuity across multi-turn chat, passive companion runtime, and delegated-task follow-up
  - [x] let runtime observations and summaries support companion appraisal and proactive response, while keeping the actual relational-core change tied to companion reply/appraisal rather than raw summary text
  - [x] define and validate a proactive response policy around event relevance plus a minimum silence threshold so the companion can speak up without becoming noisy
  - [x] build a small set of repeatable video/scenario validation cases for observation -> appraisal -> reply/expression consistency before relying on stronger game-solving quality
  - [x] let functional results and companion appraisal feed back into the persistent emotion state instead of resetting every turn
  - [x] validate consistency across text reply, speech output, Live2D expression, and runtime follow-up behavior
  - [x] add targeted evaluation cases for stale emotion, overreaction, failed recovery to neutral, and contradictory multimodal output
  - [x] define and meet the minimum accepted bar for a "basic full emotion module"

P3/P4 close-out:

- accepted `P3` status: the relational core is now persistent, inspectable, and shared across expression, speech, prompt context, and debug surfaces
- accepted `P4` status: proactive companion behavior is now functioning end-to-end with session entry, silence-window gating, forced post-silence check-in, restart-safe session reset, and foreground-safe behavior
- accepted validation method: debug-capture-backed manual checks plus targeted service tests, using repeatable observation/runtime scenarios rather than waiting for full gameplay hardening
- accepted known remaining gap before later polish phases:
  - proactive reply quality is now present and stable, but still not consistently strong enough to feel like an especially natural watch-along / observation-side companion
  - this is treated as a tuning/polish problem on top of an accepted `P4` baseline, not as a blocker for phase close-out

- [ ] P5: Functional Module Hardening
  Goal: after the companion-side emotional baseline is usable, harden the actual task/delegation stack so the system is not expressive but unreliable.
  This phase narrows functional work to the existing validated targets first, with clearer companion-first boundaries before any broader expansion.
  It is also the right place to formalize the heavier reflection loop instead of forcing that complexity into `P4`.
  The accepted target architecture for this phase is now explicit: `companion` and `delegated` must share the same local-vision primary perception chain, and cloud models should consume that observation context for summary, planning, reply, and follow-up instead of directly reading raw gameplay screenshots as the default functional path.
  Delegated action planning should also adapt to task type: dynamic / stochastic tasks should default to single-step observe-decide-act loops, while static / deterministic tasks may use bounded short action sequences with per-step verification and replan on mismatch.
  - [ ] raise `2048` from accepted loop validation to a more repeatable stable solving baseline
  - [ ] raise `Sokoban` from minimum semantic-action skeleton to real simple-level solving
  - [ ] land an explicit companion mode / delegated mode state with clear entry and exit conditions instead of relying on temporary unified-run style control flow
  - [ ] make companion-first and delegated-execution boundaries explicit in runtime/orchestration behavior
  - [ ] structure delegated-task follow-up around explicit verification plus memory update rather than treating action execution as the end of the loop
  - [ ] correct the current functional-path perception mismatch so `Unified Run`, `2048`, and `Sokoban` all depend on the local companion runtime observation chain rather than direct cloud screenshot analysis
  - [ ] decide which task/game capabilities stay in core MCP tools and which should become pluginized phase-by-phase
  - [-] keep broader new-game transfer outside the acceptance bar until the existing functional pair is stable

- [ ] P6: Final Convergence And FYP Packaging
  Goal: converge the now-separate emotion, runtime, and functional decisions into one final product definition that is defensible for the FYP.
  This phase is for final architecture closure, validation packaging, and write-up quality rather than opening another large implementation frontier.
  - [ ] finalize the local-small / cloud-big split for perception, reasoning, and reply paths
  - [ ] decide whether a fast local reaction layer is needed for speech/short companion reactions while keeping richer cloud replies where appropriate, or explicitly justify not implementing it
  - [ ] tighten bounded GCC scope, mode-aware orchestration, and layered memory into the final explicit product definition
  - [ ] remove stale UI buttons, debug controls, and other low-value surface actions before final acceptance
  - [ ] fix build artifacts and release packaging so generated outputs are directly usable without local dev-only adjustments
  - [ ] complete the final write-up, user study, and release packaging polish
  - [-] if time remains, land one bounded large-game micro-task demo rather than reopening broad autonomous gameplay
  - [-] treat larger-scale game transfer as optional stretch work rather than the default `P6` acceptance bar

## Appendix: P2 Historical Notes

- `paimon-live` is framework heritage only
- the functional source-of-truth repos for this stage are `LLMPlay-MVP`, `VoiceL2D-MVP`, and `Video-Understanding-MVP`
- the current `Unified Run` path is useful groundwork, but it is not by itself proof that source-repo fusion is complete
- the first-pass fusion matrix is recorded in `docs/architecture/source-fusion-audit.md`
- retained / replaced / retired `LLMPlay-MVP` decisions are recorded in `docs/architecture/llmplay-retained-scope.md`
- the ASR restoration strategy is recorded in `docs/architecture/asr-migration-strategy.md`
- the companion runtime direction is recorded in `docs/architecture/companion-runtime.md`
- the accepted `P2` close-out bar is recorded in `docs/architecture/post-fusion-baseline.md`
- accepted `P2.2` baseline: `local-sherpa` microphone input -> companion pipeline -> `GPT-SoVITS` playback -> Live2D response
- cloud ASR providers remain configured options, but they are not part of the accepted `P2.2` live-validation baseline
- `P2.3` is intentionally about companion expression / motion protocol first, not about full game-plugin protocol yet
- the first pass of `P2.3` should stay semantically small and distinct: `neutral`, `happy`, `angry`, `sad`, `delighted`, `alarmed`, `dazed`
- the current internal expression path and mock-path are useful groundwork, but they do not satisfy the intended `P2` fusion bar on their own
- the first localhost MCP server slice has landed, but it is not treated as accepted until the real LLM path and semantic game path are both validated through it
- MCP externalization is a prerequisite for `P2` close-out, not later optional polish
- accepted close-out status on `2026-04-09`: the MCP-backed fusion baseline is working end to end, including voice input, rolling runtime context, grounded follow-up text, speech, Live2D expression changes, and semantic game actions through the same local MCP boundary
- accepted known issues at close-out:
  - fusion evaluation now exposes stage timing (`action/runtime refresh/llm/speech`) plus `totalBlocking` and `totalNonBlocking`, but these are still workload wall-clock numbers rather than isolated model-only delay
  - UI stall telemetry (`averageUiStallCount`, `maxUiStallMs`) is now present, and event-log rendering pressure has been reduced, but heavy local vision + speech runs can still cause occasional responsiveness drops depending on host load
  - immediate post-`P2` work remains focused on reducing slow-round outliers and keeping MCP fusion behavior stable while performance tuning continues
