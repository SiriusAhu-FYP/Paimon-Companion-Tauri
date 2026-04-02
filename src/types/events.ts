// 全局事件类型映射表
// 所有通过 EventBus 发布/订阅的事件在此定义载荷类型

import type { RuntimeMode } from "./runtime";
import type {
	FunctionalActionKind,
	FunctionalLogLevel,
	FunctionalRuntimeState,
} from "./functional";
import type { Game2048Move, Game2048State } from "./game-2048";

// ── 运行时事件 ──

export interface RuntimeModeChangePayload {
	mode: RuntimeMode;
	previous: RuntimeMode;
}

// ── 音频事件 ──

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

// ── LLM 事件 ──

export interface LlmRequestStartPayload {
	userText: string;
}

export interface LlmStreamChunkPayload {
	delta: string;
}

export interface LlmToolCallPayload {
	name: string;
	args: Record<string, unknown>;
}

export interface LlmResponseEndPayload {
	fullText: string;
}

export interface LlmErrorPayload {
	error: string;
}

// ── 角色事件 ──

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
	isSpeaking: boolean;
}

export interface CharacterSwitchPayload {
	characterId: string;
}

// ── 系统事件 ──

export interface SystemErrorPayload {
	module: string;
	error: string;
}

// ── 功能执行事件 ──

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
}

export interface Game2048AttemptPayload {
	runId: string;
	move: Game2048Move;
	changed: boolean;
	changeRatio: number;
}

export interface Game2048RunCompletePayload {
	runId: string;
	success: boolean;
	selectedMove: Game2048Move | null;
	boardChanged: boolean;
	summary: string;
}

// ── 事件名 → 载荷类型的统一映射 ──

export interface EventMap {
	// 运行时
	"runtime:mode-change": RuntimeModeChangePayload;

	// 音频
	"audio:vad-start": void;
	"audio:vad-end": AudioVadEndPayload;
	"audio:asr-result": AudioAsrResultPayload;
	"audio:tts-start": AudioTtsStartPayload;
	"audio:tts-end": void;

	// LLM
	"llm:request-start": LlmRequestStartPayload;
	"llm:stream-chunk": LlmStreamChunkPayload;
	"llm:tool-call": LlmToolCallPayload;
	"llm:response-end": LlmResponseEndPayload;
	"llm:error": LlmErrorPayload;

	// 角色
	"character:expression": CharacterExpressionPayload;
	"character:motion": CharacterMotionPayload;
	"character:state-change": CharacterStateChangePayload;
	"character:switch": CharacterSwitchPayload;

	// 系统
	"system:emergency-stop": void;
	"system:manual-takeover": void;
	"system:resume": void;
	"system:error": SystemErrorPayload;

	// 功能执行
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
}

export type EventName = keyof EventMap;
