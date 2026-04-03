# 2048 Evaluation Harness

## Purpose

This document records the repeatable `2048` evaluation cases introduced in `P1.4` and the baseline reporting format used by the shared functional evaluation harness.

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

Collection date: `2026-04-03`

Session context:

- repository implementation completed and then manually validated in a real desktop session
- `pnpm build` passed
- `cargo check --manifest-path src-tauri/Cargo.toml` passed
- the functional evaluation path intentionally excludes knowledge retrieval / embedding / rerank overhead
- the functional input path still uses foreground-focused host control
- manual validation confirmed that the `2048` capture, verification, and evaluation path now produce results consistent with visible board changes

Baseline table:

| Case | Status | Success Rate | Action Validity | Avg Latency | Notes |
| --- | --- | --- | --- | --- | --- |
| `2048-auto-detect-smoke` | live run complete | 100% | 100% | 15212ms | Manual GUI validation on `2026-04-03`; visible board motion matched the reported success metric |
| `2048-selected-target-repeat` | live run complete | 100% | 100% | 14498ms | Manual GUI validation on `2026-04-03`; selected-target repeat case matched the observed board changes |

## Collection Procedure

1. Launch the app in a real desktop session.
2. Open the dedicated `功能实验` panel in the right-hand UI column.
3. Use the `Functional Evaluation Harness` section.
4. Run `2048-auto-detect-smoke` with a visible browser tab for `2048`.
5. Run `2048-selected-target-repeat` after manually confirming the target window.
6. Record the latest case summaries and compare them against visible board changes.
