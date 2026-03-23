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
		persona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
	},
};
