import type { EventBus } from "@/services/event-bus";
import type { LongTermMemoryEntry } from "@/types/memory";
import { createLogger } from "@/services/logger";
import { BaseDirectory } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, writeTextFile, remove } from "@tauri-apps/plugin-fs";

const log = createLogger("memory-log");

const MEMORY_LOG_DIR = "logs/memory-pending";

function joinStoragePath(...segments: string[]): string {
	return segments
		.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""))
		.filter(Boolean)
		.join("/");
}

export interface MemoryLogEntry {
	id: string;
	source: "companion" | "delegation";
	createdAt: number;
	kind?: "companion-summary" | "delegation-event";
	sessionId?: string;
	timeStart?: number;
	timeEnd?: number;
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
			this.basePath = MEMORY_LOG_DIR;
			await mkdir(this.basePath, { recursive: true, baseDir: BaseDirectory.AppData });
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
			const filePath = joinStoragePath(this.basePath, `${entry.id}.json`);
			await writeTextFile(filePath, JSON.stringify(entry, null, "\t"), { baseDir: BaseDirectory.AppData });
			this.bus.emit("memory:log-appended", {
				entry: {
					id: entry.id,
					source: entry.source,
					kind: entry.kind,
					sessionId: entry.sessionId,
					createdAt: entry.createdAt,
					timeStart: entry.timeStart,
					timeEnd: entry.timeEnd,
					hasPreCompressed: !!entry.preCompressed,
				},
			});
			log.debug("memory log appended", { id: entry.id, source: entry.source });
		} catch (err) {
			log.error("failed to append memory log", { id: entry.id, err });
		}
	}

	/** List all unpromoted log entries from disk. */
	async listPending(): Promise<MemoryLogEntry[]> {
		if (!this.basePath) return [];
		try {
			const files = await readDir(this.basePath, { baseDir: BaseDirectory.AppData });
			const entries: MemoryLogEntry[] = [];
			for (const f of files) {
				if (!f.name?.endsWith(".json")) continue;
				try {
					const raw = await readTextFile(joinStoragePath(this.basePath, f.name), { baseDir: BaseDirectory.AppData });
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
			const filePath = joinStoragePath(this.basePath, `${id}.json`);
			const raw = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
			const entry = JSON.parse(raw) as MemoryLogEntry;
			entry.promoted = true;
			await writeTextFile(filePath, JSON.stringify(entry, null, "\t"), { baseDir: BaseDirectory.AppData });
			log.debug("memory log marked promoted", { id });
		} catch (err) {
			log.warn("failed to mark promoted", { id, err });
		}
	}

	/** Remove a promoted log entry from disk. Only call after LTM commit confirmed. */
	async removePending(id: string): Promise<void> {
		if (!this.basePath) return;
		try {
			await remove(joinStoragePath(this.basePath, `${id}.json`), { baseDir: BaseDirectory.AppData });
			log.debug("memory log removed", { id });
		} catch {
			// may already be removed
		}
	}

	/** Clean up all promoted entries. Called after successful promotion batch. */
	async cleanupPromoted(): Promise<void> {
		if (!this.basePath) return;
		try {
			const files = await readDir(this.basePath, { baseDir: BaseDirectory.AppData });
			for (const f of files) {
				if (!f.name?.endsWith(".json")) continue;
				try {
					const raw = await readTextFile(joinStoragePath(this.basePath, f.name), { baseDir: BaseDirectory.AppData });
					const entry = JSON.parse(raw) as MemoryLogEntry;
					if (entry.promoted) {
						await remove(joinStoragePath(this.basePath, f.name), { baseDir: BaseDirectory.AppData });
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
