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
	// GPT-SoVITS 专属字段（服务端路径）
	gptWeightsPath: string;
	sovitsWeightsPath: string;
	refAudioPath: string;
	promptText: string;
	promptLang: string;
	textLang: string;
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

// ── TTS Profile（可复用的配置档案，TTS 不等于 GPT-SoVITS）──

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

// ── Character（应用设置：当前卡 ID、用户附加人设）──

export interface CharacterSettingsConfig {
	/** 当前选中的角色档案 id，空串表示未选卡（仅用 customPersona） */
	activeProfileId: string;
	/** 用户自定义附加人设，拼入 system prompt（优先级低于卡内 system_prompt / persona） */
	customPersona: string;
}

// ── Knowledge（知识库配置，独立于 LLM / TTS） ──

export type { KnowledgeConfig, EmbeddingProviderConfig, EmbeddingProfile, KnowledgeSearchMode } from "@/types/knowledge";

// ── 顶层 AppConfig ──

export interface AppConfig {
	llm: LLMProviderConfig;
	tts: TTSProviderConfig;
	character: CharacterSettingsConfig;
	llmProfiles: LLMProfile[];
	ttsProfiles: TTSProfile[];
	activeLlmProfileId: string;
	activeTtsProfileId: string;
	knowledge: import("@/types/knowledge").KnowledgeConfig;
}

// ── 敏感配置 key 约定 ──
// llm-api-key:{profileId}  实现 per-profile 隔离

export const SECRET_KEYS = {
	LLM_API_KEY: (profileId: string) => `llm-api-key:${profileId}`,
	TTS_API_KEY: "tts-api-key",
	EMBEDDING_API_KEY: (profileId: string) => `embedding-api-key:${profileId}`,
} as const;

// ── 默认值 ──

export const DEFAULT_CONFIG: AppConfig = {
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
	character: {
		activeProfileId: "",
		customPersona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
	},
	llmProfiles: [],
	ttsProfiles: [],
	activeLlmProfileId: "",
	activeTtsProfileId: "",
	knowledge: {
		embedding: {
			baseUrl: "",
			model: "",
			dimension: 1536,
		},
		embeddingProfiles: [],
		activeEmbeddingProfileId: "",
		retrievalTopK: 5,
		searchMode: "vector" as const,
	},
};
