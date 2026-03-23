/**
 * 应用配置管理服务。
 * 普通配置（provider 类型、baseUrl、model 等）走 Tauri Store / localStorage。
 * 敏感配置（API Key）走 SecretStore（见 secret-store.ts）。
 */

import type { AppConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { createLogger } from "@/services/logger";
import { isTauriEnvironment } from "@/utils/window-sync";

const log = createLogger("config");

const STORE_PATH = "app-config.json";
const STORE_KEY = "config";
const LOCAL_STORAGE_KEY = "paimon-live:app-config";

let cachedConfig: AppConfig | null = null;

function deepMerge(defaults: AppConfig, overrides: Partial<AppConfig>): AppConfig {
	return {
		llm: { ...defaults.llm, ...overrides.llm },
		tts: { ...defaults.tts, ...overrides.tts },
		character: { ...defaults.character, ...overrides.character },
	};
}

// ── Tauri Store 后端 ──

async function loadFromTauriStore(): Promise<Partial<AppConfig>> {
	try {
		const { load } = await import("@tauri-apps/plugin-store");
		const store = await load(STORE_PATH, { defaults: {}, autoSave: false });
		const data = await store.get<Partial<AppConfig>>(STORE_KEY);
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
	} catch (err) {
		log.error("failed to save to Tauri Store", err);
	}
}

// ── localStorage fallback（非 Tauri 环境） ──

function loadFromLocalStorage(): Partial<AppConfig> {
	try {
		const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (raw) return JSON.parse(raw) as Partial<AppConfig>;
	} catch { /* ignore */ }
	return {};
}

function saveToLocalStorage(config: AppConfig): void {
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
	} catch { /* ignore */ }
}

// ── 公共 API ──

export async function loadConfig(): Promise<AppConfig> {
	const overrides = isTauriEnvironment()
		? await loadFromTauriStore()
		: loadFromLocalStorage();

	cachedConfig = deepMerge(DEFAULT_CONFIG, overrides);
	log.info("config loaded", {
		llmProvider: cachedConfig.llm.provider,
		ttsProvider: cachedConfig.tts.provider,
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
	});
	return updated;
}

export async function resetConfig(): Promise<AppConfig> {
	cachedConfig = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm }, tts: { ...DEFAULT_CONFIG.tts }, character: { ...DEFAULT_CONFIG.character } };

	if (isTauriEnvironment()) {
		await saveToTauriStore(cachedConfig);
	} else {
		saveToLocalStorage(cachedConfig);
	}

	log.info("config reset to defaults");
	return cachedConfig;
}
