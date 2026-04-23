import type { EventBus } from "@/services/event-bus";
import type { LongTermMemoryEntry } from "@/types/memory";
import { createLogger } from "@/services/logger";
import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, writeTextFile, remove } from "@tauri-apps/plugin-fs";

const log = createLogger("memory-log");

const MEMORY_LOG_DIR = "logs/memory-pending";

export interface MemoryLogEntry {
	id: string;
	source: "companion" | "delegation";
	createdAt: number;
	/** Raw context that will be compressed into LTM by the promotion step */
	rawContext: string;
	/** Pre-parsed entry if already compressed (e.g. delegation events) */
	preCompressed?: LongTermMemoryEntry;
	promoted: boolean;
}

export interface MemoryLogServiceDeps {
	bus: EventBus;
}

/**
 * Unified intermediate log area.
 * Companion summaries and delegation events land here first, before
 * being promoted to long-term memory by LongTermMemoryService.
 */
export class MemoryLogService {
	private bus: EventBus;
	private basePath: string | null = null;
	private initialized = false;

	constructor(deps: MemoryLogServiceDeps) {
		this.bus = deps.bus;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		try {
			const appDir = await appDataDir();
			this.basePath = `${appDir}${MEMORY_LOG_DIR}`;
			await mkdir(this.basePath, { recursive: true });
			this.initialized = true;
			log.info("memory log service initialized", { basePath: this.basePath });
		} catch (err) {
			log.error("memory log initialization failed", err);
		}
	}

	/** Write a pending memory log entry to disk. */
	async append(entry: MemoryLogEntry): Promise<void> {
		if (!this.basePath) {
			log.warn("not initialized, cannot append");
			return;
		}
		try {
			const filePath = `${this.basePath}/${entry.id}.json`;
			await writeTextFile(filePath, JSON.stringify(entry, null, "\t"));
			this.bus.emit("memory:log-appended", { entry });
			log.debug("memory log appended", { id: entry.id, source: entry.source });
		} catch (err) {
			log.error("failed to append memory log", { id: entry.id, err });
		}
	}

	/** List all unpromoted log entries from disk. */
	async listPending(): Promise<MemoryLogEntry[]> {
		if (!this.basePath) return [];
		try {
			const files = await readDir(this.basePath);
			const entries: MemoryLogEntry[] = [];
			for (const f of files) {
				if (!f.name?.endsWith(".json")) continue;
				try {
					const raw = await readTextFile(`${this.basePath}/${f.name}`);
					const entry = JSON.parse(raw) as MemoryLogEntry;
					if (!entry.promoted) {
						entries.push(entry);
					}
				} catch (err) {
					log.warn("failed to read pending log", { file: f.name, err });
				}
			}
			entries.sort((a, b) => a.createdAt - b.createdAt);
			return entries;
		} catch {
			return [];
		}
	}

	/** Mark a log entry as promoted (successfully written to LTM). */
	async markPromoted(id: string): Promise<void> {
		if (!this.basePath) return;
		try {
			const filePath = `${this.basePath}/${id}.json`;
			const raw = await readTextFile(filePath);
			const entry = JSON.parse(raw) as MemoryLogEntry;
			entry.promoted = true;
			await writeTextFile(filePath, JSON.stringify(entry, null, "\t"));
			log.debug("memory log marked promoted", { id });
		} catch (err) {
			log.warn("failed to mark promoted", { id, err });
		}
	}

	/** Remove a promoted log entry from disk. Only call after LTM commit confirmed. */
	async removePending(id: string): Promise<void> {
		if (!this.basePath) return;
		try {
			await remove(`${this.basePath}/${id}.json`);
			log.debug("memory log removed", { id });
		} catch {
			// may already be removed
		}
	}

	/** Clean up all promoted entries. Called after successful promotion batch. */
	async cleanupPromoted(): Promise<void> {
		if (!this.basePath) return;
		try {
			const files = await readDir(this.basePath);
			for (const f of files) {
				if (!f.name?.endsWith(".json")) continue;
				try {
					const raw = await readTextFile(`${this.basePath}/${f.name}`);
					const entry = JSON.parse(raw) as MemoryLogEntry;
					if (entry.promoted) {
						await remove(`${this.basePath}/${f.name}`);
					}
				} catch {
					// skip
				}
			}
		} catch {
			// dir may not exist
		}
	}

	getBasePath(): string | null {
		return this.basePath;
	}

	async dispose(): Promise<void> {
		this.initialized = false;
	}
}
