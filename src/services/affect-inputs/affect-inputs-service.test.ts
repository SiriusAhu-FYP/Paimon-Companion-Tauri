import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { AffectStateService } from "@/services/affect-state";
import { AffectInputsService, inferEmotionFromUserText } from "./affect-inputs-service";

describe("affect input inference", () => {
	it("infers emotion from user text", () => {
		expect(inferEmotionFromUserText("太好了，我们成功了！")).toBe("delighted");
		expect(inferEmotionFromUserText("糟了，这里好像有危险")).toBe("alarmed");
		expect(inferEmotionFromUserText("我有点看不清现在发生了什么")).toBe("dazed");
		expect(inferEmotionFromUserText("帮我看看下一步")).toBe("neutral");
	});
});

describe("AffectInputsService", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("routes user/manual, task, and system error signals into affect state", () => {
		vi.useFakeTimers();
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		new AffectInputsService({ bus, affect });

		bus.emit("llm:request-start", {
			userText: "太好了，继续！",
			inputSource: "manual",
			companionRuntimeContextUsed: false,
			companionRuntimeContextLength: 0,
			knowledgeContextLength: 0,
		});
		expect(affect.getState()).toMatchObject({
			presentationEmotion: "delighted",
			lastReason: "user-turn:manual:delighted",
		});

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-1",
				createdAt: 1,
				windowStartedAt: 0,
				windowEndedAt: 1,
				frameCount: 4,
				summary: "当前局面有风险，而且角色似乎卡住了。",
				source: "cloud",
			},
		});
		expect(affect.getState()).toMatchObject({
			presentationEmotion: "delighted",
			lastReason: "user-turn:manual:delighted",
		});

		bus.emit("game2048:run-complete", {
			runId: "2048-1",
			success: false,
			selectedMove: null,
			boardChanged: false,
			summary: "2048 stalled",
		});
		expect(affect.getState()).toMatchObject({
			presentationEmotion: "dazed",
			lastReason: "task-result:2048:stalled",
			isHeldForSpeech: true,
		});

		bus.emit("system:error", {
			module: "voice-input",
			error: "device unavailable",
		});
		expect(affect.getState()).toMatchObject({
			presentationEmotion: "alarmed",
			lastReason: "system-error:voice-input",
		});
	});
});
