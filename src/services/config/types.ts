/**
 * 应用配置类型定义。
 * 普通配置走 Tauri Store（明文 JSON），敏感配置走 SecretStore（系统 keyring）。
 */

// ── LLM Provider ──

export type LLMProviderType = "openai-compatible" | "mock";

export interface LLMProviderConfig {
	provider: LLMProviderType;
	baseUrl: string;
	model: string;
	temperature: number;
	maxTokens: number;
}

// ── TTS Provider ──

export type TTSProviderType = "gpt-sovits" | "mock";

export interface TTSProviderConfig {
	provider: TTSProviderType;
	baseUrl: string;
	speakerId: string;
	speed: number;
	gptWeightsPath: string;
	sovitsWeightsPath: string;
	refAudioPath: string;
	promptText: string;
	promptLang: string;
	textLang: string;
}

// ── ASR Provider ──

export type ASRProviderType = "mock" | "local-sherpa" | "volcengine" | "aliyun";

export interface ASRProviderConfig {
	provider: ASRProviderType;
	baseUrl: string;
	model: string;
	language: string;
	autoDetectLanguage: boolean;
	vadEnabled: boolean;
	vadAggressiveness: number;
	silenceThresholdMs: number;
	minSpeechMs: number;
}

// ── LLM Profile（可复用的配置档案）──

export interface LLMProfile {
	id: string;
	name: string;
	provider: LLMProviderType;
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	maxTokens: number;
}

// ── TTS Profile（可复用的配置档案）──

export interface TTSProfile {
	id: string;
	name: string;
	provider: TTSProviderType;
	baseUrl: string;
	speakerId: string;
	speed: number;
	gptWeightsPath: string;
	sovitsWeightsPath: string;
	refAudioPath: string;
	promptText: string;
	promptLang: string;
	textLang: string;
}

// ── ASR Profile（可复用的语音识别配置档案） ──

export interface ASRProfile {
	id: string;
	name: string;
	provider: ASRProviderType;
	apiKey: string;
	baseUrl: string;
	model: string;
	language: string;
	autoDetectLanguage: boolean;
	vadEnabled: boolean;
	vadAggressiveness: number;
	silenceThresholdMs: number;
	minSpeechMs: number;
}

// ── Character（应用设置：当前卡 ID、用户附加人设）──

export interface BehaviorConstraintsConfig {
	enabled: boolean;
	maxReplyLength: number;
	/** 用户追加的自定义约束文本，拼入行为约束段落 */
	customRules: string;
}

export interface CharacterSettingsConfig {
	/** 当前选中的角色档案 id，空串表示未选卡（仅用 customPersona） */
	activeProfileId: string;
	/** 用户自定义附加人设，拼入 system prompt（优先级低于卡内 system_prompt / persona） */
	customPersona: string;
	/** affect core 的单个空闲衰减窗口秒数：先衰减到短时残留状态，再经过一个窗口回到 neutral */
	expressionIdleTimeoutSeconds: number;
	behaviorConstraints: BehaviorConstraintsConfig;
}

export interface CompanionRuntimeConfig {
	localVisionBaseUrl: string;
	localVisionModel: string;
	captureIntervalMs: number;
	summaryWindowMs: number;
	historyRetentionMs: number;
}

// ── Knowledge（知识库配置，独立于 LLM / TTS） ──

export type { KnowledgeConfig, EmbeddingProviderConfig, EmbeddingProfile, KnowledgeSearchMode, RerankProviderConfig, RerankProfile } from "@/types/knowledge";

// ── 顶层 AppConfig ──

export interface AppConfig {
	locale: "zh" | "en";
	llm: LLMProviderConfig;
	tts: TTSProviderConfig;
	asr: ASRProviderConfig;
	character: CharacterSettingsConfig;
	companionRuntime: CompanionRuntimeConfig;
	llmProfiles: LLMProfile[];
	ttsProfiles: TTSProfile[];
	asrProfiles: ASRProfile[];
	activeLlmProfileId: string;
	activeTtsProfileId: string;
	activeAsrProfileId: string;
	knowledge: import("@/types/knowledge").KnowledgeConfig;
}

// ── 敏感配置 key 约定 ──
// llm-api-key:{profileId}  实现 per-profile 隔离

export const SECRET_KEYS = {
	LLM_API_KEY: (profileId: string) => `llm-api-key:${profileId}`,
	TTS_API_KEY: "tts-api-key",
	ASR_API_KEY: (profileId: string) => `asr-api-key:${profileId}`,
	EMBEDDING_API_KEY: (profileId: string) => `embedding-api-key:${profileId}`,
	RERANK_API_KEY: (profileId: string) => `rerank-api-key:${profileId}`,
} as const;

// ── 默认值 ──

export const DEFAULT_CONFIG: AppConfig = {
	locale: "zh",
	llm: {
		provider: "mock",
		baseUrl: "",
		model: "",
		temperature: 0.7,
		maxTokens: 4096,
	},
	tts: {
		provider: "mock",
		baseUrl: "http://localhost:9880",
		speakerId: "",
		speed: 1.0,
		gptWeightsPath: "",
		sovitsWeightsPath: "",
		refAudioPath: "",
		promptText: "",
		promptLang: "zh",
		textLang: "zh",
	},
	asr: {
		provider: "local-sherpa",
		baseUrl: "",
		model: "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16",
		language: "zh-en",
		autoDetectLanguage: true,
		vadEnabled: true,
		vadAggressiveness: 2,
		silenceThresholdMs: 800,
		minSpeechMs: 1000,
	},
	character: {
		activeProfileId: "",
		customPersona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
		expressionIdleTimeoutSeconds: 15,
		behaviorConstraints: {
			enabled: true,
			maxReplyLength: 150,
			customRules: "",
		},
	},
	companionRuntime: {
		localVisionBaseUrl: "http://localhost:8000/v1",
		localVisionModel: "Qwen/Qwen3-VL-2B-Instruct",
		captureIntervalMs: 1000,
		summaryWindowMs: 10000,
		historyRetentionMs: 60000,
	},
	llmProfiles: [],
	ttsProfiles: [],
	asrProfiles: [],
	activeLlmProfileId: "",
	activeTtsProfileId: "",
	activeAsrProfileId: "",
	knowledge: {
		embedding: {
			baseUrl: "",
			model: "",
			dimension: 1536,
		},
		embeddingProfiles: [],
		activeEmbeddingProfileId: "",
		retrievalTopK: 5,
		searchMode: "hybrid" as const,
		rerank: {
			baseUrl: "",
			model: "",
		},
		rerankProfiles: [],
		activeRerankProfileId: "",
		rerankEnabled: false,
	},
};
