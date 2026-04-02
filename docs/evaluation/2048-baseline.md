# 2048 Evaluation Harness

## Purpose

This document records the repeatable `2048` evaluation cases introduced in `P1.4` and the baseline reporting format used by the control panel harness.

## Fixed Cases

### `2048-auto-detect-smoke`

- Target mode: auto-detect
- Iterations: 3
- Goal: verify that PAIMON can discover a likely `2048` window and complete one validated move per run

### `2048-selected-target-repeat`

- Target mode: selected target
- Iterations: 5
- Goal: measure repeated single-step stability on a user-confirmed `2048` window

## Metrics

Every case reports:

- success rate: `boardChanged / totalRuns`
- action validity rate: `validActions / totalRuns`
- average latency: mean wall-clock time per run
- median latency: median wall-clock time per run

Action validity is defined as:

- a move was selected
- the selected move existed in the model or heuristic priority list
- the post-action screenshot showed a board change above the current threshold

## Current Baseline Status

Collection date: `2026-04-02`

Session context:

- repository implementation completed in a terminal-only coding session
- `pnpm build` passed
- `cargo check --manifest-path src-tauri/Cargo.toml` passed
- no live GUI evaluation run was executed from this terminal session

Baseline table:

| Case | Status | Success Rate | Action Validity | Avg Latency | Notes |
| --- | --- | --- | --- | --- | --- |
| `2048-auto-detect-smoke` | pending live run | n/a | n/a | n/a | Requires an actual visible `2048` window during an app session |
| `2048-selected-target-repeat` | pending live run | n/a | n/a | n/a | Requires a manually confirmed target inside the app |

## Collection Procedure

1. Launch the app in a real desktop session.
2. Open the control panel.
3. Use the `2048 Evaluation Harness` section.
4. Run `2048-auto-detect-smoke` with a visible browser tab for `2048`.
5. Run `2048-selected-target-repeat` after manually confirming the target window.
6. Copy the latest case summaries and replace the `pending live run` rows above.
