# Source Fusion Audit

This document is the first-pass fusion audit for the three functional source repositories:

- `E:\FYP-PROJECT\core\LLMPlay-MVP`
- `E:\FYP-PROJECT\core\VoiceL2D-MVP`
- `E:\FYP-PROJECT\core\Video-Understanding-MVP`

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

- manual/mock ASR in place of real microphone/VAD/ASR
- single-frame screenshot reasoning in place of the broader video-understanding pipeline/toolkit
- `2048`-only functional validation in place of the full intended `LLMPlay-MVP` source scope

## Audit Matrix

### `LLMPlay-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Window capture + focus + key input for game control | `src-tauri/src/commands/window.rs`, `src/services/system/system-service.ts`, `src/services/orchestrator/orchestrator-service.ts` | `merged` | Tauri-native host primitives cover the same control surface as the MVP’s OS helpers. | Keep as the accepted host baseline. |
| `2048` screenshot -> decide -> act loop | `src/services/games/game-2048-service.ts` | `merged` | The core `2048` command-to-action loop is implemented and already validated in `P1`. | Treat as accepted carry-over. |
| Tool-call based action interface (`FastMCP`) | `src/services/orchestrator/orchestrator-service.ts`, `src/services/unified/unified-runtime-service.ts` | `replaced` | Runtime actions no longer travel through an external MCP server; they are in-process Tauri service calls now. | Document this as a permanent architecture decision. |
| Game-specific MCP tool packs (`2048`, `sokoban`) | `src/services/games/game-2048-service.ts` | `partial` | `2048` exists; `sokoban` does not. | Decide whether `sokoban` is still in scope or explicitly retire it. |
| Decision-history/reflection loop around repeated moves | `src/services/games/game-2048-service.ts`, `src/features/control-panel/FunctionalDebugPanel.tsx`, `src/services/evaluation/evaluation-service.ts` | `partial` | Current run history/debug/evaluation exist, but not in the same prompt/history form as the MVP. | Decide whether current replacement is sufficient or needs extra reflection state. |
| Prompt-pack/game-prompt structure | `src/services/games/game-2048-service.ts`, `src/services/llm/prompt-builder.ts` | `partial` | Prompting exists, but source prompt organization has not been audited line-by-line. | Compare source prompt files and retain only behaviorally important pieces. |

### `VoiceL2D-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Live2D rendering and model control | `src/features/live2d/live2d-renderer.ts`, `src/features/stage/StageWindow.tsx`, `src/features/stage/StageHost.tsx` | `merged` | Live2D stage rendering, model switching, expressions, zoom, and stage behavior are already present. | Keep as accepted baseline. |
| Chat panel with manual text input | `src/features/chat/ChatPanel.tsx` | `merged` | Manual chat interaction is present in the Tauri UI. | Keep as accepted baseline. |
| Character/persona management | `src/services/character/character-service.ts`, `src/features/control-panel/ControlPanel.tsx` | `merged` | Character cards, persona loading, switching, and expression mapping exist. | Keep as accepted baseline. |
| TTS generation + sequential playback + lip sync | `src/services/tts/gptsovits-tts-service.ts`, `src/services/pipeline/pipeline-service.ts`, `src/services/audio/audio-player.ts` | `merged` | GPT-SoVITS path, playback queue, and mouth sync are implemented. | Keep as accepted baseline. |
| Frontend/backend transport via WebSocket | `src/services/index.ts`, `src/services/event-bus/event-bus.ts` | `replaced` | The Tauri app is single-runtime and no longer needs the MVP’s WebSocket boundary. | Keep this replacement. |
| MCP-driven expression commands from LLM | `src/services/character/character-service.ts`, `src/features/stage/StageWindow.tsx` | `replaced` | Expression control now flows through local events rather than a separate MCP roundtrip. | Keep this replacement. |
| Microphone capture | no current equivalent | `missing` | The MVP had microphone recording via `sounddevice`; the Tauri app currently has no real microphone capture path. | Reintroduce microphone capture in `P2.2`. |
| VAD-based speech segmentation | no current equivalent | `missing` | The MVP had continuous VAD and speech chunking; current app does not. | Reintroduce VAD in `P2.2`. |
| Real ASR pipeline (`GLM-ASR` / `Faster-Whisper`) | no current equivalent | `missing` | Current app only exposes manual/mock voice text input for testing. | Reintroduce a real ASR path in `P2.2`. |
| Audio lock / anti-feedback during playback | no current equivalent | `missing` | The MVP paused microphone/VAD during TTS playback. Current app cannot do this because there is no live microphone path yet. | Restore together with microphone/VAD work in `P2.2`. |

### `Video-Understanding-MVP`

| Source capability | Current Tauri location | Status | Notes | Next action |
|---|---|---|---|---|
| Windows window capture utility | `src-tauri/src/commands/window.rs`, `src/services/perception/perception-service.ts` | `partial` | Window capture exists, but not as the broader reusable toolkit module set from the MVP. | Decide which reusable toolkit surface should remain in Tauri. |
| Frame-diff filtering (`MSE` / `SSIM`) for keyframe selection | `src/services/games/game-utils.ts` | `partial` | The Tauri app has before/after snapshot diff for action verification, but not continuous keyframe filtering over a live stream. | Add only if still needed for product-level perception. |
| Async VLM client abstraction | `src/services/games/game-2048-service.ts`, `src/services/config/http-proxy.ts` | `partial` | OpenAI-compatible vision requests exist, but not as a reusable general-purpose VLM client like the MVP toolkit. | Decide whether to factor out a reusable Tauri VLM client abstraction. |
| Full capture -> queue -> describe -> summarize video pipeline | no current equivalent | `missing` | The MVP’s continuous video-understanding pipeline is not present in current Tauri runtime. | Decide which subset belongs in-product before adding anything. |
| Queue manager / backpressure / expiry around frame processing | no current equivalent | `missing` | Current app uses single-step screenshots, not queued video frames. | Keep absent unless continuous understanding becomes a real runtime need. |
| Summarizer over multi-frame descriptions | no current equivalent | `missing` | No current equivalent of the MVP’s video summarizer pipeline. | Decide whether it belongs to product or stays as research tooling. |
| Benchmark / quality-evaluation toolkit | `src/services/evaluation/evaluation-service.ts` | `partial` | Current evaluation only measures functional runs, not model quality benchmarking/judge scoring. | Carry over only the evaluation pieces still useful for the product goal. |
| Judge/scoring/visualization research tooling | no current equivalent | `missing` | The Tauri repo does not currently host the MVP’s research toolkit. | Likely keep out unless explicitly needed. |

## Consolidated Result

Current high-level audit result:

- `LLMPlay-MVP`: `partial`
  - accepted core: Tauri-native host control + validated `2048` loop
  - unresolved: source scope beyond current `2048`, especially `sokoban` and exact prompt/reflection carry-over
- `VoiceL2D-MVP`: `partial`
  - accepted core: Live2D + chat + character + TTS/lip-sync
  - unresolved: microphone, VAD, and real ASR chain
- `Video-Understanding-MVP`: `partial`
  - accepted core: screenshot capture and single-frame model use
  - unresolved: most of the reusable video-understanding toolkit and evaluation stack

This means the three-source fusion is not yet complete.

## Immediate Implementation Priority

The next implementation order should be:

1. `P2.2 VoiceL2D-MVP Completion`
   - restore real voice input first
2. `P2.3 LLMPlay-MVP Completion`
   - settle full retained scope vs retired scope
3. `P2.4 Video-Understanding-MVP Completion`
   - merge only the toolkit pieces that still serve the Tauri product
4. `P2.5 Post-Fusion Validation`
   - validate the combined runtime after the three-source gaps are closed
