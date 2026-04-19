import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { PipelineService } from "./pipeline-service";

vi.mock("@/utils/window-sync", () => ({
	broadcastMouth: vi.fn(),
}));

describe("PipelineService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("serializes speech requests and preserves tts-start text order", async () => {
		const bus = new EventBus();
		const ttsStarts: string[] = [];
		const ttsEnds: number[] = [];

		bus.on("audio:tts-start", ({ text }) => {
			ttsStarts.push(text);
		});
		bus.on("audio:tts-end", () => {
			ttsEnds.push(Date.now());
		});

		const pipeline = new PipelineService({
			bus,
			runtime: {
				isAllowed: () => true,
			} as never,
			affect: {
				getState: () => ({
					currentEmotion: "neutral",
					intensity: 0,
					residualEmotion: "neutral",
					residualIntensity: 0,
					presentationEmotion: "neutral",
					priority: 0,
					isHeldForSpeech: false,
					lastReason: null,
					lastSource: null,
					updatedAt: Date.now(),
				}),
			} as never,
			character: {
				setSpeaking: vi.fn(),
			} as never,
			llm: {} as never,
			tts: {
				synthesize: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
			} as never,
			player: {
				onMouthData: vi.fn(),
				stop: vi.fn(),
				play: vi.fn().mockImplementation(async () => {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}),
			} as never,
		});

		const first = pipeline.speakText("第一句");
		const second = pipeline.speakText("第二句");

		await vi.runAllTimersAsync();
		await Promise.all([first, second]);

		expect(ttsStarts).toEqual(["第一句", "第二句"]);
		expect(ttsEnds).toHaveLength(2);
	});
});
