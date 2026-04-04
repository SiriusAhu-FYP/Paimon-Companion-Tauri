/**
 * 应用配置管理服务。
 * 普通配置（provider 类型、baseUrl、model 等）走 Tauri Store / localStorage。
 * 敏感配置（API Key）走 SecretStore（见 secret-store.ts）。
 */

import type { AppConfig, CharacterSettingsConfig, TTSProfile, TTSProviderConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { createLogger } from "@/services/logger";
import { isTauriEnvironment } from "@/utils/window-sync";

const log = createLogger("config");

const STORE_PATH = "app-config.json";
const STORE_KEY = "config";
const LOCAL_STORAGE_KEY = "paimon-companion-tauri:app-config";

let cachedConfig: AppConfig | null = null;

function deepMerge(defaults: AppConfig, overrides: Partial<AppConfig>): AppConfig {
	return {
		llm: { ...defaults.llm, ...overrides.llm },
		tts: { ...defaults.tts, ...overrides.tts },
		asr: { ...defaults.asr, ...overrides.asr },
		character: {
			...defaults.character,
			...overrides.character,
			behaviorConstraints: {
				...defaults.character.behaviorConstraints,
				...(overrides.character?.behaviorConstraints ?? {}),
			},
		},
		llmProfiles: overrides.llmProfiles ?? defaults.llmProfiles,
		ttsProfiles: overrides.ttsProfiles ?? defaults.ttsProfiles,
		asrProfiles: overrides.asrProfiles ?? defaults.asrProfiles,
		activeLlmProfileId: overrides.activeLlmProfileId ?? defaults.activeLlmProfileId,
		activeTtsProfileId: overrides.activeTtsProfileId ?? defaults.activeTtsProfileId,
		activeAsrProfileId: overrides.activeAsrProfileId ?? defaults.activeAsrProfileId,
		knowledge: {
			embedding: {
				...defaults.knowledge.embedding,
				...(overrides.knowledge?.embedding ?? {}),
			},
			embeddingProfiles: overrides.knowledge?.embeddingProfiles ?? defaults.knowledge.embeddingProfiles,
			activeEmbeddingProfileId: overrides.knowledge?.activeEmbeddingProfileId ?? defaults.knowledge.activeEmbeddingProfileId,
			retrievalTopK: overrides.knowledge?.retrievalTopK ?? defaults.knowledge.retrievalTopK,
			searchMode: overrides.knowledge?.searchMode ?? defaults.knowledge.searchMode,
			rerank: {
				...defaults.knowledge.rerank,
				...(overrides.knowledge?.rerank ?? {}),
			},
			rerankProfiles: overrides.knowledge?.rerankProfiles ?? defaults.knowledge.rerankProfiles,
			activeRerankProfileId: overrides.knowledge?.activeRerankProfileId ?? defaults.knowledge.activeRerankProfileId,
			rerankEnabled: overrides.knowledge?.rerankEnabled ?? defaults.knowledge.rerankEnabled,
		},
	};
}

/** 旧版仅含 persona 的 character 配置 → CharacterSettingsConfig */
function normalizeCharacterSettings(
	character: CharacterSettingsConfig & { persona?: string },
): CharacterSettingsConfig {
	const legacyPersona = typeof character.persona === "string" ? character.persona : "";
	const customPersona =
		character.customPersona !== undefined && character.customPersona !== ""
			? character.customPersona
			: legacyPersona || DEFAULT_CONFIG.character.customPersona;
	return {
		activeProfileId: character.activeProfileId ?? DEFAULT_CONFIG.character.activeProfileId,
		customPersona,
		behaviorConstraints: {
			...DEFAULT_CONFIG.character.behaviorConstraints,
			...(character.behaviorConstraints ?? {}),
		},
	};
}

function normalizeTtsConfig(tts: TTSProviderConfig & { gptWeightsPath?: string }): TTSProviderConfig {
	const rawProvider = (tts as { provider?: string }).provider;
	const provider = rawProvider === "browser-native" ? "gpt-sovits" : (rawProvider ?? "mock");
	return {
		provider: provider as TTSProviderConfig["provider"],
		baseUrl: tts.baseUrl ?? "",
		speakerId: tts.speakerId ?? "",
		speed: tts.speed ?? 1.0,
		gptWeightsPath: (tts as TTSProviderConfig & { gptWeightsPath?: string }).gptWeightsPath ?? "",
		sovitsWeightsPath: (tts as TTSProviderConfig & { sovitsWeightsPath?: string }).sovitsWeightsPath ?? "",
		refAudioPath: (tts as TTSProviderConfig & { refAudioPath?: string }).refAudioPath ?? "",
		promptText: (tts as TTSProviderConfig & { promptText?: string }).promptText ?? "",
		promptLang: (tts as TTSProviderConfig & { promptLang?: string }).promptLang ?? "zh",
		textLang: tts.textLang ?? "zh",
	};
}

function normalizeTtsProfile(profile: TTSProfile & { gptWeightsPath?: string }): TTSProfile {
	return {
		id: profile.id,
		name: profile.name,
		...normalizeTtsConfig(profile),
	};
}

// ── Tauri Store 后端 ──

async function loadFromTauriStore(): Promise<Partial<AppConfig>> {
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load(STORE_PATH, { defaults: {}, autoSave: false });
		const data = await store.get<Partial<AppConfig>>(STORE_KEY);
		log.info("loaded from Tauri Store", {
			found: !!data,
			provider: data?.llm?.provider ?? "none",
			ttsProfilesCount: data?.ttsProfiles?.length ?? 0,
			activeTtsProfileId: data?.activeTtsProfileId ?? "",
			ttsBaseUrl: data?.tts?.baseUrl ?? "none",
		});
		return data ?? {};
	} catch (err) {
		log.warn("failed to load from Tauri Store, using defaults", err);
		return {};
	}
}

async function saveToTauriStore(config: AppConfig): Promise<void> {
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load(STORE_PATH, { defaults: {}, autoSave: false });
		await store.set(STORE_KEY, config);
		await store.save();
		log.info("saved to Tauri Store", {
			provider: config.llm.provider,
			ttsProvider: config.tts.provider,
			ttsProfilesCount: config.ttsProfiles.length,
			activeTtsProfileId: config.activeTtsProfileId,
			ttsBaseUrl: config.tts.baseUrl,
			firstProfile: config.ttsProfiles[0] ? { name: config.ttsProfiles[0].name, baseUrl: config.ttsProfiles[0].baseUrl } : null,
		});
	} catch (err) {
		log.error("failed to save to Tauri Store", err);
	}
}

// ── localStorage fallback（非 Tauri 环境） ──

function loadFromLocalStorage(): Partial<AppConfig> {
	try {
		const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<AppConfig>;
			log.info("loaded from localStorage", { provider: parsed?.llm?.provider ?? "none" });
			return parsed;
		}
		log.info("localStorage empty, using defaults");
	} catch (err) {
		log.warn("failed to read localStorage", err);
	}
	return {};
}

function saveToLocalStorage(config: AppConfig): void {
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
		log.info("saved to localStorage", { provider: config.llm.provider });
	} catch (err) {
		log.error("failed to write localStorage", err);
	}
}

// ── 公共 API ──

export async function loadConfig(): Promise<AppConfig> {
	const overrides = isTauriEnvironment()
		? await loadFromTauriStore()
		: loadFromLocalStorage();

	cachedConfig = deepMerge(DEFAULT_CONFIG, overrides);
	cachedConfig = {
		...cachedConfig,
		tts: normalizeTtsConfig(cachedConfig.tts as TTSProviderConfig & { gptWeightsPath?: string }),
		ttsProfiles: cachedConfig.ttsProfiles.map((profile) =>
			normalizeTtsProfile(profile as TTSProfile & { gptWeightsPath?: string }),
		),
		character: normalizeCharacterSettings(
			cachedConfig.character as CharacterSettingsConfig & { persona?: string },
		),
	};
	log.info("config loaded", {
		llmProvider: cachedConfig.llm.provider,
		ttsProvider: cachedConfig.tts.provider,
		asrProvider: cachedConfig.asr.provider,
	});
	return cachedConfig;
}

export function getConfig(): AppConfig {
	if (!cachedConfig) {
		log.warn("config not loaded yet, returning defaults");
		return { ...DEFAULT_CONFIG };
	}
	return cachedConfig;
}

export async function updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
	const current = getConfig();
	const updated = deepMerge(current, partial);
	cachedConfig = updated;

	if (isTauriEnvironment()) {
		await saveToTauriStore(updated);
	} else {
		saveToLocalStorage(updated);
	}

	log.info("config updated", {
		llmProvider: updated.llm.provider,
		ttsProvider: updated.tts.provider,
		asrProvider: updated.asr.provider,
	});
	return updated;
}

export async function resetConfig(): Promise<AppConfig> {
	cachedConfig = {
		...DEFAULT_CONFIG,
		llm: { ...DEFAULT_CONFIG.llm },
		tts: { ...DEFAULT_CONFIG.tts },
		asr: { ...DEFAULT_CONFIG.asr },
		character: { ...DEFAULT_CONFIG.character },
		llmProfiles: [],
		ttsProfiles: [],
		asrProfiles: [],
		activeLlmProfileId: "",
		activeTtsProfileId: "",
		activeAsrProfileId: "",
	};

	if (isTauriEnvironment()) {
		await saveToTauriStore(cachedConfig);
	} else {
		saveToLocalStorage(cachedConfig);
	}

	log.info("config reset to defaults");
	return cachedConfig;
}
