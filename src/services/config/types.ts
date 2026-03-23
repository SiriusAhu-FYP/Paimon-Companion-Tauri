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

export type TTSProviderType = "http-api" | "mock";

export interface TTSProviderConfig {
	provider: TTSProviderType;
	baseUrl: string;
	speakerId: string;
	speed: number;
}

// ── Character ──

export interface CharacterConfig {
	persona: string;
}

// ── 顶层 AppConfig ──

export interface AppConfig {
	llm: LLMProviderConfig;
	tts: TTSProviderConfig;
	character: CharacterConfig;
}

// ── 敏感配置 key 约定 ──

export const SECRET_KEYS = {
	LLM_API_KEY: "llm-api-key",
	TTS_API_KEY: "tts-api-key",
} as const;

export type SecretKeyName = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];

// ── 默认值 ──

export const DEFAULT_CONFIG: AppConfig = {
	llm: {
		provider: "mock",
		baseUrl: "",
		model: "",
		temperature: 0.7,
		maxTokens: 2048,
	},
	tts: {
		provider: "mock",
		baseUrl: "",
		speakerId: "",
		speed: 1.0,
	},
	character: {
		persona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
	},
};
