# Source Fusion Audit

This document is the first-pass fusion audit for the three functional source repositories:

- `LLMPlay-MVP`
- `VoiceL2D-MVP`
- `Video-Understanding-MVP`

It records what has already landed in `paimon-companion-tauri`, what is still missing, and which source capabilities have been intentionally replaced by a different Tauri-native implementation.

## Status Labels

- `merged`: present and accepted in the current Tauri runtime
- `partial`: some coverage exists, but the source capability is not fully covered
- `missing`: source capability is still absent
- `replaced`: source capability is intentionally superseded by a different implementation shape

## Accepted Replacement Decisions

These source capabilities are considered intentionally replaced rather than literally copied:

- `LLMPlay-MVP` `FastMCP` action transport
  - replaced by Tauri Rust host commands plus TypeScript orchestration/services
- `VoiceL2D-MVP` frontend/backend WebSocket split
  - replaced by in-process React + service-container + event-bus wiring
- `VoiceL2D-MVP` MCP-based expression bridging
  - replaced by direct character-expression events and Stage window control

These are not yet accepted replacements:

- single-frame screenshot reasoning in place of the broader video-understanding pipeline/toolkit
- `2048`-only functional validation in place of the full intended `LLMPlay-MVP` source scope

## Audit Matrix

### `LLMPlay-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Window capture + focus + key input for game control | `src-tauri/src/commands/window.rs`, `src/services/system/system-service.ts`, `src/services/orchestrator/orchestrator-service.ts` | `merged` | Tauri-native host primitives cover the same control surface as the MVP’s OS helpers. | Keep as the accepted host baseline. |
| `2048` screenshot -> decide -> act loop | `src/services/games/game-2048-service.ts` | `merged` | The core `2048` command-to-action loop is implemented and already validated in `P1`. | Treat as accepted carry-over. |
| Tool-call based action interface (`FastMCP`) | `src/services/orchestrator/orchestrator-service.ts`, `src/services/unified/unified-runtime-service.ts` | `replaced` | Runtime actions no longer travel through an external MCP server; they are in-process Tauri service calls now. | Document this as a permanent architecture decision. |
| Game-specific MCP tool packs (`2048`, `sokoban`) | `src/services/games/game-2048-service.ts`, `src/services/games/sokoban-service.ts` | `partial` | `2048` is validated and `sokoban` now has a restored minimal validation skeleton on the same semantic-action foundation. The future external MCP boundary is still not the final shape yet. | Keep `sokoban` in retained scope while MCP-facing tool packaging stays a later convergence step. |
| Decision-history/reflection loop around repeated moves | `src/services/games/game-2048-service.ts`, `src/services/games/sokoban-service.ts`, `src/features/control-panel/FunctionalDebugPanel.tsx`, `src/services/evaluation/evaluation-service.ts` | `partial` | The runtime now records plan signatures, attempted moves, successful moves, and repeated-failure counts for both `2048` and `sokoban`, which is much closer to the MVP’s reflection shape. Longer-horizon planning memory is still lighter than the original research prototype. | Accept the current stronger decision-history baseline and only extend it further if later games expose a real gap. |
| Prompt-pack/game-prompt structure | `src/services/games/game-2048-service.ts`, `src/services/games/sokoban-service.ts`, `prompts/example.md` | `replaced` | The MVP’s per-game prompt text is no longer the accepted source shape. The Tauri baseline now uses one shared game prompt template plus lightweight per-game filling. | Keep the shared template direction as the accepted replacement. |

### `VoiceL2D-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Live2D rendering and model control | `src/features/live2d/live2d-renderer.ts`, `src/features/stage/StageWindow.tsx`, `src/features/stage/StageHost.tsx` | `merged` | Live2D stage rendering, model switching, expressions, zoom, and stage behavior are already present. | Keep as accepted baseline. |
| Chat panel with manual text input | `src/features/chat/ChatPanel.tsx` | `merged` | Manual chat interaction is present in the Tauri UI. | Keep as accepted baseline. |
| Character/persona management | `src/services/character/character-service.ts`, `src/features/control-panel/ControlPanel.tsx` | `merged` | Character cards, persona loading, switching, and expression mapping exist. | Keep as accepted baseline. |
| TTS generation + sequential playback + lip sync | `src/services/tts/gptsovits-tts-service.ts`, `src/services/pipeline/pipeline-service.ts`, `src/services/audio/audio-player.ts` | `merged` | GPT-SoVITS playback, sequential output, and Live2D mouth/response linkage are now validated in the Tauri host. | Keep as accepted baseline. |
| Frontend/backend transport via WebSocket | `src/services/index.ts`, `src/services/event-bus/event-bus.ts` | `replaced` | The Tauri app is single-runtime and no longer needs the MVP’s WebSocket boundary. | Keep this replacement. |
| MCP-driven expression commands from LLM | `src/services/character/character-service.ts`, `src/services/character/expression-protocol.ts`, `src/features/stage/StageWindow.tsx`, `src/main.tsx` | `partial` | Companion replies can now drive model-aware Live2D expression changes through a first-pass reusable emotion protocol. The accepted behavior exists, but the public/control contract is still internal and should later be formalized as MCP. | Keep current behavior as accepted baseline, then MCP-formalize the control surface and align it with future gameplay tools. |
| Microphone capture | `src/services/voice-input/voice-input-service.ts`, `src/features/chat/ChatPanel.tsx` | `merged` | The Tauri app has a real chat-panel microphone path again, using browser/WebView capture instead of the MVP’s Python `sounddevice` loop, and it is now live-validated. | Keep as accepted baseline. |
| VAD-based speech segmentation | `src/services/voice-input/voice-input-service.ts` | `merged` | The lighter browser-side VAD gate is now accepted through live validation as the current replacement for the MVP’s older `webrtcvad` path. | Keep current implementation unless quality issues force a revisit. |
| Real ASR pipeline (bundled `sherpa-onnx` / cloud ASR) | `src/services/asr/local-sherpa-asr-service.ts`, `src/services/asr/http-asr-service.ts`, `src/services/provider-resolvers.ts`, `src/features/settings/AsrProfilesSection.tsx` | `partial` | The bundled local `sherpa-onnx` path is now live-validated and accepted. Cloud ASR providers (`volcengine`, `aliyun`) remain supported but are not part of the accepted live-validation baseline yet. | Treat local sherpa as accepted baseline; validate a cloud path later only if it remains product-relevant. |
| Audio lock / anti-feedback during playback | `src/services/voice-input/voice-input-service.ts` | `merged` | Playback-time microphone lock is now accepted through live validation. | Keep as accepted baseline. |

### `Video-Understanding-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Windows window capture utility | `src-tauri/src/commands/window.rs`, `src/services/perception/perception-service.ts` | `partial` | Window capture exists, but not as the broader reusable toolkit module set from the MVP. | Decide which reusable toolkit surface should remain in Tauri. |
| Frame-diff filtering (`MSE` / `SSIM`) for keyframe selection | `src/services/games/game-utils.ts`, `src/services/companion-runtime/companion-runtime-service.ts` | `partial` | The Tauri app already had before/after snapshot diff for action verification, and now reuses a lightweight change-estimation pass to coalesce visually unchanged companion-runtime captures. It is still not the full continuous keyframe-selection toolkit from the MVP. | Continue only as far as the product runtime needs. |
| Async VLM client abstraction | `src/services/games/game-2048-service.ts`, `src/services/config/http-proxy.ts` | `partial` | OpenAI-compatible vision requests exist, but not as a reusable general-purpose VLM client like the MVP toolkit. | Decide whether to factor out a reusable Tauri VLM client abstraction. |
| Full capture -> queue -> describe -> summarize video pipeline | `src/services/companion-runtime/companion-runtime-service.ts`, `src/features/control-panel/CompanionRuntimeSection.tsx`, `src/services/llm/llm-service.ts` | `partial` | The Tauri app now has a first experimental rolling companion runtime: selected-target capture, local frame descriptions, periodic summary windows, retained recent summary context, and prompt-path exposure of the latest temporal summary for companion replies. It is still a thin first slice, not the full MVP-grade pipeline. | Continue merging reusable perception/runtime pieces without overfitting the old Python layout. |
| Queue manager / backpressure / expiry around frame processing | `src/services/companion-runtime/companion-runtime-service.ts` | `partial` | Basic rolling retention now exists for frame descriptions and summary history, but there is still no stronger backpressure, diff-driven keyframe filtering, or dedicated backend scheduler. | Strengthen only the queue behavior that product runtime actually needs. |
| Summarizer over multi-frame descriptions | `src/services/companion-runtime/companion-runtime-service.ts` | `partial` | The first periodic temporal summary path now exists and uses recent frame descriptions plus prior summaries. | Keep iterating toward the accepted product runtime rather than cloning the full research pipeline. |
| Benchmark / quality-evaluation toolkit | `src/services/evaluation/evaluation-service.ts`, `src/services/companion-runtime/companion-runtime-service.ts`, `src/services/companion-runtime/companion-runtime-benchmark-service.ts`, `src/features/control-panel/CompanionRuntimeSection.tsx` | `partial` | Current evaluation now covers functional runs plus a fixed-duration companion runtime benchmark with throughput, unchanged-frame ratio, summary cadence, and latency metrics. It is still intentionally smaller than the research benchmarking/judge toolkit. | Keep only the product-facing benchmark slices; leave judge/scoring research tooling out unless it becomes necessary. |
| Judge/scoring/visualization research tooling | no current equivalent | `missing` | The Tauri repo does not currently host the MVP’s research toolkit. | Likely keep out unless explicitly needed. |

## Consolidated Result

Current high-level audit result:

- `LLMPlay-MVP`: `partial`
  - accepted core: Tauri-native host control + validated `2048` loop + retained `Sokoban` validation skeleton + stronger decision-history loop
  - unresolved: MCP-facing gameplay exposure and later plugin generalization, not whether the Python MVP structure itself must be copied
- `VoiceL2D-MVP`: `partial`
  - accepted core: Live2D + chat + character + microphone + VAD + bundled local sherpa ASR + GPT-SoVITS TTS/lip-sync
  - unresolved: cloud ASR validation and any future quality upgrades such as better mixed-language utterance handling
- `Video-Understanding-MVP`: `partial`
  - accepted core: screenshot capture, single-frame model use, and the first rolling local-description + periodic-summary runtime slice
  - unresolved: stronger queueing/filtering/scheduler behavior and any future benchmark slices beyond the now-accepted lightweight product-facing harness

This means the three-source fusion is not yet complete.

## Immediate Implementation Priority

The next implementation order should be:

1. `P2.4 LLMPlay-MVP Completion`
   - settle retained scope, retirement decisions, and later game-plugin boundaries
2. `P2.5 Video-Understanding-MVP Completion`
   - merge only the toolkit pieces that still serve the Tauri product
3. `P2.6 Post-Fusion Validation`
   - validate the combined runtime after the three-source gaps are closed

Accepted prerequisite already in place:

- `P2.3` has established the current expression-linkage baseline for companion replies
- retained / replaced / retired `LLMPlay-MVP` decisions are recorded in `llmplay-retained-scope.md`
