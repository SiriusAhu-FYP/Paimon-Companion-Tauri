import { describe, expect, it } from "vitest";
import type { AffectState } from "@/types";
import { buildAffectPromptSummary, resolveSpeechVoiceConfig } from "./affect-presentation";

function makeState(overrides?: Partial<AffectState>): AffectState {
	return {
		currentEmotion: "neutral",
		intensity: 0,
		residualEmotion: "neutral",
		residualIntensity: 0,
		presentationEmotion: "neutral",
		priority: 0,
		isHeldForSpeech: false,
		lastReason: "initial",
		lastSource: "system",
		updatedAt: 1,
		...overrides,
	};
}

describe("affect presentation helpers", () => {
	it("builds prompt summary with affect and recent interaction context", () => {
		const summary = buildAffectPromptSummary(makeState({
			currentEmotion: "delighted",
			presentationEmotion: "delighted",
			intensity: 1,
			residualEmotion: "happy",
			residualIntensity: 0.45,
			lastSource: "mcp",
			lastReason: "tool-result",
		}), {
			inputSource: "voice",
			recentInteractionContext: "- user/voice: 帮我看看现在发生了什么\n- assistant: 我先看看当前画面。",
		});

		expect(summary).toContain("当前主情感：delighted");
		expect(summary).toContain("本轮输入来源：voice");
		expect(summary).toContain("回复风格提示：");
		expect(summary).toContain("语音播报提示：");
		expect(summary).toContain("最近互动摘要：");
	});

	it("derives non-neutral speech config from affect state", () => {
		expect(resolveSpeechVoiceConfig(makeState({
			presentationEmotion: "sad",
		}))).toEqual({
			speed: 0.94,
			pitch: 0.96,
		});

		expect(resolveSpeechVoiceConfig(makeState({
			presentationEmotion: "neutral",
		}))).toEqual({});
	});
});
