import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionDigestService } from "./session-digest-service";
import type { EventBus } from "@/services/event-bus";
import type { ILLMService } from "@/services/llm/types";

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

function createMockLLM(response = '{ "digest": "test digest", "emotionArc": "neutral → happy", "salientEvents": [] }') {
	return {
		chat: vi.fn().mockResolvedValue(response),
	} as unknown as ILLMService;
}

function makeSummaryRecord(index: number) {
	return {
		id: `summary-${index}`,
		createdAt: Date.now() + index * 1000,
		windowStartedAt: Date.now() + index * 1000 - 5000,
		windowEndedAt: Date.now() + index * 1000,
		frameCount: 4,
		summary: `Summary ${index}: Player moved to a new area.`,
		source: "cloud" as const,
	};
}

describe("SessionDigestService", () => {
	let bus: ReturnType<typeof createMockBus>;
	let llm: ReturnType<typeof createMockLLM>;
	let service: SessionDigestService;

	beforeEach(() => {
		bus = createMockBus();
		llm = createMockLLM();
		service = new SessionDigestService({
			bus: bus as unknown as EventBus,
			llmProvider: llm as unknown as ILLMService,
			digestWindowSize: 3,
		});
	});

	it("subscribes to companion-runtime:summary-complete", () => {
		expect(bus.on).toHaveBeenCalledWith("companion-runtime:summary-complete", expect.any(Function));
	});

	it("does not generate digest until window is full", () => {
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(1) });
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(2) });

		expect(llm.chat).not.toHaveBeenCalled();
		expect(service.getState().pendingSummaryCount).toBe(2);
	});

	it("generates digest when window is full", async () => {
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(1) });
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(2) });
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(3) });

		await vi.waitFor(() => {
			expect(llm.chat).toHaveBeenCalledOnce();
		});

		const state = service.getState();
		expect(state.digestHistory.length).toBe(1);
		expect(state.digestHistory[0]!.digest).toBe("test digest");
		expect(state.digestHistory[0]!.summaryCount).toBe(3);
	});

	it("emits memory:digest-complete on successful digest", async () => {
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(bus.emit).toHaveBeenCalledWith("memory:digest-complete", expect.objectContaining({
				digest: expect.objectContaining({ digest: "test digest" }),
			}));
		});
	});

	it("detects salient events from LLM response", async () => {
		const llmWithEvents = createMockLLM(JSON.stringify({
			digest: "test",
			emotionArc: "neutral → alarmed",
			salientEvents: [
				{ type: "danger", description: "Player health low", severity: 4 },
			],
		}));
		service.setLLMProvider(llmWithEvents);

		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(bus.emit).toHaveBeenCalledWith("memory:salient-event", expect.objectContaining({
				event: expect.objectContaining({ type: "danger", severity: 4 }),
			}));
		});

		expect(service.getSalientEvents().length).toBe(1);
	});

	it("provides session digest context for prompt injection", async () => {
		expect(service.getSessionDigestContext()).toBe("");

		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(service.getDigestHistory().length).toBe(1);
		});

		const context = service.getSessionDigestContext();
		expect(context).toContain("test digest");
		expect(context).toContain("neutral → happy");
	});

	it("resets state correctly", async () => {
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(service.getDigestHistory().length).toBe(1);
		});

		service.reset();

		expect(service.getState().digestHistory.length).toBe(0);
		expect(service.getState().pendingSummaryCount).toBe(0);
		expect(service.getState().salientEvents.length).toBe(0);
		expect(service.getSessionDigestContext()).toBe("");
	});

	it("handles malformed LLM response gracefully", async () => {
		const badLlm = createMockLLM("this is not json at all");
		service.setLLMProvider(badLlm);

		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(service.getDigestHistory().length).toBe(1);
		});

		expect(service.getDigestHistory()[0]!.digest).toBe("this is not json at all");
	});

	it("caps digest history at MAX_DIGEST_HISTORY", async () => {
		for (let batch = 0; batch < 22; batch++) {
			for (let i = 1; i <= 3; i++) {
				bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(batch * 3 + i) });
			}
			await vi.waitFor(() => {
				expect(service.getDigestHistory().length).toBe(Math.min(batch + 1, 20));
			});
		}

		expect(service.getDigestHistory().length).toBe(20);
	});

	it("disposes cleanly", () => {
		service.dispose();
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(1) });
		expect(service.getState().pendingSummaryCount).toBe(0);
	});
});
