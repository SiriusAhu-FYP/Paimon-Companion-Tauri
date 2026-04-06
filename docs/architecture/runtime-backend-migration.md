# Runtime Backend Migration Checklist

This document records the runtime modules that are better moved from the frontend into the Rust/Tauri backend over time.

It is not a one-shot refactor plan.

Rule of use:

- when implementation work touches one of these modules in a meaningful way, evaluate whether that slice should move to the backend during the same change
- after each such migration, run manual regression checks before treating the move as accepted

## Definite Migration Targets

### `UnifiedRuntimeService`

Current location:

- `src/services/unified/unified-runtime-service.ts`

Why it belongs in the backend:

- it is already a runtime state machine, not a UI helper
- it coordinates voice input, gameplay action, companion speech, and emotion changes in one execution path
- it is the closest current precursor to the future MCP-facing runtime boundary

Migration checklist:

- [ ] move run orchestration state and transitions out of the frontend service
- [ ] expose the backend runtime state to the frontend as read-only status
- [ ] keep UI controls as thin triggers rather than logic owners
- [ ] manually test `Unified Run` end-to-end after migration

### `OrchestratorService`

Current location:

- `src/services/orchestrator/orchestrator-service.ts`

Why it belongs in the backend:

- it is a host-action executor, not presentation logic
- it already owns task lifecycle, host action sequencing, and task logs
- future timeout, retry, queueing, and MCP tool dispatch fit this layer better in the backend

Migration checklist:

- [ ] move task execution and task history ownership into the backend
- [ ] keep only task display and trigger controls in the frontend
- [ ] preserve capture-before / action / capture-after behavior
- [ ] manually test target selection, capture, focus, key, and mouse flows after migration

### Game Runtime Loops

Current examples:

- `src/services/games/game-2048-service.ts`
- future `Sokoban` runtime

Why they belong in the backend:

- they combine perception, decision, action, and verification into game runtimes
- they should become the execution side of future semantic game tools
- keeping them in the frontend would make game-plugin runtime logic harder to standardize

Migration checklist:

- [ ] move per-step execution and verification loops out of the frontend
- [ ] keep game-specific UI panels as inspection and trigger surfaces only
- [ ] preserve current validation behavior for `2048`
- [ ] manually test the affected game loop after each migration

### Future Local-Description Queue And Cloud-Summary Scheduler

Current status:

- planned, not yet implemented

Why it belongs in the backend:

- it is a long-running runtime queue, not a UI concern
- it will own sampling cadence, rolling windows, summary retention, and scheduling
- it should sit close to the future MCP-facing runtime and not depend on frontend lifecycle

Migration checklist:

- [ ] implement the queue and scheduler outside the frontend first
- [ ] expose queue state to the frontend as diagnostics only
- [ ] manually test summary cadence and state visibility after the first implementation

## Not Definite Migration Targets

These should stay frontend-led unless a later technical constraint forces a change:

- `CharacterService`
- `PipelineService`
- Live2D rendering and stage presentation
- control-panel interaction logic
- debug and inspection panels

Reason:

- these are tightly coupled to UI state, audio playback, or model presentation
- moving them wholesale to the backend would add complexity without a clear runtime payoff

## Manual Regression Rule

After any migration covered by this checklist:

- tell the user which module moved
- ask the user to run a focused manual regression on the affected path
- do not treat the migration as fully accepted until that manual check passes
