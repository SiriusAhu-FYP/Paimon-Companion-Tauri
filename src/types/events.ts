// 全局事件类型映射表
// 所有通过 EventBus 发布/订阅的事件在此定义载荷类型

import type { RuntimeMode } from "./runtime";

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

// ── 外部事件 ──

export interface ExternalDanmakuPayload {
	user: string;
	text: string;
	source: string;
}

export interface ExternalGiftPayload {
	user: string;
	giftName: string;
	count: number;
	source: string;
}

export interface ExternalProductMessagePayload {
	type: "persistent" | "priority";
	content: string;
	ttl?: number;
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

	// 外部
	"external:danmaku": ExternalDanmakuPayload;
	"external:gift": ExternalGiftPayload;
	"external:product-message": ExternalProductMessagePayload;
}

export type EventName = keyof EventMap;
