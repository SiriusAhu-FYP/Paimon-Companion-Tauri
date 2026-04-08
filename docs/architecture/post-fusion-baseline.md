# Post-Fusion Baseline

This document defines the acceptance bar for closing out `P2`.

`P2` is not complete merely because the three source lines exist in one repo.

The accepted post-fusion baseline is:

- `VoiceL2D-MVP`, `LLMPlay-MVP`, and `Video-Understanding-MVP` capabilities coexist in one Tauri runtime
- the companion can observe current screen activity through the rolling runtime context
- the companion can speak naturally about that current context without relying on rigid visible reply formatting
- the companion can drive Live2D expression changes from the same runtime path
- the runtime can temporarily execute a semantic game action round on a selected target
- the same unified path can produce:
  - game action execution
  - grounded companion follow-up text
  - speech playback
  - visible expression response

## Minimum Accepted Runtime Shape

The minimum accepted runtime shape for `P2` is:

1. `local-sherpa` microphone input remains usable in the Tauri host.
2. `GPT-SoVITS` playback remains usable in the same host.
3. `Companion Runtime` can capture a selected target, produce local frame descriptions, and periodically summarize them.
4. the latest retained summary is available to the LLM prompt path.
5. `Unified Run` can route through the selected semantic game target instead of a hardcoded single-game path.
6. after a unified game round, the active LLM can generate a grounded companion follow-up instead of relying only on hardcoded per-game copy.
7. if the companion runtime is observing the same target, unified follow-up generation should be based on refreshed runtime context instead of stale context only.

## Acceptance Checks

`P2` can be treated as closed only if all of the following hold during one focused validation pass:

- voice input works end to end
- companion runtime observation works on a live target
- rolling summary enters the LLM prompt path
- unified game execution still works on at least one validated semantic game target
- grounded follow-up text is generated after unified execution
- speech playback still works on that unified path
- Live2D expression visibly changes on that unified path
- the fusion evaluation case can run and report:
  - runtime-context usage
  - LLM follow-up usage
  - speech usage
  - emotion application

## Out Of Scope For `P2` Close-Out

The following are explicitly not required to close `P2`:

- full MCP externalization of the accepted internal control paths
- no-progress cloud escalation / selected-frame cloud rescue
- final pluginized support for future large games such as Minecraft
- cloud ASR live acceptance
- motion as a mandatory acceptance gate

Those remain later work after source fusion is accepted.
