import { describe, expect, it } from "vitest";
import { EventBus } from "@/services/event-bus";
import { AffectStateService } from "@/services/affect-state";
import { AffectInputsService, inferEmotionFromObservation, inferEmotionFromUserText } from "./affect-inputs-service";

describe("affect input inference", () => {
	it("infers emotion from user text", () => {
		expect(inferEmotionFromUserText("太好了，我们成功了！")).toBe("delighted");
		expect(inferEmotionFromUserText("糟了，这里好像有危险")).toBe("alarmed");
		expect(inferEmotionFromUserText("我有点看不清现在发生了什么")).toBe("dazed");
		expect(inferEmotionFromUserText("帮我看看下一步")).toBe("neutral");
	});

	it("infers emotion from runtime observation summary", () => {
		expect(inferEmotionFromObservation("当前局面风险很高，角色似乎被卡住了。")).toBe("alarmed");
		expect(inferEmotionFromObservation("画面变化不大，暂时看不清关键进展。")).toBe("dazed");
		expect(inferEmotionFromObservation("整体局面稳定，没有明显异常。")).toBe("neutral");
	});
});

describe("AffectInputsService", () => {
	it("routes user/manual, runtime, task, and system error signals into affect state", () => {
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
			presentationEmotion: "alarmed",
			lastReason: "runtime-summary:cloud:alarmed",
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
