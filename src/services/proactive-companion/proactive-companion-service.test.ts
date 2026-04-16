import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { LLMService } from "@/services/llm";
import type { PipelineService } from "@/services/pipeline";
import { ProactiveCompanionService } from "./proactive-companion-service";
import { PROACTIVE_NO_REPLY_SENTINEL } from "./constants";

async function flushAsyncWork() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("ProactiveCompanionService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-14T09:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function createService(options?: {
		reply?: string;
		runtimeContext?: string;
		speakText?: ReturnType<typeof vi.fn>;
	}) {
		const bus = new EventBus();
		const llm = {
			generateCompanionReply: vi.fn().mockResolvedValue(options?.reply ?? "注意脚下，小心一点。"),
		};
		const pipeline = {
			speakText: options?.speakText ?? vi.fn().mockResolvedValue(undefined),
		};
		const companionRuntime = {
			getPromptContext: vi.fn().mockReturnValue(options?.runtimeContext ?? "最近观察：角色正在谨慎探索。"),
		};
		const service = new ProactiveCompanionService({
			bus,
			llm: llm as unknown as LLMService,
			pipeline: pipeline as unknown as PipelineService,
			companionRuntime: companionRuntime as unknown as CompanionRuntimeService,
		});

		return { bus, llm, pipeline, companionRuntime, service };
	}

	it("skips proactive emission when the model returns the no-reply sentinel", async () => {
		const { bus, llm, pipeline, service } = createService({
			reply: PROACTIVE_NO_REPLY_SENTINEL,
		});

		bus.emit("system:error", {
			module: "companion-runtime",
			error: "vision timeout",
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
		expect(pipeline.speakText).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			lastDecision: "skipped",
			lastSkipReason: "llm-no-proactive-reply",
			lastEmittedAt: null,
		});
	});

	it("queues busy-state candidates and emits them after the system becomes idle", async () => {
		const { bus, llm, pipeline, service } = createService({
			reply: "刚才那个报错我注意到了，我们先稳一下。",
		});

		bus.emit("audio:tts-start", { text: "busy" });
		bus.emit("system:error", {
			module: "voice-input",
			error: "device unavailable",
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			isBusy: true,
			pendingSource: "system-error",
			pendingPriority: 3,
		});

		bus.emit("audio:tts-end");
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
		expect(pipeline.speakText).toHaveBeenCalledWith("刚才那个报错我注意到了，我们先稳一下。");
		expect(service.getState()).toMatchObject({
			pendingSource: null,
			lastDecision: "emitted",
			lastEmittedSource: "system-error",
		});
	});

	it("replaces a lower-priority pending candidate with a higher-priority one", async () => {
		const { bus, llm, service } = createService();

		bus.emit("voice:state-change", {
			state: {
				enabled: true,
				status: "recording",
				permission: "granted",
				providerLabel: "test",
				playbackLocked: false,
				lastTranscript: null,
				lastError: null,
			},
		});
		bus.emit("game2048:run-complete", {
			runId: "2048-queued",
			success: false,
			selectedMove: null,
			boardChanged: false,
			summary: "2048 stalled",
		});
		await flushAsyncWork();
		expect(service.getState()).toMatchObject({
			pendingSource: "game2048-result",
			pendingPriority: 2,
		});

		bus.emit("system:error", {
			module: "companion-runtime",
			error: "vision timeout",
		});
		await flushAsyncWork();

		expect(service.getState()).toMatchObject({
			pendingSource: "system-error",
			pendingPriority: 3,
			lastDecision: "replaced",
		});

		bus.emit("voice:state-change", {
			state: {
				enabled: true,
				status: "idle",
				permission: "granted",
				providerLabel: "test",
				playbackLocked: false,
				lastTranscript: null,
				lastError: null,
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
		expect(llm.generateCompanionReply.mock.calls[0]?.[0]).toContain("【触发源】system error");
	});

	it("suppresses opportunistic proactive chatter during delegated execution", async () => {
		const { bus, llm, service } = createService();

		bus.emit("unified:run-start", {
			runId: "run-1",
			trigger: "manual",
			requestText: "帮我看看下一步",
		});
		bus.emit("game2048:run-complete", {
			runId: "2048-1",
			success: false,
			selectedMove: null,
			boardChanged: false,
			summary: "2048 stalled",
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			mode: "delegated",
			lastDecision: "skipped",
			lastSkipReason: "delegated-follow-up-active",
		});

		bus.emit("unified:run-complete", {
			runId: "run-1",
			gameId: "game-2048",
			success: false,
			summary: "run complete",
			emotion: "neutral",
			spoke: true,
			timings: {
				totalMs: 1000,
				actionMs: 300,
				runtimeRefreshMs: 100,
				llmReplyMs: 300,
				speechMs: 300,
				totalBlockingMs: 700,
				totalNonBlockingMs: 300,
			},
		});
		await flushAsyncWork();

		expect(service.getState().mode).toBe("companion");
	});

	it("passes proactive source metadata and runtime context into proactive generation", async () => {
		const { bus, llm, companionRuntime } = createService({
			runtimeContext: "最近观察：敌人逼近，角色正在后撤。",
			reply: "先稳住，我会继续盯着局面。",
		});

		bus.emit("audio:tts-start", { text: "previous reply" });
		bus.emit("audio:tts-end");
		vi.setSystemTime(new Date("2026-04-14T09:01:00.000Z"));

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-2",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 4,
				summary: "敌人逼近，角色正在后撤并寻找掩体。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(companionRuntime.getPromptContext).toHaveBeenCalled();
		expect(llm.generateCompanionReply).toHaveBeenCalledWith(
			expect.stringContaining("最近观察：敌人逼近，角色正在后撤。"),
			expect.objectContaining({
				source: "proactive-reply",
			}),
		);
	});

	it("adds an entrance hint on the first runtime summary", async () => {
		const { bus, llm } = createService({
			reply: "派蒙来啦，你这是在看利根川讲猜拳规则吗？",
		});

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-first",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 3,
				summary: "当前正在播放一段动画，画面里有人在讲解猜拳卡片规则。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledWith(
			expect.stringContaining("【入场提示】这是你进入当前观看场景后的第一次观察。"),
			expect.objectContaining({
				source: "proactive-reply",
			}),
		);
	});

	it("does not let the first-scene entrance get blocked by the silence window", async () => {
		const { bus, llm } = createService({
			reply: "派蒙来啦，你这是刚切到新内容吗？",
		});

		bus.emit("audio:tts-start", { text: "previous reply" });
		bus.emit("audio:tts-end");
		vi.setSystemTime(new Date("2026-04-14T09:00:10.000Z"));

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-entrance",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 3,
				summary: "当前刚切到一段正在播放的动画内容，画面和字幕都已经很明确。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
	});

	it("skips low-signal runtime summaries before calling the llm", async () => {
		const { bus, llm, service } = createService();

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-static",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 2,
				summary: "画面变化很小，当前画面与上一帧基本一致，没有明显新变化。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			lastDecision: "skipped",
			lastSkipReason: "runtime-summary-low-signal",
		});
	});

	it("includes recent task context when appraising a later runtime summary", async () => {
		const { bus, llm } = createService({
			reply: "这一步没有推进太多，我继续帮你盯着。",
		});

		bus.emit("game2048:run-complete", {
			runId: "2048-ctx",
			success: false,
			selectedMove: "move_left",
			boardChanged: false,
			summary: "2048 stalled",
		});
		await flushAsyncWork();
		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
		llm.generateCompanionReply.mockClear();

		bus.emit("audio:tts-start", { text: "previous reply" });
		bus.emit("audio:tts-end");
		vi.setSystemTime(new Date("2026-04-14T09:01:00.000Z"));

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-context",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 4,
				summary: "角色还在原地试探，没有形成明显突破。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledWith(
			expect.stringContaining("【最近任务结果】"),
			expect.objectContaining({
				source: "proactive-reply",
			}),
		);
		expect(llm.generateCompanionReply.mock.calls[0]?.[0]).toContain("结果：2048 stalled");
	});

	it("uses a configurable runtime-summary silence window", async () => {
		const { bus, llm, service } = createService({
			reply: "我继续陪你看着。",
		});
		service.setRuntimeSummarySilenceSeconds(30);

		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-entrance-first",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 3,
				summary: "当前刚切到一段新的动画内容。",
				source: "cloud",
			},
		});
		await flushAsyncWork();
		llm.generateCompanionReply.mockClear();

		bus.emit("audio:tts-start", { text: "previous reply" });
		bus.emit("audio:tts-end");

		vi.setSystemTime(new Date("2026-04-14T09:00:20.000Z"));
		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-too-soon",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 3,
				summary: "画面出现了新的卡片说明。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			lastDecision: "skipped",
			lastSkipReason: "runtime-summary-silence-window",
		});

		vi.setSystemTime(new Date("2026-04-14T09:00:31.000Z"));
		bus.emit("companion-runtime:summary-complete", {
			record: {
				id: "summary-after-window",
				createdAt: Date.now(),
				windowStartedAt: Date.now() - 5000,
				windowEndedAt: Date.now(),
				frameCount: 3,
				summary: "画面切到新的讲解段落，字幕内容也变了。",
				source: "cloud",
			},
		});
		await flushAsyncWork();

		expect(llm.generateCompanionReply).toHaveBeenCalledTimes(1);
	});
});
