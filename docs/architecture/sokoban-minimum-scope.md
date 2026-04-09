# Sokoban Minimum Scope

This document defines the retained minimum scope for bringing `Sokoban` back during `P2.4`.

The purpose of `Sokoban` is not content breadth.

It is a fast reasoning-quality validation game that complements `2048`.

## Why It Stays In Scope

- it validates planning quality better than `2048`
- it gives faster success/failure feedback than open-world games
- it is small enough to use as a repeatable reasoning benchmark

## Minimum Acceptance Scope

### Target Window

- allow manual target selection first
- optional auto-detection can come later

### Action Set

Minimum semantic action set:

- `move_up`
- `move_down`
- `move_left`
- `move_right`

For early implementation, these may still map one-to-one to directional input.

The important part is that they are already exposed as semantic game actions rather than raw host input in the design.

### Observation

The runtime must be able to:

- capture the current board state
- identify player, boxes, and target tiles well enough to reason over a small puzzle
- detect whether the board changed after an action sequence

### Reflection

The runtime must keep enough history to answer:

- what plan was attempted
- whether the board changed as expected
- whether the last plan repeated a failure

### Success Condition

Minimum success criterion:

- detect a solved board or explicit victory state on at least one retained validation puzzle

### Failure Conditions

At minimum, record:

- invalid/no-op move sequences
- repeated failed plans
- probable deadlock-causing pushes

## Non-Goals For The First Return

The first restored `Sokoban` scope does not need:

- broad level support
- polished auto-detection
- advanced deadlock theorem coverage
- generalized plugin packaging

It only needs to be strong enough to prove that the Tauri runtime can support a second reasoning-oriented game loop beyond `2048`.
