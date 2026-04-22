import { describe, expect, it, vi, beforeEach } from "vitest";
import { L2RollingContextService } from "./l2-rolling-context-service";
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

function createMockLLM(response = '{ "compressedSummary": "compressed context", "salientEvents": [] }') {
	const chatFn = vi.fn().mockImplementation(async function* () {
		yield { type: "done" as const, fullText: response };
	});
	return { chat: chatFn } as unknown as ILLMService & { chat: typeof chatFn };
}

function makeSummaryRecord(index: number) {
	return {
		id: `summary-${index}`,
		createdAt: Date.now() + index * 1000,
		windowStartedAt: Date.now() + index * 1000 - 5000,
		windowEndedAt: Date.now() + index * 1000,
		frameCount: 4,
		summary: `Summary ${index}: Player moved to area ${index}.`,
		source: "cloud" as const,
	};
}

describe("L2RollingContextService", () => {
	let bus: ReturnType<typeof createMockBus>;
	let llm: ReturnType<typeof createMockLLM>;
	let service: L2RollingContextService;

	beforeEach(() => {
		bus = createMockBus();
		llm = createMockLLM();
		service = new L2RollingContextService({
			bus: bus as unknown as EventBus,
			llmProvider: llm as unknown as ILLMService,
			windowSize: 3,
		});
	});

	it("subscribes to companion-runtime:summary-complete", () => {
		expect(bus.on).toHaveBeenCalledWith("companion-runtime:summary-complete", expect.any(Function));
	});

	it("does not compress until window is full", () => {
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(1) });
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(2) });

		expect(llm.chat).not.toHaveBeenCalled();
		expect(service.getRollingContext()).toBe("");
	});

	it("compresses when window is full", async () => {
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(service.getRollingContext()).toBe("compressed context");
		});
	});

	it("emits memory:l2-updated on successful compression", async () => {
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(bus.emit).toHaveBeenCalledWith("memory:l2-updated", expect.objectContaining({
				context: expect.objectContaining({ compressedSummary: "compressed context" }),
			}));
		});
	});

	it("maintains rolling context across multiple windows", async () => {
		// First window
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}
		await vi.waitFor(() => expect(service.getRollingContext()).toBe("compressed context"));

		// Second window: LLM receives existing context + new summaries
		for (let i = 4; i <= 6; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}
		await vi.waitFor(() => expect(llm.chat).toHaveBeenCalledTimes(2));

		const lastCall = llm.chat.mock.calls[1]!;
		const userMsg = lastCall[0].find((m: { role: string }) => m.role === "user");
		expect(userMsg.content).toContain("compressed context");
	});

	it("detects salient events from LLM response", async () => {
		const llmWithEvents = createMockLLM(JSON.stringify({
			compressedSummary: "test",
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

	it("handles malformed LLM response gracefully", async () => {
		const badLlm = createMockLLM("this is not json");
		service.setLLMProvider(badLlm);

		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}

		await vi.waitFor(() => {
			expect(service.getRollingContext()).toBe("this is not json");
		});
	});

	it("resets state correctly", async () => {
		for (let i = 1; i <= 3; i++) {
			bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(i) });
		}
		await vi.waitFor(() => expect(service.getRollingContext()).toBe("compressed context"));

		service.reset();

		expect(service.getRollingContext()).toBe("");
		expect(service.getSalientEvents()).toEqual([]);
		expect(service.getL2State().windowSummaryIds).toEqual([]);
	});

	it("disposes cleanly", () => {
		service.dispose();
		bus._trigger("companion-runtime:summary-complete", { record: makeSummaryRecord(1) });
		expect(service.getRollingContext()).toBe("");
	});
});
