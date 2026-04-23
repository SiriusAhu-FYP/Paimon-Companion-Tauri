import { describe, expect, it, vi, beforeEach } from "vitest";
import { L2RollingContextService } from "./l2-rolling-context-service";
import { LongTermMemoryService } from "./long-term-memory-service";
import type { EventBus } from "@/services/event-bus";
import type { ILLMService } from "@/services/llm/types";
import type { LongTermMemoryEntry, MemoryCandidate } from "@/types/memory";
import { buildSystemMessage, type PromptContext } from "@/services/llm/prompt-builder";

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
	mkdir: vi.fn().mockResolvedValue(undefined),
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
	stat: vi.fn().mockResolvedValue({ size: 100 }),
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
		emit: vi.fn((event: string, payload?: unknown) => {
			for (const h of handlers.get(event) ?? []) {
				h(payload);
			}
		}),
		_trigger(event: string, payload: unknown) {
			for (const h of handlers.get(event) ?? []) {
				h(payload);
			}
		},
	} as unknown as EventBus & { _trigger: (e: string, p: unknown) => void };
}

function makeSummaryRecord(index: number) {
	return {
		id: `summary-${index}`,
		createdAt: Date.now() + index * 1000,
		windowStartedAt: Date.now() + index * 1000 - 5000,
		windowEndedAt: Date.now() + index * 1000,
		frameCount: 4,
		summary: `Summary ${index}: Player explored area ${index}.`,
		source: "cloud" as const,
	};
}

function makeMinimalPromptContext(overrides: Partial<PromptContext> = {}): PromptContext {
	return {
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
			mode: "companion",
			preferredMode: "companion",
			lastReason: "init",
			lastSource: "system",
			updatedAt: Date.now(),
		},
		knowledgeContext: "",
		companionRuntimeContext: "",
		delegationMemoryContext: "",
		rollingContext: "",
		memoryCandidates: [],
		recentInteractionContext: "",
		customPersona: "",
		...overrides,
	};
}

describe("Memory E2E: L1 -> L2 -> L3 -> Recall", () => {
	let bus: ReturnType<typeof createMockBus>;
	let l2Service: L2RollingContextService;
	let ltmService: LongTermMemoryService;

	beforeEach(async () => {
		vi.clearAllMocks();
		fsStore.clear();

		bus = createMockBus();

		const llmResponse = JSON.stringify({
			compressedSummary: "玩家在璃月探索了野外区域，击败了丘丘人营地，获得了宝箱",
			salientEvents: [
				{ type: "achievement", description: "获得珍贵宝箱", severity: 3 },
			],
		});
		const mockLLM = {
			chat: vi.fn().mockImplementation(async function* () {
				yield { type: "done" as const, fullText: llmResponse };
			}),
		} as unknown as ILLMService;

		l2Service = new L2RollingContextService({
			bus: bus as unknown as EventBus,
			llmProvider: mockLLM,
			windowSize: 3,
		});

		ltmService = new LongTermMemoryService({ bus: bus as unknown as EventBus });
		await ltmService.initialize();
	});

	it("full pipeline: L1 summaries -> L2 compression -> L3 writeback -> recall", async () => {
		// Step 1: Feed L1 summaries
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		// Step 2: Wait for L2 compression
		await vi.waitFor(() => {
			expect(l2Service.getRollingContext()).not.toBe("");
		});
		expect(l2Service.getRollingContext()).toContain("璃月");

		// Step 3: Simulate session-end L3 writeback
		const entry: LongTermMemoryEntry = {
			memory_id: `e2e-session-${Date.now()}`,
			source: "companion",
			time_start: Date.now() - 60000,
			time_end: Date.now(),
			scene_or_task: "璃月野外探索",
			entities: ["丘丘人", "宝箱"],
			event_result: "success",
			summary: l2Service.getRollingContext(),
			tags: ["exploration", "liyue", "combat"],
			committed_at: 0,
		};
		await ltmService.commit(entry);

		// Step 4: Verify recall
		const candidates = await ltmService.recall("璃月探索", 3);
		expect(candidates.length).toBe(1);
		expect(candidates[0]!.entry.scene_or_task).toBe("璃月野外探索");
		expect(candidates[0]!.relevanceScore).toBeGreaterThan(0);
	});

	it("non-recent session recall: remembers older sessions across restart", async () => {
		// Commit multiple sessions at different times
		const oldSession: LongTermMemoryEntry = {
			memory_id: "old-session-3days-ago",
			source: "companion",
			time_start: Date.now() - 3 * 24 * 60 * 60 * 1000,
			time_end: Date.now() - 3 * 24 * 60 * 60 * 1000 + 3600000,
			scene_or_task: "蒙德风龙废墟探索",
			entities: ["风龙", "温迪"],
			event_result: "success",
			summary: "探索了风龙废墟，发现了温迪的线索",
			tags: ["exploration", "mondstadt", "stormterror"],
			committed_at: 0,
		};
		const recentSession: LongTermMemoryEntry = {
			memory_id: "recent-session-today",
			source: "companion",
			time_start: Date.now() - 3600000,
			time_end: Date.now(),
			scene_or_task: "璃月港购物",
			entities: ["万民堂"],
			event_result: "success",
			summary: "在璃月港的万民堂吃了特色料理",
			tags: ["shopping", "liyue"],
			committed_at: 0,
		};

		await ltmService.commit(oldSession);
		await ltmService.commit(recentSession);

		// Query specifically for the older session
		const results = await ltmService.recall("风龙废墟温迪", 3);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]!.entry.memory_id).toBe("old-session-3days-ago");

		// Also verify the recent session is findable
		const recentResults = await ltmService.recall("万民堂料理", 3);
		expect(recentResults.length).toBeGreaterThan(0);
		expect(recentResults[0]!.entry.memory_id).toBe("recent-session-today");
	});
});

describe("Memory Candidates prompt injection", () => {
	it("formats Memory Candidates evidence block correctly", () => {
		const candidates: MemoryCandidate[] = [
			{
				entry: {
					memory_id: "mc-1",
					source: "companion",
					time_start: new Date("2026-04-20T14:30:00").getTime(),
					time_end: new Date("2026-04-20T15:30:00").getTime(),
					scene_or_task: "原神-璃月",
					entities: ["丘丘人", "宝箱"],
					event_result: "success",
					summary: "在璃月野外清理丘丘人营地后获得珍贵宝箱",
					tags: ["combat", "liyue"],
					committed_at: Date.now(),
				},
				relevanceScore: 0.85,
			},
		];

		const ctx = makeMinimalPromptContext({ memoryCandidates: candidates });
		const msg = buildSystemMessage(ctx);

		expect(msg).not.toBeNull();
		expect(msg!.content).toContain("Memory Candidates");
		expect(msg!.content).toContain("长期记忆参考");
		expect(msg!.content).toContain("原神-璃月");
		expect(msg!.content).toContain("丘丘人,宝箱");
		expect(msg!.content).toContain("0.85");
		expect(msg!.content).toContain("清理丘丘人营地");
	});

	it("does not inject Memory Candidates section when empty", () => {
		const ctx = makeMinimalPromptContext({ memoryCandidates: [] });
		const msg = buildSystemMessage(ctx);

		expect(msg).not.toBeNull();
		expect(msg!.content).not.toContain("Memory Candidates");
	});

	it("injects L2 rolling context as 会话记忆上下文", () => {
		const ctx = makeMinimalPromptContext({
			rollingContext: "玩家正在璃月探索，已击败两个丘丘人营地",
		});
		const msg = buildSystemMessage(ctx);

		expect(msg).not.toBeNull();
		expect(msg!.content).toContain("会话记忆上下文");
		expect(msg!.content).toContain("璃月探索");
	});

	it("does not inject L2 rolling context section when empty", () => {
		const ctx = makeMinimalPromptContext({ rollingContext: "" });
		const msg = buildSystemMessage(ctx);

		expect(msg).not.toBeNull();
		expect(msg!.content).not.toContain("会话记忆上下文");
	});
});
