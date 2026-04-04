# 2048 Evaluation Harness

## Purpose

This document records the accepted `2048` evaluation baseline for `P1`.

## Cases

### `2048-auto-detect-smoke`

- target mode: auto-detect
- iterations: 3
- goal: discover a likely `2048` window and complete one validated move per run

### `2048-selected-target-repeat`

- target mode: selected target
- iterations: 5
- goal: measure repeated single-step stability on a user-confirmed `2048` window

## Metrics

Every case reports:

- success rate: `boardChanged / totalRuns`
- action validity rate: `validActions / totalRuns`
- average latency
- median latency

Action validity means:

- a move was selected
- the move existed in the model or heuristic priority list
- the post-action screenshot showed a board change above the threshold

## Accepted Baseline

Collection date: `2026-04-03`

Validation context:

- `pnpm build` passed
- `cargo check --manifest-path src-tauri/Cargo.toml` passed
- manual desktop validation confirmed visible board motion matched the reported result
- the functional path excludes knowledge retrieval / embedding / rerank overhead
- the host input path remains foreground-oriented

| Case | Status | Success Rate | Action Validity | Avg Latency |
| --- | --- | --- | --- | --- |
| `2048-auto-detect-smoke` | live run complete | 100% | 100% | 15212ms |
| `2048-selected-target-repeat` | live run complete | 100% | 100% | 14498ms |

## Re-run Procedure

1. Launch the app in a real desktop session.
2. Open the `功能实验` panel in the right-hand UI column.
3. Use the `Functional Evaluation Harness` section.
4. Run `2048-auto-detect-smoke`.
5. Run `2048-selected-target-repeat`.
6. Compare the reported metrics against visible board changes.
