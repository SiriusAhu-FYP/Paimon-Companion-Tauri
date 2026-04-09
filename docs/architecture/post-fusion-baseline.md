# Post-Fusion Baseline

This document defines the acceptance bar for closing out `P2`.

`P2` is not complete merely because the three source lines exist in one repo.

`P2` is also not complete if the accepted control paths still exist only as internal event wiring.

MCP-backed control is a prerequisite for `P2` close-out.

The accepted post-fusion baseline is:

- `VoiceL2D-MVP`, `LLMPlay-MVP`, and `Video-Understanding-MVP` capabilities coexist in one Tauri runtime
- the companion can observe current screen activity through the rolling runtime context
- the companion can speak naturally about that current context without relying on rigid visible reply formatting
- the companion can drive Live2D expression changes from the same runtime path through MCP tools
- the runtime can temporarily execute a semantic game action round on a selected target through MCP tools
- the same unified path can produce:
  - game action execution
  - grounded companion follow-up text
  - speech playback
  - visible expression response

The baseline is now accepted as achieved for `P2` on `2026-04-09`.

## Minimum Accepted Runtime Shape

The minimum accepted runtime shape for `P2` is:

1. `local-sherpa` microphone input remains usable in the Tauri host.
2. `GPT-SoVITS` playback remains usable in the same host.
3. `Companion Runtime` can capture a selected target, produce local frame descriptions, and periodically summarize them.
4. the latest retained summary is available to the LLM prompt path.
5. `Unified Run` can route through the selected semantic game target instead of a hardcoded single-game path.
6. after a unified game round, the active LLM can generate a grounded companion follow-up instead of relying only on hardcoded per-game copy.
7. if the companion runtime is observing the same target, unified follow-up generation should be based on refreshed runtime context instead of stale context only.
8. the accepted companion-expression path and semantic-game-action path are exposed through the first real MCP server boundary rather than only internal app-local events.

## Acceptance Checks

`P2` can be treated as closed only if all of the following hold during one focused validation pass:

- voice input works end to end
- companion runtime observation works on a live target
- rolling summary enters the LLM prompt path
- unified game execution still works on at least one validated semantic game target
- grounded follow-up text is generated after unified execution
- speech playback still works on that unified path
- Live2D expression visibly changes on that unified path
- the expression change and semantic game action are both triggered through MCP-facing tools rather than a mock-only/internal-only shortcut
- the fusion evaluation case can run and report:
  - runtime-context usage
  - LLM follow-up usage
  - speech usage
  - emotion application
  - MCP companion-tool usage
  - MCP game-tool usage

The accepted focused validation pass has now been observed with a `Fusion Selected Target Round` result showing:

- `success 100%`
- `runtime 100%`
- `llm 100%`
- `speech 100%`
- `emotion 100%`
- `mcp-companion 100%`
- `mcp-game 100%`

## Out Of Scope For `P2` Close-Out

The following are explicitly not required to close `P2`:

- no-progress cloud escalation / selected-frame cloud rescue
- final pluginized support for future large games such as Minecraft
- cloud ASR live acceptance
- motion as a mandatory acceptance gate

## Accepted Known Issues At Close-Out

The following issues remain real, but do not block `P2` close-out:

- the current fusion `latency` metric is an end-to-end round duration, not a fine-grained delay metric
- that end-to-end duration currently includes downstream stages such as speech playback, so it should not be interpreted as a pure model/tool delay number
- under active fusion load, the Tauri UI can still feel sluggish while local vision, logging, and speech are all active

These issues should be treated as the first follow-up work after `P2`, with latency breakdown and UI responsiveness profiling taking priority over new product scope.

Those remain later work after source fusion is accepted.
