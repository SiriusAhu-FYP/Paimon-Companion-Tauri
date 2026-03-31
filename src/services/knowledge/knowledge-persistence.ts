// Phase 3.5 — 知识持久化封装
// 隔离 Tauri Store / localStorage，便于后续替换为文件或 SQLite

import { isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import type { KnowledgeDocumentStore, KnowledgeIndexStore } from "@/types/knowledge";

const log = createLogger("knowledge-persistence");

const STORE_PATH = "knowledge-store.json";
const DOCS_KEY = "knowledge-documents";
const INDEX_KEY = "knowledge-index";
const LS_DOCS_KEY = "paimon-companion-tauri:knowledge-documents";
const LS_INDEX_KEY = "paimon-companion-tauri:knowledge-index";

// ── Tauri Store 后端 ──

async function getTauriStore() {
	const { load } = await import("@tauri-apps/plugin-store");
	return load(STORE_PATH, { defaults: {}, autoSave: false });
}

// ── 原始文档存储 ──

export async function loadDocuments(): Promise<KnowledgeDocumentStore | null> {
	try {
		if (isTauriEnvironment()) {
			const store = await getTauriStore();
			const data = await store.get<KnowledgeDocumentStore>(DOCS_KEY);
			log.info("documents loaded from Tauri Store", { found: !!data, count: data?.documents?.length ?? 0 });
			return data ?? null;
		}

		const raw = localStorage.getItem(LS_DOCS_KEY);
		if (raw) {
			const data = JSON.parse(raw) as KnowledgeDocumentStore;
			log.info("documents loaded from localStorage", { count: data.documents?.length ?? 0 });
			return data;
		}
		log.info("no persisted documents found");
		return null;
	} catch (err) {
		log.warn("failed to load documents", err);
		return null;
	}
}

export async function saveDocuments(data: KnowledgeDocumentStore): Promise<void> {
	try {
		if (isTauriEnvironment()) {
			const store = await getTauriStore();
			await store.set(DOCS_KEY, data);
			await store.save();
			log.info("documents saved to Tauri Store", { count: data.documents.length });
			return;
		}

		localStorage.setItem(LS_DOCS_KEY, JSON.stringify(data));
		log.info("documents saved to localStorage", { count: data.documents.length });
	} catch (err) {
		log.error("failed to save documents", err);
	}
}

// ── 索引快照存储 ──

export async function loadIndex(): Promise<KnowledgeIndexStore | null> {
	try {
		if (isTauriEnvironment()) {
			const store = await getTauriStore();
			const data = await store.get<KnowledgeIndexStore>(INDEX_KEY);
			log.info("index loaded from Tauri Store", { found: !!data });
			return data ?? null;
		}

		const raw = localStorage.getItem(LS_INDEX_KEY);
		if (raw) {
			const data = JSON.parse(raw) as KnowledgeIndexStore;
			log.info("index loaded from localStorage");
			return data;
		}
		log.info("no persisted index found");
		return null;
	} catch (err) {
		log.warn("failed to load index", err);
		return null;
	}
}

export async function saveIndex(data: KnowledgeIndexStore): Promise<void> {
	try {
		if (isTauriEnvironment()) {
			const store = await getTauriStore();
			await store.set(INDEX_KEY, data);
			await store.save();
			log.info("index saved to Tauri Store");
			return;
		}

		localStorage.setItem(LS_INDEX_KEY, JSON.stringify(data));
		log.info("index saved to localStorage");
	} catch (err) {
		log.error("failed to save index", err);
	}
}

// ── 清空 ──

export async function clearAll(): Promise<void> {
	try {
		if (isTauriEnvironment()) {
			const store = await getTauriStore();
			await store.delete(DOCS_KEY);
			await store.delete(INDEX_KEY);
			await store.save();
		} else {
			localStorage.removeItem(LS_DOCS_KEY);
			localStorage.removeItem(LS_INDEX_KEY);
		}
		log.info("all knowledge persistence cleared");
	} catch (err) {
		log.error("failed to clear persistence", err);
	}
}
