import type { EventBus } from "@/services/event-bus";
import type {
	PersistentSessionSummary,
	CrossSessionIndex,
	CrossSessionIndexEntry,
	SessionDigestRecord,
	SalientEvent,
} from "@/types/memory";
import { createLogger } from "@/services/logger";
import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, writeTextFile, remove, stat } from "@tauri-apps/plugin-fs";

const log = createLogger("persistent-memory");

const SESSION_MEMORY_DIR = "logs/session-memory";
const INDEX_FILE = "cross-session-index.json";
const MAX_LOADED_SESSIONS = 5;
const MAX_CROSS_SESSION_CONTEXT_CHARS = 800;
const DEBUG_CAPTURE_TTL_DAYS = 7;
const SESSION_MEMORY_TTL_DAYS = 30;
const MAX_DEBUG_CAPTURES_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const SCRATCHPAD_TTL_DAYS = 1;

export interface PersistentMemoryServiceDeps {
	bus: EventBus;
}

export class PersistentMemoryService {
	private bus: EventBus;
	private basePath: string | null = null;
	private index: CrossSessionIndex = { version: 1, entries: [] };
	private loadedSessions: PersistentSessionSummary[] = [];
	private currentSessionId: string | null = null;
	private initialized = false;

	constructor(deps: PersistentMemoryServiceDeps) {
		this.bus = deps.bus;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			const appDir = await appDataDir();
			this.basePath = `${appDir}${SESSION_MEMORY_DIR}`;
			await mkdir(this.basePath, { recursive: true });
			await this.loadIndex();
			await this.loadRecentSessions();
			await this.cleanupExpired();
			this.initialized = true;
			log.info("persistent memory initialized", {
				sessions: this.index.entries.length,
				loaded: this.loadedSessions.length,
			});
		} catch (err) {
			log.error("persistent memory initialization failed", err);
		}
	}

	private async loadIndex(): Promise<void> {
		if (!this.basePath) return;
		try {
			const indexPath = `${this.basePath}/${INDEX_FILE}`;
			const raw = await readTextFile(indexPath);
			this.index = JSON.parse(raw) as CrossSessionIndex;
		} catch {
			this.index = { version: 1, entries: [] };
		}
	}

	private async saveIndex(): Promise<void> {
		if (!this.basePath) return;
		try {
			const indexPath = `${this.basePath}/${INDEX_FILE}`;
			await writeTextFile(indexPath, JSON.stringify(this.index, null, 2));
		} catch (err) {
			log.error("failed to save cross-session index", err);
		}
	}

	private async loadRecentSessions(): Promise<void> {
		if (!this.basePath) return;

		const recent = this.index.entries
			.slice()
			.sort((a, b) => b.endedAt - a.endedAt)
			.slice(0, MAX_LOADED_SESSIONS);

		this.loadedSessions = [];
		for (const entry of recent) {
			try {
				const filePath = `${this.basePath}/${entry.sessionId}.json`;
				const raw = await readTextFile(filePath);
				const session = JSON.parse(raw) as PersistentSessionSummary;
				this.loadedSessions.push(session);
			} catch {
				log.warn("failed to load session file", { sessionId: entry.sessionId });
			}
		}
	}

	async persistSession(params: {
		sessionId: string;
		startedAt: number;
		targetTitle: string;
		digests: SessionDigestRecord[];
		salientEvents: SalientEvent[];
	}): Promise<void> {
		if (!this.basePath) {
			log.warn("not initialized, cannot persist session");
			return;
		}

		const now = Date.now();
		const finalDigest = params.digests.length > 0
			? params.digests[params.digests.length - 1]!.digest
			: "（无摘要记录）";

		const tags = this.extractTags(params.digests, params.salientEvents);

		const summary: PersistentSessionSummary = {
			sessionId: params.sessionId,
			startedAt: params.startedAt,
			endedAt: now,
			targetTitle: params.targetTitle,
			totalDigests: params.digests.length,
			finalDigest,
			salientEvents: params.salientEvents,
			tags,
		};

		try {
			const filePath = `${this.basePath}/${params.sessionId}.json`;
			await writeTextFile(filePath, JSON.stringify(summary, null, 2));

			const indexEntry: CrossSessionIndexEntry = {
				sessionId: params.sessionId,
				startedAt: params.startedAt,
				endedAt: now,
				targetTitle: params.targetTitle,
				tags,
				digestPreview: finalDigest.slice(0, 100),
			};

			this.index.entries = this.index.entries.filter((e) => e.sessionId !== params.sessionId);
			this.index.entries.push(indexEntry);
			await this.saveIndex();

			this.bus.emit("memory:session-persisted", { sessionId: params.sessionId, filePath });
			log.info("session persisted", { sessionId: params.sessionId, digests: params.digests.length });
		} catch (err) {
			log.error("failed to persist session", err);
		}
	}

	getCrossSessionContext(): string {
		if (this.loadedSessions.length === 0) return "";

		const parts = this.loadedSessions
			.slice(0, 3)
			.map((s) => {
				const date = new Date(s.startedAt).toLocaleDateString();
				const events = s.salientEvents.length > 0
					? `（关键事件: ${s.salientEvents.map((e) => e.description).join("; ")}）`
					: "";
				return `[${date}] ${s.targetTitle}: ${s.finalDigest}${events}`;
			});

		const result = parts.join("\n");
		return result.length > MAX_CROSS_SESSION_CONTEXT_CHARS
			? `${result.slice(0, MAX_CROSS_SESSION_CONTEXT_CHARS)}\n[…已截断…]`
			: result;
	}

	getLoadedSessions(): PersistentSessionSummary[] {
		return [...this.loadedSessions];
	}

	getIndex(): CrossSessionIndex {
		return { ...this.index, entries: [...this.index.entries] };
	}

	setCurrentSessionId(id: string): void {
		this.currentSessionId = id;
	}

	getCurrentSessionId(): string | null {
		return this.currentSessionId;
	}

	private extractTags(digests: SessionDigestRecord[], events: SalientEvent[]): string[] {
		const tags = new Set<string>();
		for (const e of events) {
			tags.add(e.type);
		}
		for (const d of digests) {
			if (d.emotionArc) {
				const emotions = d.emotionArc.split("→").map((s) => s.trim());
				for (const em of emotions) {
					if (em && em !== "unknown") tags.add(em);
				}
			}
		}
		return [...tags].slice(0, 10);
	}

	private async cleanupExpired(): Promise<void> {
		if (!this.basePath) return;

		const now = Date.now();
		const sessionTtl = SESSION_MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000;
		const debugTtl = DEBUG_CAPTURE_TTL_DAYS * 24 * 60 * 60 * 1000;

		const expiredSessions = this.index.entries.filter((e) => now - e.endedAt > sessionTtl);
		for (const entry of expiredSessions) {
			try {
				await remove(`${this.basePath}/${entry.sessionId}.json`);
				log.info("removed expired session", { sessionId: entry.sessionId });
			} catch {
				// file may not exist
			}
		}

		if (expiredSessions.length > 0) {
			this.index.entries = this.index.entries.filter((e) => now - e.endedAt <= sessionTtl);
			await this.saveIndex();
		}

		try {
			const appDir = await appDataDir();
			const debugDir = `${appDir}logs/debug-captures`;
			await this.cleanupDebugCaptures(debugDir, debugTtl, now);
		} catch {
			// debug-captures dir may not exist
		}

		try {
			const appDir = await appDataDir();
			const scratchpadDir = `${appDir}logs/delegation-scratchpads`;
			await this.cleanupScratchpads(scratchpadDir, now);
		} catch {
			// scratchpads dir may not exist
		}
	}

	private async cleanupDebugCaptures(debugDir: string, debugTtl: number, now: number): Promise<void> {
		const entries = await readDir(debugDir);
		const dirs: { name: string; date: number }[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory) continue;
			const match = entry.name.match(/^(\d{8})-(\d{6})/);
			if (!match) continue;
			const dateStr = match[1]!;
			const year = parseInt(dateStr.slice(0, 4), 10);
			const month = parseInt(dateStr.slice(4, 6), 10) - 1;
			const day = parseInt(dateStr.slice(6, 8), 10);
			const dirDate = new Date(year, month, day).getTime();

			if (now - dirDate > debugTtl) {
				try {
					await remove(`${debugDir}/${entry.name}`, { recursive: true });
					log.info("removed expired debug capture", { name: entry.name });
				} catch {
					// best-effort
				}
			} else {
				dirs.push({ name: entry.name, date: dirDate });
			}
		}

		// Size-based LRU: if remaining dirs exceed threshold, remove oldest first
		dirs.sort((a, b) => a.date - b.date);
		let totalSize = 0;
		const dirSizes: { name: string; date: number; size: number }[] = [];
		for (const d of dirs) {
			try {
				const dirPath = `${debugDir}/${d.name}`;
				const files = await readDir(dirPath);
				let dirSize = 0;
				for (const f of files) {
					if (f.isDirectory) continue;
					try {
						const s = await stat(`${dirPath}/${f.name}`);
						dirSize += s.size;
					} catch {
						// ignore stat errors
					}
				}
				totalSize += dirSize;
				dirSizes.push({ ...d, size: dirSize });
			} catch {
				// ignore
			}
		}

		if (totalSize > MAX_DEBUG_CAPTURES_BYTES) {
			log.info("debug captures exceed size threshold", {
				totalMB: (totalSize / (1024 * 1024)).toFixed(0),
				thresholdMB: (MAX_DEBUG_CAPTURES_BYTES / (1024 * 1024)).toFixed(0),
			});
			for (const d of dirSizes) {
				if (totalSize <= MAX_DEBUG_CAPTURES_BYTES) break;
				try {
					await remove(`${debugDir}/${d.name}`, { recursive: true });
					totalSize -= d.size;
					log.info("removed debug capture (LRU)", { name: d.name, sizeMB: (d.size / (1024 * 1024)).toFixed(1) });
				} catch {
					// best-effort
				}
			}
		}
	}

	private async cleanupScratchpads(scratchpadDir: string, now: number): Promise<void> {
		const ttl = SCRATCHPAD_TTL_DAYS * 24 * 60 * 60 * 1000;
		try {
			const entries = await readDir(scratchpadDir);
			for (const entry of entries) {
				if (!entry.isDirectory) continue;
				const match = entry.name.match(/^(\d{8})-(\d{6})/);
				if (!match) continue;
				const dateStr = match[1]!;
				const year = parseInt(dateStr.slice(0, 4), 10);
				const month = parseInt(dateStr.slice(4, 6), 10) - 1;
				const day = parseInt(dateStr.slice(6, 8), 10);
				const dirDate = new Date(year, month, day).getTime();
				if (now - dirDate > ttl) {
					try {
						await remove(`${scratchpadDir}/${entry.name}`, { recursive: true });
						log.info("removed expired scratchpad", { name: entry.name });
					} catch {
						// best-effort
					}
				}
			}
		} catch {
			// directory may not exist
		}
	}

	async dispose(): Promise<void> {
		this.initialized = false;
	}
}
