import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";

describe("CompanionRuntimeService", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("clears prior frame and summary history when a new runtime session starts", async () => {
		vi.stubGlobal("window", {});
		const { CompanionRuntimeService } = await import("./companion-runtime-service");
		const bus = new EventBus();
		const service = new CompanionRuntimeService({
			bus,
			perception: {} as never,
		});
		const internal = service as unknown as {
			state: {
				lastFrame: object | null;
				lastSummary: object | null;
				frameQueue: object[];
				summaryHistory: object[];
			};
			waitForLocalVisionReady: () => Promise<void>;
			runCaptureTick: () => Promise<void>;
			scheduleCaptureTick: () => void;
			scheduleSummaryTick: () => void;
		};

		internal.state.lastFrame = {
			id: "frame-old",
			targetTitle: "old-target",
			capturedAt: 1,
			description: "old frame",
			source: "vision",
			captureMethod: "desktop",
			qualityScore: 1,
			changeRatio: null,
		};
		internal.state.lastSummary = {
			id: "summary-old",
			createdAt: 1,
			windowStartedAt: 0,
			windowEndedAt: 1,
			frameCount: 1,
			summary: "old summary",
			source: "cloud",
		};
		internal.state.frameQueue = [internal.state.lastFrame];
		internal.state.summaryHistory = [internal.state.lastSummary];

		vi.spyOn(internal, "waitForLocalVisionReady").mockResolvedValue(undefined);
		vi.spyOn(internal, "runCaptureTick").mockResolvedValue(undefined);
		vi.spyOn(internal, "scheduleCaptureTick").mockImplementation(() => {});
		vi.spyOn(internal, "scheduleSummaryTick").mockImplementation(() => {});

		await service.start({
			handle: "target-1",
			title: "target-title",
		});

		expect(service.getState()).toMatchObject({
			lastFrame: null,
			lastSummary: null,
			frameQueue: [],
			summaryHistory: [],
		});
	});
});
