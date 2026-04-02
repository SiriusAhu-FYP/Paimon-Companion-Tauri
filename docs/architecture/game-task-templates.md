# Game Task Templates

## Purpose

This document defines the lightweight task-template pattern used for adding new functional game tasks without cloning an entire service implementation.

## Current Use

The first concrete templateized game is `Stardew Valley`.

Its task set is defined in:

- `src/services/games/stardew-task-templates.ts`

Shared template primitives live in:

- `src/services/games/task-templates.ts`
- `src/services/games/game-utils.ts`

## Template Shape

Each task template describes:

- stable task identity
- operator-facing label and description
- verification threshold for screenshot-diff validation
- either:
  - a fixed heuristic action list
  - or a vision-driven prompt plus a heuristic fallback

This keeps the runtime split clean:

- the game service owns run lifecycle, host actions, event emission, and game-specific summaries
- the template owns task definition, default strategy, and reusable action ordering logic

## Why This Exists

Before this layer, adding a new game task meant copying and editing:

- task metadata
- fallback heuristics
- prompt text
- verification thresholds
- action ordering rules

The template layer reduces that to one small definition file per game or per task family.

## Practical Rule

Use templates when the game has a small finite task set such as:

- menu toggles
- short movement probes
- one-step interactions
- inventory / pause / close flows

Do not force templates onto flows that are fundamentally open-ended planners.

For example:

- `Stardew Valley` small tasks fit templates well
- `2048` remains a dedicated single-step loop because its core unit is a board-driven decision cycle rather than a menu-like task catalog

## Extension Path

To add a new template-driven game:

1. create a `<game>-task-templates.ts` file
2. define task templates with `defineFixedActionTaskTemplate` and `defineVisionActionTaskTemplate`
3. reuse `chooseWindowByKeywords`, `ensureReferenceSnapshot`, and `estimateSnapshotChange`
4. keep the game service thin: detection, event emission, run summaries, and evaluation wiring
