# Phase 0 Bootstrap

## Goal

Turn `paimon-companion-tauri` into the active Tauri-first implementation trunk for PAIMON.

This repo is not a continuation of the old Python-first integration repo.
It is a new host-first baseline built from the reusable desktop shell of `paimon-live`.

## Immediate Scope

The first implementation target is a minimal 2048 loop:

1. find the target window
2. capture the game screen
3. call external VLM / LLM services
4. decide one action
5. execute keyboard input
6. verify the result
7. reflect companion feedback in the UI

## Layering

### Rust host

- Tauri lifecycle
- window management
- keyring / secure secret access
- HTTP / SSE / binary proxy
- future OS primitives for PAIMON:
  - list windows
  - capture window
  - focus window
  - keyboard / mouse injection

### TypeScript application core

- orchestrator
- runtime state and safety gates
- tool registry / capability routing
- external model service clients
- character and companion state

### React UI

- control shell
- stage / Live2D output
- chat / logs / future debug panels

## Not In Scope For This Bootstrap

- livestream adapters
- Bilibili integration
- product / FAQ workflows
- old `paimon-live` knowledge-productization work
- Python sidecar inside the app

## First Milestones

### M1

Add Rust commands for basic Windows game control:

- `list_windows`
- `capture_window`
- `focus_window`
- `send_key`

### M2

Add TypeScript PAIMON core modules:

- `services/perception`
- `services/orchestrator`
- `services/safety`

### M3

Replace current product-facing shell assumptions with PAIMON control surfaces for game-oriented debugging.
