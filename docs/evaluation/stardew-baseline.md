# Stardew Valley Extension

## Purpose

This document records the current Stardew small-task extension and its evaluation placeholders.

## First Task Set

### `reposition`

- goal: choose one safe micro-movement using `W/A/S/D`
- verification: confirm a visible scene change

### `open-inventory`

- goal: toggle the inventory open
- control: send `E`
- verification: confirm a strong UI change

### `close-menu`

- goal: dismiss a current menu layer
- control: send `Escape`
- verification: confirm the scene changed back toward gameplay

## Evaluation Cases

### `stardew-auto-detect-reposition`

- target mode: auto-detect
- iterations: 3

### `stardew-selected-inventory-toggle`

- target mode: selected target
- iterations: 4

## Current Status

- implementation exists in the repo
- live Stardew validation was intentionally deferred during `P1` close-out
- the accepted `P1` baseline is the validated `2048` path, not the Stardew path

| Case | Status | Success Rate | Action Validity | Avg Latency |
| --- | --- | --- | --- | --- |
| `stardew-auto-detect-reposition` | pending live run | n/a | n/a | n/a |
| `stardew-selected-inventory-toggle` | pending live run | n/a | n/a | n/a |

## Re-run Procedure

1. Launch the app with a visible Stardew gameplay window.
2. Open the `功能实验` panel in the right-hand UI column.
3. Use the `Stardew Valley 扩展` section to verify target detection and the first task set.
4. Use the `Functional Evaluation Harness` section and run the two Stardew cases.
