# LLMPlay Retained Scope

This document records which `LLMPlay-MVP` capabilities are still retained for `paimon-companion-tauri`, which ones are already accepted, and which ones are explicitly replaced or retired.

The point is to keep `P2.4` bounded.

## Accepted Carry-Over Baseline

These capabilities are already accepted in the current Tauri runtime:

- Tauri-native host control
  - window discovery
  - screenshot capture
  - focus
  - keyboard / mouse input
- `2048` reasoning loop
  - screenshot
  - semantic action ordering
  - action execution
  - post-action verification
- `Sokoban` retained validation track
  - semantic action manifest
  - short reasoning sequence
  - post-action verification
- shared game prompt template
  - `prompts/example.md`
- stronger decision-history loop
  - plan signature
  - attempted actions
  - successful actions
  - repeated-failure counts

## Retained Scope

These `LLMPlay-MVP` ideas remain in scope and should continue to shape the runtime:

- reasoning-oriented validation games
  - keep `2048`
  - keep `Sokoban`
- semantic game actions above raw host input
- decision-history and reflection-aware prompting
- natural-language reasoning plus structured action execution
- future MCP-facing gameplay boundary

## Accepted Replacements

These source capabilities are intentionally not being copied literally:

- external `FastMCP` server process
  - replaced by in-app runtime services today
  - future direction still converges to MCP at the system boundary
- Python-only tool modules such as `make_moves`
  - replaced by semantic action manifests and runtime execution layers
- Python log/session folder layout
  - replaced by Tauri debug panels, event history, and app-side state inspection
- raw text fallback direction parsing as the primary interaction path
  - replaced by structured semantic action planning inside the Tauri runtime

## Explicit Retirements

These `LLMPlay-MVP` details are explicitly retired and should not be treated as unfinished migration debt:

- literal reuse of Python package structure
- literal reuse of `FastMCP` decorators and server files
- Python-side `config.toml` ownership of gameplay runtime
- exact MVP terminal logging workflow
- exact MVP CLI-first launch flow

## Still Open After `P2.4`

These are still important, but they are not reasons to keep `P2.4` open indefinitely:

- formal MCP exposure of gameplay tools
- broader plugin packaging for new games
- stronger solved-state detection for more than the current retained validation cases
- later expansion into Minecraft or other heavier games

Those belong to later fusion and expansion work rather than the minimum retained `LLMPlay-MVP` baseline.
