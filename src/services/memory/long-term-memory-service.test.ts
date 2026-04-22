import { describe, expect, it, vi, beforeEach } from "vitest";
import { LongTermMemoryService } from "./long-term-memory-service";
import type { EventBus } from "@/services/event-bus";
import type { LongTermMemoryEntry } from "@/types/memory";

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: vi.fn().mockResolvedValue("/mock/app/data/"),
}));

const fsStore = new Map<string, string>();
const dirStore = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
	mkdir: vi.fn().mockImplementation(async (path: string) => {
		dirStore.add(path);
	}),
	readDir: vi.fn().mockResolvedValue([]),
	readTextFile: vi.fn().mockImplementation(async (path: string) => {
		const content = fsStore.get(path);
		if (!content) throw new Error(`File not found: ${path}`);
		return content;
	}),
	writeTextFile: vi.fn().mockImplementation(async (path: string, content: string) => {
		fsStore.set(path, content);
	}),
	remove: vi.fn().mockImplementation(async (path: string) => {
		fsStore.delete(path);
	}),
	stat: vi.fn().mockImplementation(async (path: string) => {
		const content = fsStore.get(path);
		return { size: content ? content.length : 0 };
	}),
}));

function createMockBus() {
	return {
		on: vi.fn().mockReturnValue(() => {}),
		emit: vi.fn(),
	} as unknown as EventBus;
}

function makeEntry(id: string, overrides?: Partial<LongTermMemoryEntry>): LongTermMemoryEntry {
	return {
		memory_id: id,
		source: "companion",
		time_start: Date.now() - 60000,
		time_end: Date.now(),
		scene_or_task: "原神探索",
		entities: ["派蒙", "璃月"],
		event_result: "success",
		summary: `测试记忆条目 ${id}`,
		tags: ["exploration", "liyue"],
		committed_at: 0,
		...overrides,
	};
}

describe("LongTermMemoryService", () => {
	let bus: EventBus;
	let service: LongTermMemoryService;

	beforeEach(async () => {
		vi.clearAllMocks();
		fsStore.clear();
		dirStore.clear();
		bus = createMockBus();
		service = new LongTermMemoryService({ bus });
	});

	it("initializes without error", async () => {
		await service.initialize();
	});

	it("commits an entry through pending -> processing -> committed", async () => {
		await service.initialize();

		const entry = makeEntry("test-1");
		await service.commit(entry);

		// Entry should be in the index
		const index = service.getIndex();
		expect(index.entries.length).toBe(1);
		expect(index.entries[0]!.memory_id).toBe("test-1");
		expect(index.entries[0]!.summaryPreview).toContain("测试记忆条目");
	});

	it("emits memory:committed on successful commit", async () => {
		await service.initialize();

		const entry = makeEntry("emit-test");
		await service.commit(entry);

		expect(bus.emit).toHaveBeenCalledWith("memory:committed", expect.objectContaining({
			entry: expect.objectContaining({ memory_id: "emit-test" }),
		}));
	});

	it("stores entry tags in the index", async () => {
		await service.initialize();

		const entry = makeEntry("tag-test", { tags: ["danger", "boss-fight", "achievement"] });
		await service.commit(entry);

		const index = service.getIndex();
		expect(index.entries[0]!.tags).toEqual(["danger", "boss-fight", "achievement"]);
	});

	it("recall returns matching entries by keyword", async () => {
		await service.initialize();

		await service.commit(makeEntry("recall-1", {
			scene_or_task: "璃月野外战斗",
			summary: "在璃月击败了丘丘人营地",
			tags: ["combat", "liyue"],
		}));
		await service.commit(makeEntry("recall-2", {
			scene_or_task: "蒙德城市探索",
			summary: "在蒙德图书馆找到了关键书籍",
			tags: ["exploration", "mondstadt"],
		}));

		const results = await service.recall("璃月战斗", 3);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]!.entry.memory_id).toBe("recall-1");
	});

	it("recall returns empty for no matches", async () => {
		await service.initialize();

		await service.commit(makeEntry("no-match", {
			scene_or_task: "蒙德探索",
			summary: "蒙德图书馆",
			tags: ["mondstadt"],
		}));

		const results = await service.recall("稻妻", 3);
		expect(results).toEqual([]);
	});

	it("recall respects topK limit", async () => {
		await service.initialize();

		for (let i = 0; i < 5; i++) {
			await service.commit(makeEntry(`topk-${i}`, {
				scene_or_task: "原神战斗",
				summary: `第${i}次战斗`,
				tags: ["combat"],
			}));
		}

		const results = await service.recall("原神战斗", 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it("does not use fixed 30-day TTL expiration for LTM entries", async () => {
		await service.initialize();

		// Commit an entry with old timestamps
		const oldEntry = makeEntry("old-entry", {
			time_start: Date.now() - 40 * 24 * 60 * 60 * 1000, // 40 days ago
			time_end: Date.now() - 39 * 24 * 60 * 60 * 1000,
		});
		await service.commit(oldEntry);

		// Entry should still exist (no TTL expiration)
		const index = service.getIndex();
		expect(index.entries.some((e) => e.memory_id === "old-entry")).toBe(true);

		// And recall should find it
		const results = await service.recall("测试记忆条目", 3);
		expect(results.some((r) => r.entry.memory_id === "old-entry")).toBe(true);
	});

	it("does not degrade to only remembering the most recent entry", async () => {
		await service.initialize();

		const entry1 = makeEntry("session-A", {
			time_start: Date.now() - 3 * 24 * 60 * 60 * 1000,
			scene_or_task: "远古迷宫探索",
			summary: "完成了远古迷宫的全部谜题",
			tags: ["puzzle", "dungeon"],
		});
		const entry2 = makeEntry("session-B", {
			time_start: Date.now() - 1 * 24 * 60 * 60 * 1000,
			scene_or_task: "璃月海边钓鱼",
			summary: "在璃月海边钓了很多鱼",
			tags: ["fishing", "liyue"],
		});

		await service.commit(entry1);
		await service.commit(entry2);

		// Can recall the older session
		const results = await service.recall("迷宫谜题", 3);
		expect(results.some((r) => r.entry.memory_id === "session-A")).toBe(true);
	});

	it("disposes cleanly", async () => {
		await service.initialize();
		await service.dispose();
	});
});
