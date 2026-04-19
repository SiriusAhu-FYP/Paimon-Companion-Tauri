# Local Vision Unified Path

This note records the corrected `P5` target after the functional-path mismatch was re-evaluated.

## Target Shape

Both interaction modes must share the same primary perception path:

- `companion`
- `delegated`

That shared path is:

1. local companion runtime continuously watches the selected target
2. local fast vision produces short frame descriptions
3. rolling summaries compress recent observations
4. cloud models consume that observation context for:
   - periodic summary-driven companion replies
   - proactive comments
   - delegated planning / action decisions
   - delegated follow-up and next-step hints

The cloud layer is not the default raw-image reader for gameplay experiments.

## Action Granularity Rule

Shared local perception does not imply a single planning style for every task.

- dynamic or stochastic tasks should use single-step delegated decisions by default
- static or deterministic tasks may use bounded short plans

Current intended examples:

- `2048`: one cloud-decided move per round, then re-observe
- `Sokoban`: a short cloud-decided move sequence with per-step verification

For bounded short plans:

- the sequence length should stay small
- each step must still be verified
- if the observed state diverges, the remaining plan is invalid and the system must re-observe before continuing

## Current Correction

The repository historically drifted into a split state:

- companion runtime used local vision plus cloud summarization
- functional gameplay experiments still used direct cloud screenshot analysis

That split is no longer accepted as the intended architecture.

`Unified Run`, `2048`, and `Sokoban` should all require:

- a selected target
- the companion runtime running
- the companion runtime observing the same target
- fresh local observation context

If those conditions are not met, the functional path should fail clearly instead of silently falling back to a separate cloud-image path.

## Planner / Solver Role

`planner` / `solver` remain useful delegated-mode concepts, but the main path should treat them as cloud-side reasoning behavior over local observation context, not as a separate local decision engine that bypasses the shared perception chain.

Existing local planner / solver code may remain in the repository as:

- non-default auxiliary logic
- debugging / comparison helpers
- possible future fallback candidates

But they are not the accepted default `P5` decision path.
