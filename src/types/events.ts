// 全局事件类型映射表
// 所有通过 EventBus 发布/订阅的事件在此定义载荷类型

import type { RuntimeMode } from "./runtime";
import type {
	EvaluationCaseResult,
	EvaluationState,
} from "./evaluation";
import type { UnifiedRuntimeState } from "./unified";
import type { UnifiedRunTimings } from "./unified";
import type {
	CompanionRuntimeBenchmarkResult,
	CompanionRuntimeBenchmarkState,
	CompanionFrameDescriptionRecord,
	CompanionRuntimeState,
	CompanionSummaryRecord,
} from "./companion-runtime";
import type {
	FunctionalActionKind,
	FunctionalLogLevel,
	FunctionalRuntimeState,
} from "./functional";
import type { Game2048Move, Game2048State } from "./game-2048";
import type { SokobanActionId, SokobanState } from "./sokoban";
import type { VoiceInputState } from "./voice";
import type { AffectState, AffectEventSource } from "./affect";
import type { ProactiveState, ProactiveTriggerSource } from "./proactive";
import type { CompanionInteractionMode, CompanionModeSource, CompanionModeState } from "./companion-mode";
import type { DelegatedExecutionRecord, DelegationMemoryState } from "./delegation-memory";
import type { DebugCaptureState } from "./debug-capture";

export interface RuntimeModeChangePayload {
	mode: RuntimeMode;
	previous: RuntimeMode;
}

export interface AudioVadEndPayload {
	audioData: ArrayBuffer;
}

export interface AudioAsrResultPayload {
	text: string;
	source: "voice" | "manual";
}

export interface AudioTtsStartPayload {
	text: string;
}

export interface AudioTtsPendingPayload {
	text: string;
}

export interface LlmRequestStartPayload {
	userText: string;
	source?: "chat" | "companion-reply" | "proactive-reply";
	inputSource?: "manual" | "voice" | "system";
	traceId?: string;
	companionRuntimeContextUsed?: boolean;
	companionRuntimeTarget?: string | null;
	companionRuntimeContextLength?: number;
	delegationMemoryContextLength?: number;
	knowledgeContextLength?: number;
}

export interface LlmStreamChunkPayload {
	delta: string;
}

export interface LlmToolCallPayload {
	name: string;
	args: Record<string, unknown>;
	traceId?: string;
}

export interface McpToolStartPayload {
	name: string;
	args: Record<string, unknown>;
	traceId?: string;
}

export interface McpToolCompletePayload {
	name: string;
	ok: boolean;
	resultPreview: string;
	error?: string | null;
	traceId?: string;
}

export interface LlmResponseEndPayload {
	fullText: string;
	source?: "chat" | "companion-reply" | "proactive-reply";
	traceId?: string;
}

export interface LlmErrorPayload {
	error: string;
}

export interface CharacterExpressionPayload {
	emotion: string;
	expressionName: string;
}

export interface CharacterMotionPayload {
	motionGroup: string;
	index: number;
}

export interface CharacterStateChangePayload {
	characterId: string;
	emotion: string;
	emotionReason: string | null;
	emotionSource: string | null;
	isSpeaking: boolean;
}

export interface AffectStateChangePayload {
	state: AffectState;
	source: AffectEventSource;
	reason: string;
}

export interface CharacterSwitchPayload {
	characterId: string;
}

export interface SystemErrorPayload {
	module: string;
	error: string;
}

export interface UiStallPayload {
	durationMs: number;
	thresholdMs: number;
}

export interface FunctionalTargetChangePayload {
	handle: string | null;
	title: string | null;
}

export interface PerceptionSnapshotPayload {
	targetHandle: string;
	targetTitle: string;
	width: number;
	height: number;
	capturedAt: number;
	captureMethod: string;
	qualityScore: number;
	lowConfidence: boolean;
}

export interface OrchestratorStateChangePayload {
	state: FunctionalRuntimeState;
}

export interface OrchestratorTaskStartPayload {
	taskId: string;
	name: string;
	actionKind: FunctionalActionKind;
	targetHandle: string;
	targetTitle: string;
}

export interface OrchestratorTaskCompletePayload {
	taskId: string;
	name: string;
	actionKind: FunctionalActionKind;
	success: boolean;
	summary: string;
	error?: string | null;
}

export interface OrchestratorTaskLogPayload {
	taskId: string;
	level: FunctionalLogLevel;
	message: string;
}

export interface SafetyDecisionPayload {
	operation: string;
	allowed: boolean;
	reason: string | null;
}

export interface Game2048StateChangePayload {
	state: Game2048State;
}

export interface Game2048TargetDetectedPayload {
	handle: string | null;
	title: string | null;
	summary: string;
}

export interface Game2048RunStartPayload {
	runId: string;
	targetHandle: string;
	targetTitle: string;
	preferredMoves: Game2048Move[];
	traceId?: string;
}

export interface Game2048AttemptPayload {
	runId: string;
	move: Game2048Move;
	changed: boolean;
	changeRatio: number;
	traceId?: string;
}

export interface Game2048RunCompletePayload {
	runId: string;
	success: boolean;
	selectedMove: Game2048Move | null;
	boardChanged: boolean;
	summary: string;
	traceId?: string;
}

export interface SokobanStateChangePayload {
	state: SokobanState;
}

export interface SokobanTargetDetectedPayload {
	handle: string | null;
	title: string | null;
	summary: string;
}

export interface SokobanRunStartPayload {
	runId: string;
	targetHandle: string;
	targetTitle: string;
	plannedMoves: SokobanActionId[];
	traceId?: string;
}

export interface SokobanAttemptPayload {
	runId: string;
	move: SokobanActionId;
	changed: boolean;
	changeRatio: number;
	traceId?: string;
}

export interface SokobanRunCompletePayload {
	runId: string;
	success: boolean;
	executedMoves: SokobanActionId[];
	boardChanged: boolean;
	summary: string;
	traceId?: string;
}

export interface EvaluationStateChangePayload {
	state: EvaluationState;
}

export interface EvaluationCaseStartPayload {
	caseId: string;
	game: "2048" | "fusion";
	name: string;
	iterations: number;
}

export interface EvaluationCaseCompletePayload {
	result: EvaluationCaseResult;
}

export interface UnifiedStateChangePayload {
	state: UnifiedRuntimeState;
}

export interface UnifiedRunStartPayload {
	runId: string;
	trigger: "manual" | "voice";
	requestText: string | null;
	traceId?: string;
}

export interface UnifiedRunCompletePayload {
	runId: string;
	gameId: string | null;
	success: boolean;
	summary: string;
	emotion: string;
	spoke: boolean;
	timings: UnifiedRunTimings;
	traceId?: string;
}

export interface UnifiedVoiceInputPayload {
	text: string;
	command: string | null;
}

export interface CompanionRuntimeStateChangePayload {
	running: boolean;
	phase: CompanionRuntimeState["phase"];
	targetTitle: string | null;
	frameQueueLength: number;
	summaryHistoryLength: number;
	lastFrameId: string | null;
	lastSummaryId: string | null;
	captureTicks: number;
	summariesGenerated: number;
	lastError: string | null;
}

export interface CompanionRuntimeFramePayload {
	record: CompanionFrameDescriptionRecord;
}

export interface CompanionRuntimeSummaryPayload {
	record: CompanionSummaryRecord;
}

export interface CompanionModeChangePayload {
	state: CompanionModeState;
	mode: CompanionInteractionMode;
	previous: CompanionInteractionMode;
	reason: string;
	source: CompanionModeSource;
	preferredMode: CompanionInteractionMode;
}

export interface CompanionProactiveStateChangePayload {
	state: ProactiveState;
	action: ProactiveState["lastDecision"];
	source: ProactiveTriggerSource | null;
	reason: string | null;
}

export interface DelegationMemoryStateChangePayload {
	state: DelegationMemoryState;
}

export interface DelegationMemoryRecordAddedPayload {
	record: DelegatedExecutionRecord;
}

export interface CompanionRuntimeBenchmarkStateChangePayload {
	state: CompanionRuntimeBenchmarkState;
}

export interface CompanionRuntimeBenchmarkStartPayload {
	benchmarkId: string;
	name: string;
	durationMs: number;
	targetTitle: string;
}

export interface CompanionRuntimeBenchmarkCompletePayload {
	result: CompanionRuntimeBenchmarkResult;
}

export interface VoiceInputStateChangePayload {
	state: VoiceInputState;
}

export interface DebugCaptureStateChangePayload {
	state: DebugCaptureState;
}

export interface EventMap {
	"runtime:mode-change": RuntimeModeChangePayload;
	"audio:vad-start": void;
	"audio:vad-end": AudioVadEndPayload;
	"audio:asr-result": AudioAsrResultPayload;
	"audio:tts-pending": AudioTtsPendingPayload;
	"audio:tts-start": AudioTtsStartPayload;
	"audio:tts-end": void;
	"voice:state-change": VoiceInputStateChangePayload;
	"llm:request-start": LlmRequestStartPayload;
	"llm:stream-chunk": LlmStreamChunkPayload;
	"llm:tool-call": LlmToolCallPayload;
	"llm:response-end": LlmResponseEndPayload;
	"llm:error": LlmErrorPayload;
	"mcp:tool-start": McpToolStartPayload;
	"mcp:tool-complete": McpToolCompletePayload;
	"character:expression": CharacterExpressionPayload;
	"character:motion": CharacterMotionPayload;
	"character:state-change": CharacterStateChangePayload;
	"character:switch": CharacterSwitchPayload;
	"affect:state-change": AffectStateChangePayload;
	"system:emergency-stop": void;
	"system:manual-takeover": void;
	"system:resume": void;
	"system:error": SystemErrorPayload;
	"system:ui-stall": UiStallPayload;
	"functional:target-change": FunctionalTargetChangePayload;
	"perception:snapshot": PerceptionSnapshotPayload;
	"orchestrator:state-change": OrchestratorStateChangePayload;
	"orchestrator:task-start": OrchestratorTaskStartPayload;
	"orchestrator:task-complete": OrchestratorTaskCompletePayload;
	"orchestrator:task-log": OrchestratorTaskLogPayload;
	"safety:decision": SafetyDecisionPayload;
	"game2048:state-change": Game2048StateChangePayload;
	"game2048:target-detected": Game2048TargetDetectedPayload;
	"game2048:run-start": Game2048RunStartPayload;
	"game2048:attempt": Game2048AttemptPayload;
	"game2048:run-complete": Game2048RunCompletePayload;
	"sokoban:state-change": SokobanStateChangePayload;
	"sokoban:target-detected": SokobanTargetDetectedPayload;
	"sokoban:run-start": SokobanRunStartPayload;
	"sokoban:attempt": SokobanAttemptPayload;
	"sokoban:run-complete": SokobanRunCompletePayload;
	"evaluation:state-change": EvaluationStateChangePayload;
	"evaluation:case-start": EvaluationCaseStartPayload;
	"evaluation:case-complete": EvaluationCaseCompletePayload;
	"unified:state-change": UnifiedStateChangePayload;
	"unified:run-start": UnifiedRunStartPayload;
	"unified:run-complete": UnifiedRunCompletePayload;
	"unified:voice-input": UnifiedVoiceInputPayload;
	"companion-runtime:state-change": CompanionRuntimeStateChangePayload;
	"companion-runtime:frame-described": CompanionRuntimeFramePayload;
	"companion-runtime:summary-complete": CompanionRuntimeSummaryPayload;
	"companion-runtime:benchmark-state-change": CompanionRuntimeBenchmarkStateChangePayload;
	"companion-runtime:benchmark-start": CompanionRuntimeBenchmarkStartPayload;
	"companion-runtime:benchmark-complete": CompanionRuntimeBenchmarkCompletePayload;
	"companion:mode-change": CompanionModeChangePayload;
	"companion:proactive-state-change": CompanionProactiveStateChangePayload;
	"delegation-memory:state-change": DelegationMemoryStateChangePayload;
	"delegation-memory:record-added": DelegationMemoryRecordAddedPayload;
	"debug-capture:state-change": DebugCaptureStateChangePayload;
}

export type EventName = keyof EventMap;
