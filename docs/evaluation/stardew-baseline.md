# Stardew Valley Extension

## Purpose

This document records the first small Stardew Valley task set introduced in `P1.5`, the adapted perception/control assumptions, and the evaluation cases wired into the shared harness.

## First Small Task Set

### `reposition`

- Goal: choose one safe micro-movement using `W/A/S/D`
- Perception: screenshot-guided action ordering, with heuristic fallback
- Verification: confirm a visible scene change above the movement threshold

### `open-inventory`

- Goal: toggle the inventory open
- Control: send `E`
- Verification: confirm a strong UI change

### `close-menu`

- Goal: dismiss a current menu layer
- Control: send `Escape`
- Verification: confirm the scene changed back toward gameplay

## Perception Adaptation

The Stardew extension uses a dedicated vision prompt that differs from the 2048 loop:

- it asks for safe micro-repositioning rather than board optimization
- it constrains action choice to `W/A/S/D`
- it biases toward one-step movement instead of long-horizon pathing

When image analysis is unavailable, the fallback strategy is:

- `W -> A -> D -> S`

## Evaluation Cases

The shared functional evaluation harness now includes:

### `stardew-auto-detect-reposition`

- Target mode: auto-detect
- Iterations: 3
- Goal: discover a likely Stardew target and validate one reposition step per run

### `stardew-selected-inventory-toggle`

- Target mode: selected target
- Iterations: 4
- Goal: measure repeated inventory-toggle stability on a manually confirmed target

## Current Baseline Status

Collection date: `2026-04-02`

Session context:

- repository implementation completed in a terminal-only coding session
- `pnpm build` passed
- `cargo check --manifest-path src-tauri/Cargo.toml` passed
- the functional evaluation path intentionally excludes knowledge retrieval / embedding / rerank overhead
- no live GUI evaluation run was executed from this terminal session

Baseline table:

| Case | Status | Success Rate | Action Validity | Avg Latency | Notes |
| --- | --- | --- | --- | --- | --- |
| `stardew-auto-detect-reposition` | pending live run | n/a | n/a | n/a | Requires a visible Stardew gameplay window |
| `stardew-selected-inventory-toggle` | pending live run | n/a | n/a | n/a | Requires a manually confirmed target inside the app |

Close-out note:

- the `2026-04-03` P1 manual validation pass focused on the accepted `2048` baseline
- Stardew live validation was intentionally deferred and should be resumed only when that extension becomes an active scope again

## Collection Procedure

1. Launch the app in a real desktop session with Stardew Valley visible.
2. Open the control panel.
3. Use the `Stardew Valley 扩展` section to verify target detection and the first task set.
4. Use the `Functional Evaluation Harness` section and run the two Stardew cases.
5. Replace the `pending live run` rows above with the latest measured values.
