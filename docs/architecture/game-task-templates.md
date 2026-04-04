# Game Task Templates

## Purpose

This document defines the lightweight template pattern used for small functional game tasks.

## Current Use

Current shared template infrastructure lives in:

- `src/services/games/task-templates.ts`
- `src/services/games/game-utils.ts`

There is no active template-driven game in the current baseline. The template layer is retained for future small-task extensions.

## Template Shape

Each template defines:

- task identity
- operator-facing label and description
- verification threshold
- either a fixed heuristic action list or a vision-driven prompt plus heuristic fallback

The split is:

- game service: run lifecycle, host actions, events, summaries
- template: task definition, default strategy, reusable action ordering

## When To Use

Use templates when the game has a small finite task set, such as:

- menu toggles
- short movement probes
- one-step interactions
- inventory / pause / close flows

Do not force templates onto open-ended planner loops.

Examples:

- menu / inventory / short movement probes fit templates well
- `2048` remains a dedicated loop because it is a board-driven decision cycle

## Extension Path

To add a new template-driven game:

1. create a `<game>-task-templates.ts` file
2. define templates with `defineFixedActionTaskTemplate` and `defineVisionActionTaskTemplate`
3. reuse common helpers such as window matching, snapshot capture, and snapshot-diff verification
4. keep the game service thin
