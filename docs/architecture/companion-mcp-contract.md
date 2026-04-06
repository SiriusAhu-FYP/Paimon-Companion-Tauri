# Companion MCP Contract

This document defines the intended MCP-facing contract for companion-side control.

It exists to keep companion expression control out of the user-visible reply format.

The model should be free to produce natural language for the player while using MCP tools for structured companion actions.

## Goal

Support this pattern in one model turn:

- natural-language reply for the player
- optional MCP tool calls for companion state changes

The visible reply should not need rigid formatting to drive the Live2D model.

## Tool Families

The long-term companion tool surface should stay small.

### `companion.set_emotion`

Primary accepted control tool.

Purpose:

- select a semantic companion emotion
- let the runtime map that emotion to model-specific expression candidates
- optionally attach a motion later if the current model supports it

Suggested input:

```json
{
  "emotion": "happy",
  "reason": "The player just found a reward chest."
}
```

Suggested output:

```json
{
  "accepted": true,
  "emotion": "happy",
  "expressionName": "表情7",
  "motion": null
}
```

### `companion.reset_emotion`

Purpose:

- force the companion back to the neutral state before the idle timeout expires

Suggested input:

```json
{}
```

### `companion.get_state`

Purpose:

- expose current companion runtime state to the model or debugging surface

Suggested output:

```json
{
  "emotion": "neutral",
  "isSpeaking": false,
  "activeModel": "/Resources/Commercial_models/paimengVts/3paimeng Vts.model3.json"
}
```

## Accepted Emotion Vocabulary

The current accepted first-pass emotion set is:

- `neutral`
- `happy`
- `angry`
- `sad`
- `delighted`
- `alarmed`
- `dazed`

This vocabulary is intentionally semantic rather than model-specific.

The model should never emit raw expression file names as the primary control language.

## Runtime Rule

The contract should keep this split:

- MCP contract speaks in semantic emotions
- runtime maps those emotions to expression candidates
- Stage/Live2D layer applies model-specific expressions and optional motions

This keeps model prompting decoupled from individual model asset names.

## Non-Goals

This contract should not expose:

- raw Live2D parameter IDs
- direct expression file names as the main public interface
- model-specific motion group names as the main public interface

Those belong to runtime internals unless debugging explicitly needs them.

## Current Implementation Gap

Current accepted behavior already exists in-app:

- reply/runtime -> emotion -> model-aware expression

But the public boundary is still internal event wiring rather than MCP.

This document defines the target boundary for the later migration.
