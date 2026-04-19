# Companion Runtime Architecture

This document records the intended runtime direction after the accepted `P2.3` expression-linkage baseline.

Current implementation note:

- the first `P2.5` slice now exists as an experimental companion runtime inside the Tauri app
- it can capture a selected target, ask a local OpenAI-compatible vision node for short frame descriptions, and periodically summarize the latest rolling window through the active cloud LLM profile
- the latest retained temporal summary is now also exposed to the companion prompt path, so this runtime is no longer isolated to the lab panel
- the unified game runtime can now also ask the active LLM for a short grounded follow-up after a verified game round, using the same companion/runtime context instead of only speaking hardcoded per-game text
- when the companion runtime is already observing the same target, unified game rounds now refresh that observation context before generating the follow-up so the reply can speak from fresher state
- the current slice also includes lightweight change-based filtering, so nearly identical consecutive frames can be coalesced instead of always triggering a fresh local-VLM description
- the control surface now exposes lightweight session metrics such as capture count, unchanged-frame ratio, and average summary latency
- the control surface also provides fixed-duration benchmark runs so throughput and summary cadence can be sampled without hand-timing a session
- the runtime scheduler now uses self-paced capture/summary loops plus bounded queue pruning instead of naive overlapping fixed intervals
- the runtime now waits for the local vision node to report ready before the first observation tick, instead of failing immediately during long cold starts
- this is accepted only as an initial runtime slice, not as the finished `Video-Understanding-MVP` fusion endpoint

## Goal

The product should let the companion do both of these without forcing a rigid user-visible reply format:

- give emotional support based on what is happening in the game
- temporarily take over some gameplay tasks when needed

The preferred mechanism is:

- natural-language companion reply for the player
- MCP tool calls for emotion changes and gameplay actions

In other words, structured control should live in the tool layer, not in the visible reply text.

This applies to both user-facing modes:

- `companion`
- `delegated`

Both modes should share the same local-vision primary perception path. The difference between them is not which visual stack is used, but how the cloud layer consumes the same observation context:

- `companion`: reply / proactive / emotional support
- `delegated`: task plan / action decision / grounded follow-up

Delegated planning should not be one-size-fits-all. The cloud layer should adapt action granularity to the task:

- dynamic or stochastic tasks, such as `2048`, should default to single-step closed loops: observe -> decide one move -> execute -> verify -> observe again
- static or deterministic tasks, such as `Sokoban`, may return a bounded short action sequence, but every step still requires verification and the remaining sequence should be discarded if the observed state diverges

## Runtime Layers

### 1. Local Fast Vision Layer

Use a low-latency local VLM deployment as the first perception stage.

Current intended baseline:

- local node runs in WSL or another low-latency Linux device
- model family baseline: `Qwen3-VL-2B-Instruct`
- target operating mode: fast frame description rather than deep final reasoning
- the local vLLM node should be started from a local snapshot path in offline mode whenever possible, so cold starts do not depend on remote HuggingFace metadata availability

Reference baseline from `Video-Understanding-MVP`:

- the MVP validated a low-latency local VLM endpoint pattern
- the MVP also explored sub-second capture intervals, but production runtime should treat `1fps` as an upper-bound stress case rather than a fixed requirement

For this Tauri product, the practical target is:

- tune the local description rate from real measurements
- start from an `8-10s` rolling summary window
- retain at least the latest `1min` of summarized context for the cloud model
- keep perception prompting layered as `general observation + game-specific focus overlay` rather than one globally game-biased prompt

### 2. Rolling Description Queue

The local VLM should not be treated as the final decision maker.

Its job is to produce short scene descriptions for recent frames or keyframes.

Those descriptions should flow into a fixed-length rolling queue:

- the queue stores recent local descriptions
- the queue is summarized every few seconds
- the queue window should start from `8-10s`
- the summary history should preserve at least the latest `1min`

This layer exists to smooth user experience:

- local perception remains responsive
- cloud reasoning can be slower without making the companion feel blind

### 3. Cloud Reasoning Layer

The cloud model receives:

- the latest local frame descriptions from the current queue window
- one or more recent summary turns
- current task context when available

Its job is to produce:

- companion-facing natural language
- MCP tool calls when emotion or gameplay actions are needed
- higher-level temporal understanding of what is happening
- delegated-mode planning / action decisions based on the same local observation context

This layer should own the higher-cost reasoning, not the local VLM.

The cloud layer should not become the default raw-image reader for gameplay experiments. In the intended `P5` shape, functional task buttons should also depend on the same local companion-runtime observation chain.

### 4. MCP Control Layer

The long-term system boundary should use MCP.

This is important for two reasons:

- the LLM can use tool metadata to understand what actions exist and when to call them
- the control surface stays reusable across companion expression control and gameplay control

Practical implication:

- the visible reply can stay natural
- emotion changes and gameplay actions do not need to be encoded in a rigid reply format
- the structured part lives in MCP tool calls instead

Current architectural direction:

- `companion.*` tools for emotion, expression, motion, and related state
- `game.*` tools for semantic gameplay actions
- `host.*` tools for low-level capture/focus/input when needed

The current in-app event bridge is accepted only as a transitional implementation.

The future public contract should be MCP.

## Semantic Game Control

The model should not be forced to think in raw low-level input steps when the game supports a more semantic abstraction.

Example:

- preferred: `open_inventory`
- not preferred as the main reasoning unit: `press E`, `move mouse to x,y`, `click`

This means game control should be layered:

1. semantic action chosen by the LLM through MCP
2. plugin/config layer translates semantic action into host operations
3. host layer performs low-level input only as the execution backend

## Plugin Direction

The long-term product direction remains lightweight game adaptation.

For a new game, the preferred integration surface is a small game package that mostly defines:

- action names
- action-to-host mappings
- game rules and affordances
- state cues / recognition hints
- prompt fragments based on a shared template

This should let the project move toward "small config package" game onboarding instead of per-game core rewrites.

## Deferred Items

These ideas are valid but not part of the current implementation scope:

- cloud escalation when the local VLM detects no progress for a while
- special cloud rescue requests on selected frames
- formal no-progress policies for adaptive escalation

They should stay documented as future work, not current deliverables.
