import type { EventBus } from "@/services/event-bus";
import type {
	LongTermMemoryEntry,
	LongTermMemoryIndex,
	LongTermMemoryIndexEntry,
	WritebackTask,
	MemoryCandidate,
} from "@/types/memory";
import { createLogger } from "@/services/logger";
import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, writeTextFile, remove, stat } from "@tauri-apps/plugin-fs";

const log = createLogger("long-term-memory");

const LTM_DIR = "logs/long-term-memory";
const INDEX_FILE = "ltm-index.json";
const WRITEBACK_DIR = "writeback-pending";

const MAX_ENTRIES = 200;
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

const DEBUG_CAPTURE_TTL_DAYS = 7;
const SCRATCHPAD_TTL_DAYS = 1;
const MAX_DEBUG_CAPTURES_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export interface LongTermMemoryServiceDeps {
	bus: EventBus;
}

export class LongTermMemoryService {
	private bus: EventBus;
	private basePath: string | null = null;
	private index: LongTermMemoryIndex = { version: 1, entries: [] };
	private writebackQueue: WritebackTask[] = [];
	private initialized = false;

	constructor(deps: LongTermMemoryServiceDeps) {
		this.bus = deps.bus;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			const appDir = await appDataDir();
			this.basePath = `${appDir}${LTM_DIR}`;
			await mkdir(this.basePath, { recursive: true });
			await mkdir(`${this.basePath}/${WRITEBACK_DIR}`, { recursive: true });
			await this.loadIndex();
			await this.retryPendingWritebacks();
			await this.cleanupDebugAndScratchpad();
			this.initialized = true;
			log.info("long-term memory initialized", {
				entries: this.index.entries.length,
				pendingWritebacks: this.writebackQueue.filter((t) => t.state !== "committed").length,
			});
		} catch (err) {
			log.error("long-term memory initialization failed", err);
		}
	}

	// --- Core: commit ---

	async commit(entry: LongTermMemoryEntry): Promise<void> {
		if (!this.basePath) {
			log.warn("not initialized, cannot commit");
			return;
		}

		const task: WritebackTask = {
			id: entry.memory_id,
			state: "pending",
			entry,
			createdAt: Date.now(),
		};
		this.writebackQueue.push(task);

		// Write pending task to disk for crash recovery
		await this.savePendingTask(task);

		// Transition: pending -> processing -> committed
		task.state = "processing";
		task.lastAttemptAt = Date.now();
		await this.savePendingTask(task);

		try {
			entry.committed_at = Date.now();
			const filePath = `${this.basePath}/${entry.memory_id}.json`;
			await writeTextFile(filePath, JSON.stringify(entry, null, "\t"));

			this.addToIndex(entry);
			await this.saveIndex();

			task.state = "committed";
			await this.removePendingTask(task.id);

			await this.enforceCapacity();

			this.bus.emit("memory:committed", { entry });
			log.info("memory committed", { id: entry.memory_id, source: entry.source });
		} catch (err) {
			log.error("commit failed, task remains pending", { id: entry.memory_id, err });
			task.state = "pending";
			await this.savePendingTask(task);
		}
	}

	// --- Core: recall ---

	async recall(query: string, topK = 3): Promise<MemoryCandidate[]> {
		if (this.index.entries.length === 0) return [];

		const queryTokens = this.tokenize(query);
		const scored: MemoryCandidate[] = [];

		for (const indexEntry of this.index.entries) {
			const score = this.computeRelevance(queryTokens, indexEntry);
			if (score > 0) {
				const entry = await this.loadEntry(indexEntry.memory_id);
				if (entry) {
					scored.push({ entry, relevanceScore: score });
				}
			}
		}

		scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
		const candidates = scored.slice(0, topK);

		if (candidates.length > 0) {
			this.bus.emit("memory:recall-complete", { query, candidates });
		}

		log.debug("recall completed", { query: query.slice(0, 50), results: candidates.length });
		return candidates;
	}

	// --- Index management ---

	private addToIndex(entry: LongTermMemoryEntry): void {
		this.index.entries = this.index.entries.filter((e) => e.memory_id !== entry.memory_id);
		const indexEntry: LongTermMemoryIndexEntry = {
			memory_id: entry.memory_id,
			source: entry.source,
			time_start: entry.time_start,
			scene_or_task: entry.scene_or_task,
			tags: entry.tags,
			summaryPreview: entry.summary.slice(0, 100),
		};
		this.index.entries.push(indexEntry);
	}

	private async loadIndex(): Promise<void> {
		if (!this.basePath) return;
		try {
			const raw = await readTextFile(`${this.basePath}/${INDEX_FILE}`);
			this.index = JSON.parse(raw) as LongTermMemoryIndex;
		} catch {
			this.index = { version: 1, entries: [] };
		}
	}

	private async saveIndex(): Promise<void> {
		if (!this.basePath) return;
		try {
			await writeTextFile(`${this.basePath}/${INDEX_FILE}`, JSON.stringify(this.index, null, "\t"));
		} catch (err) {
			log.error("failed to save LTM index", err);
		}
	}

	private async loadEntry(memoryId: string): Promise<LongTermMemoryEntry | null> {
		if (!this.basePath) return null;
		try {
			const raw = await readTextFile(`${this.basePath}/${memoryId}.json`);
			return JSON.parse(raw) as LongTermMemoryEntry;
		} catch {
			log.warn("failed to load LTM entry", { memoryId });
			return null;
		}
	}

	// --- Relevance scoring (simple keyword/tag matching) ---

	/**
	 * Tokenize text into searchable segments.
	 * Handles both CJK (Chinese/Japanese/Korean) characters and Latin words.
	 * CJK characters produce bigrams for better matching.
	 */
	private tokenize(text: string): string[] {
		const lower = text.toLowerCase();
		const tokens: string[] = [];

		// Extract Latin word tokens
		const latinWords = lower.match(/[a-z0-9_]+/g);
		if (latinWords) {
			for (const w of latinWords) {
				if (w.length > 1) tokens.push(w);
			}
		}

		// Extract CJK characters, build bigrams for better matching
		const cjkChars = lower.match(/[\u4e00-\u9fff]/g);
		if (cjkChars) {
			// Individual CJK chars
			for (const c of cjkChars) {
				tokens.push(c);
			}
			// CJK bigrams from the original text
			const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g);
			if (cjkRuns) {
				for (const run of cjkRuns) {
					for (let i = 0; i < run.length - 1; i++) {
						tokens.push(run.slice(i, i + 2));
					}
				}
			}
		}

		return tokens;
	}

	private computeRelevance(queryTokens: string[], entry: LongTermMemoryIndexEntry): number {
		let score = 0;
		const entryText = [
			entry.scene_or_task,
			entry.summaryPreview,
			...entry.tags,
		].join(" ").toLowerCase();

		const entryTokens = new Set(this.tokenize(entryText));

		for (const qt of queryTokens) {
			if (entryTokens.has(qt)) {
				score += 1;
			} else if (entryText.includes(qt)) {
				score += 0.5;
			}
		}

		// Tag exact match bonus
		const queryLower = queryTokens.join(" ");
		for (const tag of entry.tags) {
			if (queryLower.includes(tag.toLowerCase())) {
				score += 0.5;
			}
		}

		return score;
	}

	// --- Writeback state machine ---

	private async savePendingTask(task: WritebackTask): Promise<void> {
		if (!this.basePath) return;
		try {
			const path = `${this.basePath}/${WRITEBACK_DIR}/${task.id}.json`;
			await writeTextFile(path, JSON.stringify(task, null, "\t"));
		} catch (err) {
			log.error("failed to save writeback task", { id: task.id, err });
		}
	}

	private async removePendingTask(id: string): Promise<void> {
		if (!this.basePath) return;
		try {
			await remove(`${this.basePath}/${WRITEBACK_DIR}/${id}.json`);
		} catch {
			// may not exist
		}
	}

	private async retryPendingWritebacks(): Promise<void> {
		if (!this.basePath) return;

		try {
			const dir = `${this.basePath}/${WRITEBACK_DIR}`;
			const files = await readDir(dir);
			for (const f of files) {
				if (!f.name.endsWith(".json")) continue;
				try {
					const raw = await readTextFile(`${dir}/${f.name}`);
					const task = JSON.parse(raw) as WritebackTask;
					if (task.state !== "committed") {
						log.info("retrying pending writeback", { id: task.id, state: task.state });
						await this.commit(task.entry);
					} else {
						await remove(`${dir}/${f.name}`);
					}
				} catch (err) {
					log.warn("failed to retry writeback task", { file: f.name, err });
				}
			}
		} catch {
			// directory may be empty
		}
	}

	// --- Capacity governance ---

	private async enforceCapacity(): Promise<void> {
		if (!this.basePath) return;

		// Count-based eviction
		while (this.index.entries.length > MAX_ENTRIES) {
			const oldest = this.index.entries.reduce((a, b) =>
				a.time_start < b.time_start ? a : b
			);
			await this.evictEntry(oldest.memory_id);
		}

		// Size-based eviction
		let totalSize = await this.estimateTotalSize();
		while (totalSize > MAX_TOTAL_SIZE_BYTES && this.index.entries.length > 0) {
			const oldest = this.index.entries.reduce((a, b) =>
				a.time_start < b.time_start ? a : b
			);
			const entrySize = await this.getEntrySize(oldest.memory_id);
			await this.evictEntry(oldest.memory_id);
			totalSize -= entrySize;
		}
	}

	private async evictEntry(memoryId: string): Promise<void> {
		if (!this.basePath) return;
		try {
			await remove(`${this.basePath}/${memoryId}.json`);
			this.index.entries = this.index.entries.filter((e) => e.memory_id !== memoryId);
			await this.saveIndex();
			log.info("evicted LTM entry", { memoryId });
		} catch (err) {
			log.warn("failed to evict entry", { memoryId, err });
		}
	}

	private async estimateTotalSize(): Promise<number> {
		if (!this.basePath) return 0;
		let total = 0;
		for (const entry of this.index.entries) {
			total += await this.getEntrySize(entry.memory_id);
		}
		return total;
	}

	private async getEntrySize(memoryId: string): Promise<number> {
		if (!this.basePath) return 0;
		try {
			const s = await stat(`${this.basePath}/${memoryId}.json`);
			return s.size;
		} catch {
			return 0;
		}
	}

	// --- Debug/scratchpad cleanup (retained from old service) ---

	private async cleanupDebugAndScratchpad(): Promise<void> {
		const now = Date.now();
		try {
			const appDir = await appDataDir();
			await this.cleanupDebugCaptures(`${appDir}logs/debug-captures`, now);
		} catch {
			// may not exist
		}
		try {
			const appDir = await appDataDir();
			await this.cleanupScratchpads(`${appDir}logs/delegation-scratchpads`, now);
		} catch {
			// may not exist
		}
	}

	private async cleanupDebugCaptures(debugDir: string, now: number): Promise<void> {
		const debugTtl = DEBUG_CAPTURE_TTL_DAYS * 24 * 60 * 60 * 1000;
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
				} catch { /* best-effort */ }
			} else {
				dirs.push({ name: entry.name, date: dirDate });
			}
		}

		dirs.sort((a, b) => a.date - b.date);
		let totalSize = 0;
		const dirSizes: { name: string; size: number }[] = [];
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
					} catch { /* ignore */ }
				}
				totalSize += dirSize;
				dirSizes.push({ name: d.name, size: dirSize });
			} catch { /* ignore */ }
		}

		if (totalSize > MAX_DEBUG_CAPTURES_BYTES) {
			for (const d of dirSizes) {
				if (totalSize <= MAX_DEBUG_CAPTURES_BYTES) break;
				try {
					await remove(`${debugDir}/${d.name}`, { recursive: true });
					totalSize -= d.size;
					log.info("removed debug capture (LRU)", { name: d.name });
				} catch { /* best-effort */ }
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
					} catch { /* best-effort */ }
				}
			}
		} catch {
			// directory may not exist
		}
	}

	getIndex(): LongTermMemoryIndex {
		return { ...this.index, entries: [...this.index.entries] };
	}

	async dispose(): Promise<void> {
		this.initialized = false;
	}
}
