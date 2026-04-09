/**
 * 敏感配置存储封装。
 * Tauri 环境：通过 invoke 调用 Rust 侧 keyring 命令（系统钥匙串）。
 * 非 Tauri 环境：降级到 sessionStorage（仅开发调试用，不持久化）。
 */

import { isTauriEnvironment } from "@/utils/window-sync";
import { invoke } from "@tauri-apps/api/core";
import { createLogger } from "@/services/logger";

const log = createLogger("secret-store");

const SESSION_PREFIX = "paimon-companion-tauri:secret:";

// ── Tauri invoke 后端 ──

async function invokeSecret<T>(cmd: string, args: Record<string, string>): Promise<T> {
	return invoke<T>(cmd, args);
}

// ── sessionStorage fallback ──

function sessionGet(key: string): string | null {
	try {
		return sessionStorage.getItem(SESSION_PREFIX + key);
	} catch {
		return null;
	}
}

function sessionSet(key: string, value: string): void {
	try {
		sessionStorage.setItem(SESSION_PREFIX + key, value);
	} catch { /* ignore */ }
}

function sessionDelete(key: string): void {
	try {
		sessionStorage.removeItem(SESSION_PREFIX + key);
	} catch { /* ignore */ }
}

// ── 公共 API ──

export async function setSecret(key: string, value: string): Promise<void> {
	if (isTauriEnvironment()) {
		await invokeSecret("secret_set", { key, value });
		log.info(`secret '${key}' saved to keyring`);
	} else {
		sessionSet(key, value);
		log.info(`secret '${key}' saved to sessionStorage (dev fallback)`);
	}
}

export async function getSecret(key: string): Promise<string | null> {
	if (isTauriEnvironment()) {
		try {
			const result = await invokeSecret<string | null>("secret_get", { key });
			return result;
		} catch (err) {
			log.warn(`failed to get secret '${key}' from keyring`, err);
			return null;
		}
	}
	return sessionGet(key);
}

export async function hasSecret(key: string): Promise<boolean> {
	if (isTauriEnvironment()) {
		try {
			return await invokeSecret<boolean>("secret_has", { key });
		} catch (err) {
			log.warn(`failed to check secret '${key}' in keyring`, err);
			return false;
		}
	}
	return sessionGet(key) !== null;
}

export async function deleteSecret(key: string): Promise<void> {
	if (isTauriEnvironment()) {
		await invokeSecret("secret_delete", { key });
		log.info(`secret '${key}' deleted from keyring`);
	} else {
		sessionDelete(key);
		log.info(`secret '${key}' deleted from sessionStorage`);
	}
}
