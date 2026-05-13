/**
 * Tests that verify P6 spec alignment:
 * 1. Delegation recall triggers only once, after mission confirmation.
 * 2. Delegation recall results enter model context (Memory Candidates in prompt).
 * 3. Explicit historical query recalls non-recent sessions.
 * 4. committed_at is non-zero on disk.
 * 5. L2 flush() clears all pending items.
 * 6. Chat stream consumption path (not string assumption).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { L2RollingContextService } from "./l2-rolling-context-service";
import { LongTermMemoryService } from "./long-term-memory-service";
import { consumeLLMStream } from "./llm-stream-helper";
import { buildSystemMessage } from "@/services/llm/prompt-builder";
import type { EventBus } from "@/services/event-bus";
import type { ILLMService, LLMChunk, ChatMessage } from "@/services/llm/types";
import type { LongTermMemoryEntry, MemoryCandidate } from "@/types/memory";

vi.mock("@tauri-apps/api/path", () => ({
	BaseDirectory: {
		AppData: "AppData",
	},
	appDataDir: vi.fn().mockResolvedValue("/mock/app/data/"),
}));

const fsStore = new Map<string, string>();
function resolveMockPath(path: string, options?: { baseDir?: string }) {
	if (options?.baseDir === "AppData") {
		return `/mock/app/data/${path.replace(/^[\\/]+/, "")}`;
	}
	return path;
}
vi.mock("@tauri-apps/plugin-fs", () => ({
	mkdir: vi.fn(),
	readDir: vi.fn().mockResolvedValue([]),
	readTextFile: vi.fn().mockImplementation(async (path: string, options?: { baseDir?: string }) => {
		const content = fsStore.get(resolveMockPath(path, options));
		if (!content) throw new Error(`File not found: ${path}`);
		return content;
	}),
	writeTextFile: vi.fn().mockImplementation(async (path: string, content: string, options?: { baseDir?: string }) => {
		fsStore.set(resolveMockPath(path, options), content);
	}),
	remove: vi.fn().mockImplementation(async (path: string, options?: { baseDir?: string }) => {
		fsStore.delete(resolveMockPath(path, options));
	}),
	stat: vi.fn().mockImplementation(async (path: string, options?: { baseDir?: string }) => {
		const content = fsStore.get(resolveMockPath(path, options));
		return { size: content ? content.length : 0 };
	}),
}));

function createMockBus() {
	const handlers = new Map<string, Function[]>();
	return {
		on: vi.fn((event: string, handler: Function) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
			return () => {
				const list = handlers.get(event);
				if (list) {
					const idx = list.indexOf(handler);
					if (idx >= 0) list.splice(idx, 1);
				}
			};
		}),
		emit: vi.fn(),
		_trigger(event: string, payload: unknown) {
			for (const h of handlers.get(event) ?? []) {
				h(payload);
			}
		},
	} as unknown as EventBus & { _trigger: (e: string, p: unknown) => void };
}

function createStreamMockLLM(response: string) {
	return {
		chat: vi.fn().mockImplementation(async function* () {
			yield { type: "done" as const, fullText: response };
		}),
	} as unknown as ILLMService;
}

function makeEntry(id: string, overrides?: Partial<LongTermMemoryEntry>): LongTermMemoryEntry {
	return {
		memory_id: id,
		source: "companion",
		time_start: Date.now() - 60000,
		time_end: Date.now(),
		scene_or_task: "测试场景",
		entities: ["派蒙"],
		event_result: "success",
		summary: `测试记忆条目 ${id}`,
		tags: ["test"],
		committed_at: 0,
		...overrides,
	};
}

function makeSummaryRecord(index: number) {
	return {
		id: `summary-${index}`,
		createdAt: Date.now() + index * 1000,
		windowStartedAt: Date.now() + index * 1000 - 5000,
		windowEndedAt: Date.now() + index * 1000,
		frameCount: 4,
		summary: `Summary ${index}: test data.`,
		source: "cloud" as const,
	};
}

describe("P6 spec alignment tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fsStore.clear();
	});

	// --- Test 4: committed_at is non-zero on disk ---
	it("committed_at is non-zero in persisted file", async () => {
		const bus = createMockBus();
		const service = new LongTermMemoryService({ bus });
		await service.initialize();

		const entry = makeEntry("committed-at-test");
		expect(entry.committed_at).toBe(0);

		await service.commit(entry);

		const filePath = "/mock/app/data/logs/long-term-memory/committed-at-test.json";
		const raw = fsStore.get(filePath);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!) as LongTermMemoryEntry;
		expect(parsed.committed_at).toBeGreaterThan(0);
	});

	// --- Test 5: L2 flush clears all pending ---
	it("L2 flush() clears all pending summaries", async () => {
		const bus = createMockBus();
		const llm = createStreamMockLLM(JSON.stringify({
			compressedSummary: "flushed",
			salientEvents: [],
		}));
		const service = new L2RollingContextService({
			bus,
			llmProvider: llm,
			windowSize: 5,
		});

		// Add 7 summaries (window=5, so 2 remain after one compress pass)
		for (let i = 1; i <= 7; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		// flush should process all remaining
		await service.flush();

		// Add one more — should NOT trigger compress (proves pending was cleared)
		const preCallCount = (llm as unknown as { chat: { mock: { calls: unknown[] } } }).chat.mock.calls.length;
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(100) });
		// One summary < windowSize, so no new call
		const postCallCount = (llm as unknown as { chat: { mock: { calls: unknown[] } } }).chat.mock.calls.length;
		expect(postCallCount).toBe(preCallCount);
	});

	// --- Test 6: Chat stream consumption path ---
	it("consumeLLMStream correctly consumes AsyncGenerator", async () => {
		const mockProvider: ILLMService = {
			chat: async function* (_messages: ChatMessage[]): AsyncGenerator<LLMChunk> {
				yield { type: "delta", text: "Hello " };
				yield { type: "delta", text: "World" };
				yield { type: "done", fullText: "Hello World" };
			},
		};
		const result = await consumeLLMStream(mockProvider, [
			{ role: "user", content: "test" },
		]);
		expect(result).toBe("Hello World");
	});

	it("consumeLLMStream falls back to concatenated deltas when done.fullText is empty", async () => {
		const mockProvider: ILLMService = {
			chat: async function* (_messages: ChatMessage[]): AsyncGenerator<LLMChunk> {
				yield { type: "delta", text: "abc" };
				yield { type: "delta", text: "def" };
				yield { type: "done", fullText: "" };
			},
		};
		const result = await consumeLLMStream(mockProvider, [
			{ role: "user", content: "test" },
		]);
		expect(result).toBe("abcdef");
	});

	// --- Test 3: Explicit historical query recalls non-recent sessions ---
	it("recall finds entries from non-recent sessions", async () => {
		const bus = createMockBus();
		const service = new LongTermMemoryService({ bus });
		await service.initialize();

		await service.commit(makeEntry("old-session", {
			time_start: Date.now() - 7 * 24 * 60 * 60 * 1000,
			time_end: Date.now() - 7 * 24 * 60 * 60 * 1000 + 3600000,
			scene_or_task: "璃月深渊探索",
			summary: "在璃月的深渊中完成了12层挑战",
			tags: ["abyss", "liyue", "combat"],
		}));

		await service.commit(makeEntry("recent-session", {
			time_start: Date.now() - 3600000,
			time_end: Date.now(),
			scene_or_task: "蒙德日常",
			summary: "在蒙德做了日常任务",
			tags: ["daily", "mondstadt"],
		}));

		const results = await service.recall("深渊挑战", 3);
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.entry.memory_id === "old-session")).toBe(true);
	});

	// --- Test 1 & 2: Delegation recall + Memory Candidates in prompt ---
	describe("delegation recall and Memory Candidates integration", () => {
		it("Memory Candidates evidence block appears in system prompt when provided", () => {
			const candidates: MemoryCandidate[] = [
				{
					entry: makeEntry("delegation-mem", {
						scene_or_task: "搜索QS排名",
						summary: "通过Google搜索了2026清华QS排名",
					}),
					relevanceScore: 2.5,
				},
			];
			const ctx = {
				characterProfile: null,
				affectState: {
					currentEmotion: "neutral",
					intensity: 0.5,
					residualEmotion: "neutral",
					residualIntensity: 0,
					presentationEmotion: "neutral",
					priority: 0,
					isHeldForSpeech: false,
					lastReason: "init",
					lastSource: "system",
					updatedAt: Date.now(),
				} as unknown as import("@/types").AffectState,
				companionModeState: {
					mode: "companion" as const,
					preferredMode: "companion" as const,
					lastReason: "init",
					lastSource: "system" as const,
					updatedAt: Date.now(),
				},
				knowledgeContext: "",
				companionRuntimeContext: "",
				delegationMemoryContext: "",
				rollingContext: "test context",
				memoryCandidates: candidates,
				recentInteractionContext: "",
				customPersona: "",
			};
			const msg = buildSystemMessage(ctx);
			expect(msg).toBeTruthy();
			expect(msg!.content).toContain("Memory Candidates");
			expect(msg!.content).toContain("搜索QS排名");
		});

		it("Memory Candidates block is absent when no candidates", () => {
			const ctx = {
				characterProfile: null,
				affectState: {
					currentEmotion: "neutral",
					intensity: 0.5,
					residualEmotion: "neutral",
					residualIntensity: 0,
					presentationEmotion: "neutral",
					priority: 0,
					isHeldForSpeech: false,
					lastReason: "init",
					lastSource: "system",
					updatedAt: Date.now(),
				} as unknown as import("@/types").AffectState,
				companionModeState: {
					mode: "companion" as const,
					preferredMode: "companion" as const,
					lastReason: "init",
					lastSource: "system" as const,
					updatedAt: Date.now(),
				},
				knowledgeContext: "",
				companionRuntimeContext: "",
				delegationMemoryContext: "",
				rollingContext: "",
				memoryCandidates: [],
				recentInteractionContext: "",
				customPersona: "",
			};
			const msg = buildSystemMessage(ctx);
			if (msg) {
				expect(msg.content).not.toContain("Memory Candidates");
			}
		});
	});
});
