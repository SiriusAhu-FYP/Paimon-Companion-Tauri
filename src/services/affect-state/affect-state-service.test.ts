import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { AffectStateService } from "./affect-state-service";

describe("AffectStateService", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("applies a non-neutral emotion immediately", () => {
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "happy",
			source: "manual",
			reason: "test-apply",
		});

		expect(service.getState()).toMatchObject({
			currentEmotion: "happy",
			presentationEmotion: "happy",
			residualEmotion: "happy",
			intensity: 1,
			residualIntensity: 0.45,
			isHeldForSpeech: false,
			lastSource: "manual",
			lastReason: "test-apply",
		});
	});

	it("refreshes timers for repeated same-emotion inputs without decaying early", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "happy",
			source: "manual",
			reason: "first-apply",
		});
		vi.advanceTimersByTime(14_000);
		service.applyEmotion({
			emotion: "happy",
			source: "manual",
			reason: "refresh-apply",
		});

		vi.advanceTimersByTime(14_000);
		expect(service.getState().intensity).toBe(1);

		vi.advanceTimersByTime(1_000);
		expect(service.getState()).toMatchObject({
			currentEmotion: "happy",
			presentationEmotion: "happy",
			intensity: 0.45,
			lastReason: "decay-to-residual",
		});
	});

	it("holds emotion while speech is pending or active", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "delighted",
			source: "mcp",
			reason: "speech-bound",
			holdForSpeech: true,
		});

		vi.advanceTimersByTime(20_000);
		expect(service.getState()).toMatchObject({
			presentationEmotion: "delighted",
			intensity: 1,
			isHeldForSpeech: true,
		});

		service.setSpeaking(true);
		vi.advanceTimersByTime(60_000);
		expect(service.getState()).toMatchObject({
			presentationEmotion: "delighted",
			intensity: 1,
			isHeldForSpeech: true,
		});
	});

	it("decays from active to residual and then to neutral after speech ends", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "happy",
			source: "mcp",
			reason: "speech-cycle",
			holdForSpeech: true,
		});
		service.setSpeaking(true);
		service.setSpeaking(false);

		vi.advanceTimersByTime(15_000);
		expect(service.getState()).toMatchObject({
			presentationEmotion: "happy",
			currentEmotion: "happy",
			intensity: 0.45,
			lastReason: "decay-to-residual",
		});

		vi.advanceTimersByTime(15_000);
		expect(service.getState()).toMatchObject({
			presentationEmotion: "neutral",
			currentEmotion: "neutral",
			residualEmotion: "neutral",
			intensity: 0,
			lastReason: "decay-to-neutral",
		});
	});

	it("reset returns the affect state to neutral and clears timers", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "alarmed",
			source: "manual",
			reason: "before-reset",
		});
		service.reset({
			source: "manual",
			reason: "manual-reset",
		});

		vi.advanceTimersByTime(60_000);
		expect(service.getState()).toMatchObject({
			currentEmotion: "neutral",
			presentationEmotion: "neutral",
			intensity: 0,
			residualIntensity: 0,
			lastReason: "manual-reset",
		});
	});

	it("suppresses lower-priority overrides during the active guard window", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "delighted",
			source: "manual",
			reason: "manual-character-set:delighted",
		});
		service.applyEmotion({
			emotion: "dazed",
			source: "system",
			reason: "runtime-summary:cloud:dazed",
		});

		expect(service.getState()).toMatchObject({
			presentationEmotion: "delighted",
			priority: 4,
			lastReason: "manual-character-set:delighted",
		});
	});

	it("allows lower-priority overrides after the guard window expires", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const service = new AffectStateService(bus);

		service.applyEmotion({
			emotion: "happy",
			source: "system",
			reason: "task-result:2048:success",
		});
		vi.advanceTimersByTime(12_500);
		service.applyEmotion({
			emotion: "dazed",
			source: "system",
			reason: "runtime-summary:cloud:dazed",
		});

		expect(service.getState()).toMatchObject({
			presentationEmotion: "dazed",
			priority: 1,
			lastReason: "runtime-summary:cloud:dazed",
		});
	});
});
