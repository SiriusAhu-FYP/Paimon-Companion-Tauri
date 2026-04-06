# Companion Runtime Architecture

This document records the intended runtime direction after the accepted `P2.3` expression-linkage baseline.

## Goal

The product should let the companion do both of these without forcing a rigid user-visible reply format:

- give emotional support based on what is happening in the game
- temporarily take over some gameplay tasks when needed

The preferred mechanism is:

- natural-language companion reply for the player
- MCP tool calls for emotion changes and gameplay actions

In other words, structured control should live in the tool layer, not in the visible reply text.

## Runtime Layers

### 1. Local Fast Vision Layer

Use a low-latency local VLM deployment as the first perception stage.

Current intended baseline:

- local node runs in WSL or another low-latency Linux device
- model family baseline: `Qwen3-VL-2B-Instruct`
- target operating mode: fast frame description rather than deep final reasoning

Reference baseline from `Video-Understanding-MVP`:

- the MVP validated a low-latency local VLM endpoint pattern
- the MVP also explored sub-second capture intervals, but production runtime should treat `1fps` as an upper-bound stress case rather than a fixed requirement

For this Tauri product, the practical target is:

- tune the local description rate from real measurements
- start from an `8-10s` rolling summary window
- retain at least the latest `1min` of summarized context for the cloud model

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

This layer should own the higher-cost reasoning, not the local VLM.

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
