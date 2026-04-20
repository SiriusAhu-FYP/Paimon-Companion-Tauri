import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";

describe("CompanionRuntimeService", () => {
	afterEach(() => {
		vi.useRealTimers();
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

	it("waits through warmup until a fresh observation becomes available", async () => {
		vi.stubGlobal("window", {});
		const { CompanionRuntimeService } = await import("./companion-runtime-service");
		const bus = new EventBus();
		const service = new CompanionRuntimeService({
			bus,
			perception: {} as never,
		});
		const internal = service as unknown as {
			start: (target: { handle: string; title: string }) => Promise<void>;
			refreshNow: (options?: { summarize?: boolean }) => Promise<void>;
			requireObservationContext: (target: { handle: string; title: string }, options?: { maxAgeMs?: number }) => { promptContext: string; latestTimestamp: number };
		};
		const target = { handle: "target-1", title: "2048" };
		let attempt = 0;

		vi.spyOn(internal, "start").mockResolvedValue(undefined);
		vi.spyOn(internal, "refreshNow").mockResolvedValue(undefined);
		vi.spyOn(internal, "requireObservationContext").mockImplementation(() => {
			attempt += 1;
			if (attempt < 3) {
				throw new Error("companion runtime has no recent local observation yet");
			}
			return {
				promptContext: "fresh local observation",
				latestTimestamp: Date.now(),
			};
		});

		const result = await service.ensureObservationContext(target, {
			autoStart: true,
			timeoutMs: 2_000,
		});

		expect(result).toMatchObject({
			promptContext: "fresh local observation",
		});
		expect(internal.start).toHaveBeenCalledWith(target);
		expect(internal.refreshNow).toHaveBeenCalledTimes(3);
	});

	it("reports a warmup timeout instead of failing immediately", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {});
		const { CompanionRuntimeService } = await import("./companion-runtime-service");
		const bus = new EventBus();
		const service = new CompanionRuntimeService({
			bus,
			perception: {} as never,
		});
		const internal = service as unknown as {
			start: (target: { handle: string; title: string }) => Promise<void>;
			refreshNow: (options?: { summarize?: boolean }) => Promise<void>;
			requireObservationContext: (target: { handle: string; title: string }, options?: { maxAgeMs?: number }) => { promptContext: string; latestTimestamp: number };
		};

		vi.spyOn(internal, "start").mockResolvedValue(undefined);
		vi.spyOn(internal, "refreshNow").mockResolvedValue(undefined);
		vi.spyOn(internal, "requireObservationContext").mockImplementation(() => {
			throw new Error("companion runtime has no recent local observation yet");
		});

		const promise = expect(service.ensureObservationContext(
			{ handle: "target-1", title: "2048" },
			{ autoStart: true, timeoutMs: 600 },
		)).rejects.toThrow("companion runtime warmup timed out");
		await vi.advanceTimersByTimeAsync(2_000);
		await promise;
		expect(service.getState()).toMatchObject({
			diagnosticCode: "warmup-timeout",
		});
	});
});
