import { describe, expect, it, vi, beforeEach } from "vitest";
import { PersistentMemoryService } from "./persistent-memory-service";
import type { EventBus } from "@/services/event-bus";

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: vi.fn().mockResolvedValue("/mock/app/data/"),
}));

vi.mock("@tauri-apps/plugin-fs", () => {
	const store = new Map<string, string>();
	return {
		mkdir: vi.fn().mockResolvedValue(undefined),
		readDir: vi.fn().mockResolvedValue([]),
		readTextFile: vi.fn().mockImplementation(async (path: string) => {
			const content = store.get(path);
			if (!content) throw new Error(`File not found: ${path}`);
			return content;
		}),
		writeTextFile: vi.fn().mockImplementation(async (path: string, content: string) => {
			store.set(path, content);
		}),
		remove: vi.fn().mockResolvedValue(undefined),
		_store: store,
	};
});

function createMockBus() {
	return {
		on: vi.fn().mockReturnValue(() => {}),
		emit: vi.fn(),
	} as unknown as EventBus;
}

describe("PersistentMemoryService", () => {
	let bus: EventBus;
	let service: PersistentMemoryService;

	beforeEach(async () => {
		vi.clearAllMocks();
		bus = createMockBus();
		service = new PersistentMemoryService({ bus });
	});

	it("initializes without error", async () => {
		await service.initialize();
	});

	it("returns empty context before any sessions are persisted", async () => {
		await service.initialize();
		expect(service.getCrossSessionContext()).toBe("");
		expect(service.getLoadedSessions()).toEqual([]);
	});

	it("persists a session and updates index", async () => {
		await service.initialize();

		await service.persistSession({
			sessionId: "test-session-1",
			startedAt: Date.now() - 60000,
			targetTitle: "Firefox",
			digests: [
				{
					id: "d1",
					createdAt: Date.now(),
					windowStart: Date.now() - 30000,
					windowEnd: Date.now(),
					summaryCount: 3,
					digest: "Player explored the forest",
					salientEvents: ["Found hidden cave"],
					emotionArc: "neutral → excited",
				},
			],
			salientEvents: [
				{
					timestamp: Date.now(),
					type: "discovery",
					description: "Hidden cave found",
					severity: 3,
					source: "vision",
				},
			],
		});

		const index = service.getIndex();
		expect(index.entries.length).toBe(1);
		expect(index.entries[0]!.sessionId).toBe("test-session-1");
		expect(index.entries[0]!.tags).toContain("discovery");
	});

	it("emits memory:session-persisted on success", async () => {
		await service.initialize();

		await service.persistSession({
			sessionId: "test-session-2",
			startedAt: Date.now(),
			targetTitle: "Test",
			digests: [],
			salientEvents: [],
		});

		expect(bus.emit).toHaveBeenCalledWith("memory:session-persisted", expect.objectContaining({
			sessionId: "test-session-2",
		}));
	});

	it("extracts tags from emotions and events", async () => {
		await service.initialize();

		await service.persistSession({
			sessionId: "tag-test",
			startedAt: Date.now(),
			targetTitle: "Test",
			digests: [
				{
					id: "d1",
					createdAt: Date.now(),
					windowStart: Date.now(),
					windowEnd: Date.now(),
					summaryCount: 1,
					digest: "test",
					salientEvents: [],
					emotionArc: "happy → anxious → relieved",
				},
			],
			salientEvents: [
				{ timestamp: Date.now(), type: "danger", description: "Low HP", severity: 4, source: "vision" },
				{ timestamp: Date.now(), type: "achievement", description: "Level up", severity: 2, source: "vision" },
			],
		});

		const index = service.getIndex();
		const entry = index.entries.find((e) => e.sessionId === "tag-test");
		expect(entry).toBeDefined();
		expect(entry!.tags).toContain("danger");
		expect(entry!.tags).toContain("achievement");
		expect(entry!.tags).toContain("happy");
		expect(entry!.tags).toContain("anxious");
	});

	it("manages current session ID", () => {
		expect(service.getCurrentSessionId()).toBeNull();
		service.setCurrentSessionId("abc-123");
		expect(service.getCurrentSessionId()).toBe("abc-123");
	});

	it("disposes cleanly", async () => {
		await service.initialize();
		await service.dispose();
	});
});
