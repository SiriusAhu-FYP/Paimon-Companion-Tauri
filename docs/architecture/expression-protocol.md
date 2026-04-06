# Companion Expression Protocol

This document records the first implementation pass of the `P2.3` companion expression protocol.

## Scope

This pass is intentionally narrow:

- define a small, distinct emotion vocabulary
- let each emotion map to multiple candidate expressions
- randomize within those candidates at runtime
- keep motion selection out of scope for now

The protocol currently controls `LLM/runtime -> emotion -> Live2D expression`.

## Emotion Set

Current protocol emotions:

- `neutral`
- `happy`
- `angry`
- `sad`
- `delighted`
- `alarmed`
- `dazed`

Design rule:

- avoid one broad `surprised` bucket
- split positive surprise into `delighted`
- split negative surprise / urgency into `alarmed`
- reserve `dazed` for speechless, blank, or short-circuit reactions

## First-Pass Model Mapping

### `paimengVts`

| Emotion | Candidate expressions |
|---|---|
| `neutral` | `表情1` |
| `happy` | `表情7` |
| `angry` | `表情2`, `表情6` |
| `sad` | `表情5` |
| `delighted` | `表情7`, `表情6` |
| `alarmed` | `表情4`, `表情8` |
| `dazed` | `表情3`, `表情9` |

### `英伦兔兔`

| Emotion | Candidate expressions |
|---|---|
| `neutral` | `123` |
| `happy` | `Cat face`, `Love` |
| `angry` | `angry`, `Black` |
| `sad` | `Sluggish` |
| `delighted` | `star`, `Love` |
| `alarmed` | `Crazy`, `perspire` |
| `dazed` | `Silly`, `perspire`, `Sluggish` |

## Notes

- This is a model-aware protocol. The same emotion can map to different expression names on different models.
- Randomization only happens inside one emotion bucket. It does not change the emotion selected by LLM/runtime.
- Repeated triggers of the same emotion try to select a different candidate first. If no alternative exists, the current expression is kept and only the timer is refreshed.
- Non-`neutral` expressions auto-reset back to `neutral` after 60 seconds without a newer expression trigger.
- The bunny model still behaves more like a compositional expression set than a pure one-expression model. The current protocol keeps it on single-expression candidates for simplicity.
- Motion selection should be added later as another layer on top of the same emotion vocabulary, not as a separate incompatible system.
