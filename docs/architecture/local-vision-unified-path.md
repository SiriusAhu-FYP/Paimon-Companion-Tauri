# Local Vision Unified Path

This note records the corrected `P5` target after the functional-path mismatch was re-evaluated.

## Target Shape

The accepted runtime now uses two explicit paths with clear role boundaries:

- `companion` path (default): local observation first, then cloud expression/reasoning
- `delegation` path (authorized task execution): screenshot evidence to cloud decision chain

Companion path:

1. local companion runtime continuously watches the selected target
2. local fast vision produces short frame descriptions
3. rolling summaries compress recent observations
4. cloud models consume that observation context for:
   - periodic summary-driven companion replies
   - proactive comments
   - emotional support and narration continuity

Delegation path:

1. per-round capture provides direct screenshot evidence (`before` / `after`)
2. cloud vision drives `Mission Analyst -> Operations Planner -> Progress Evaluator`
3. follow-up and next-step hints are generated from grounded round evidence

In delegation mode, local observation summaries are not the required primary decision input.
However, local vision service availability is still required at mode preflight, and local vision can still be used for locator-assisted mouse operations.

## Action Granularity Rule

Shared local perception does not imply a single planning style for every task.

- dynamic or stochastic tasks should use single-step Delegation Mode decisions by default
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
- delegation/runtime tasks used direct cloud screenshot analysis

That split is now the accepted architecture, but with explicit constraints:

- companion remains local-observation-first
- delegation remains screenshot-evidence-first
- both modes require selected target + local vision connectivity preflight
- locator-sensitive actions may use local vision as bounded assistance

## Planner / Solver Role

`planner` / `solver` remain useful Delegation Mode concepts, but the main path should treat them as cloud-side reasoning behavior over screenshot evidence and verification context, not as a separate local decision engine.

Existing local planner / solver code may remain in the repository as:

- non-default auxiliary logic
- debugging / comparison helpers
- possible future fallback candidates

But they are not the accepted default `P5` decision path.
