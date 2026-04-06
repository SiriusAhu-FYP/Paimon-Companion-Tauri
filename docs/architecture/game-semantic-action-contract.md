# Game Semantic Action Contract

This document defines the intended MCP-facing contract for gameplay control.

The goal is to let the model think in game semantics rather than raw key and mouse steps.

## Goal

The model should prefer actions such as:

- `open_inventory`
- `move_up`
- `craft_plank`
- `confirm_dialog`

It should not need to reason primarily in:

- `press E`
- `move mouse to x,y`
- `left click`

Low-level host input remains necessary, but it should be an execution detail hidden behind the game runtime.

## Tool Surface

### `game.list_actions`

Purpose:

- expose the semantic action vocabulary supported by the active game plugin

Suggested output:

```json
{
  "gameId": "minecraft",
  "actions": [
    "open_inventory",
    "close_inventory",
    "craft_plank",
    "move_forward",
    "turn_left"
  ]
}
```

### `game.perform_action`

Purpose:

- ask the active game runtime to execute one semantic action

Suggested input:

```json
{
  "action": "open_inventory"
}
```

Suggested output:

```json
{
  "accepted": true,
  "action": "open_inventory",
  "status": "completed",
  "summary": "inventory opened"
}
```

### `game.get_state`

Purpose:

- expose the current game-facing runtime state in semantic terms

Suggested output:

```json
{
  "gameId": "2048",
  "targetWindow": "Play 2048 - Mozilla Firefox",
  "availableActions": [
    "move_up",
    "move_down",
    "move_left",
    "move_right"
  ],
  "notes": [
    "highest tile should stay anchored in a corner"
  ]
}
```

## Translation Rule

The contract should keep this layering:

1. model selects semantic action through MCP
2. game plugin/config translates semantic action into host operations
3. backend runtime executes host operations
4. runtime verifies outcome and reports a semantic result

The model should not need direct awareness of low-level host actions unless a debugging path explicitly exposes them.

## Plugin Schema Direction

Each game integration should be able to stay lightweight.

At minimum, a game package should define:

- `gameId`
- semantic action names
- action-to-host mappings
- state cues
- rules / affordances
- prompt fragments derived from the shared game prompt template

## Core vs Plugin Split

Keep these in the shared core:

- MCP tool names
- host execution primitives
- verification/result shape
- runtime logging and retry policy

Keep these in per-game config/plugins:

- action vocabulary
- key mappings
- state cues
- game rules
- prompt fragments

This is the basis for later “small config package” game onboarding.
