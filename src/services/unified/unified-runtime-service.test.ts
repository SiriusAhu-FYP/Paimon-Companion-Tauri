import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventBus } from "@/services/event-bus";
import { RuntimeService } from "@/services/runtime";
import { AffectStateService } from "@/services/affect-state";
import { CompanionModeService } from "@/services/companion-mode";
import { DelegationMemoryService } from "@/services/delegation-memory";
import { UnifiedRuntimeService } from "./unified-runtime-service";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";
import { runDelegatedTaskLoop } from "./delegated-task-runner";

vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpTool: vi.fn(),
}));

vi.mock("./delegated-task-runner", () => ({
	runDelegatedTaskLoop: vi.fn(),
}));

describe("UnifiedRuntimeService delegation path", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(callLocalMcpTool).mockResolvedValue("{}");
		vi.mocked(runDelegatedTaskLoop).mockResolvedValue({
			status: "completed",
			rounds: 1,
			summary: "task completed",
			timeline: { taskText: "", missionGoal: "", rounds: [] },
		});
	});

	function createService(options?: {
		reply?: string;
		selectedTargetTitle?: string;
	}) {
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const companionRuntime = {
			getState: vi.fn(() => ({ running: false, target: null, lastSummary: null, summaryWindowMs: 60_000 })),
			testLocalVisionConnection: vi.fn().mockResolvedValue(undefined),
		};
		const llm = {
			generateCompanionReply: vi.fn().mockResolvedValue(options?.reply ?? "analysis reply"),
		};
		const game2048 = {
			runSingleStep: vi.fn(),
		};
		const orchestrator = {
			getState: vi.fn(() => ({
				selectedTarget: { handle: "target-1", title: options?.selectedTargetTitle ?? "2048" },
			})),
			runFocusTask: vi.fn().mockResolvedValue({
				id: "focus-task",
			}),
		};
		const pipeline = {
			speakText: vi.fn().mockResolvedValue(undefined),
			speakTextNonBlocking: vi.fn().mockReturnValue(true),
			stopSpeechQueue: vi.fn(),
			run: vi.fn().mockResolvedValue(undefined),
		};
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: companionRuntime as never,
			orchestrator: orchestrator as never,
			game2048: game2048 as never,
			sokoban: {} as never,
			llm: llm as never,
			pipeline: pipeline as never,
			companionMode,
			delegationMemory,
		});
		return {
			bus,
			affect,
			companionMode,
			companionRuntime,
			delegationMemory,
			game2048,
			orchestrator,
			pipeline,
			llm,
			service,
		};
	}

	it("keeps using the MCP companion emotion contract", async () => {
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: {} as never,
			orchestrator: {} as never,
			game2048: {} as never,
			sokoban: {} as never,
			llm: {} as never,
			pipeline: {} as never,
			companionMode,
			delegationMemory,
		});

		await (service as unknown as { applyEmotion: (emotion: string, traceId?: string) => Promise<void> }).applyEmotion("happy", "trace-1");

		expect(callLocalMcpTool).toHaveBeenCalledWith("companion.set_emotion", { emotion: "happy" }, { timeoutMs: 45_000, traceId: "trace-1" });
	});

	it("falls back into affect state when MCP call fails", async () => {
		vi.mocked(callLocalMcpTool).mockRejectedValueOnce(new Error("mcp failed"));
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: {} as never,
			orchestrator: {} as never,
			game2048: {} as never,
			sokoban: {} as never,
			llm: {} as never,
			pipeline: {} as never,
			companionMode,
			delegationMemory,
		});

		await (service as unknown as { applyEmotion: (emotion: string, traceId?: string) => Promise<void> }).applyEmotion("delighted", "trace-2");

		expect(affect.getState()).toMatchObject({
			currentEmotion: "delighted",
			presentationEmotion: "delighted",
			lastSource: "unified-runtime",
			lastReason: "unified-mcp-fallback",
		});
	});

	it("runs delegation task through the three-role loop", async () => {
		const { companionMode, game2048, service } = createService();

		await service.runDelegationTask("manual", "继续");

		expect(runDelegatedTaskLoop).toHaveBeenCalledTimes(1);
		expect(game2048.runSingleStep).not.toHaveBeenCalled();
		expect(companionMode.getState()).toMatchObject({
			mode: "companion",
			preferredMode: "companion",
			lastReason: "unified:run-complete",
		});
	});

	it("passes recall callback into delegated loop when long-term memory is available", async () => {
		const { service } = createService();
		const recall = vi.fn().mockResolvedValue([]);
		const commit = vi.fn().mockResolvedValue(undefined);
		service.setLongTermMemory({ recall, commit } as never);
		vi.mocked(runDelegatedTaskLoop).mockImplementationOnce(async (input) => {
			await input.recallMemoryCandidates?.("history query");
			return {
				status: "completed",
				rounds: 1,
				summary: "ok",
				timeline: { taskText: "", missionGoal: "", rounds: [] },
			};
		});

		await service.runDelegationTask("manual", "继续");

		expect(recall).toHaveBeenCalledWith("history query", 3);
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it("does not fallback to legacy game service when delegation loop fails", async () => {
		vi.mocked(runDelegatedTaskLoop).mockRejectedValueOnce(new Error("delegation failed"));
		const { game2048, service } = createService();

		await expect(service.runDelegationTask("manual", "帮我走一步")).rejects.toThrow("delegation failed");
		expect(game2048.runSingleStep).not.toHaveBeenCalled();
	});

	it("runs browser delegation task through the shared loop API", async () => {
		vi.mocked(runDelegatedTaskLoop).mockImplementationOnce(async ({ onAssistantReply }) => {
			await onAssistantReply?.("我先确认了一下当前页面。", "planner");
			return {
				status: "completed",
				rounds: 1,
				summary: "任务完成",
				timeline: { taskText: "", missionGoal: "", rounds: [] },
			};
		});
		const { bus, orchestrator, pipeline, service } = createService({
			selectedTargetTitle: "Mozilla Firefox",
		});
		const visibleReplies: string[] = [];
		bus.on("llm:response-end", (payload) => {
			visibleReplies.push(payload.fullText);
		});

		await service.submitDelegationTaskInstruction("请在当前页面完成浏览器任务");

		expect(orchestrator.runFocusTask).toHaveBeenCalledTimes(1);
		expect(runDelegatedTaskLoop).toHaveBeenCalledWith(expect.objectContaining({
			taskText: "请在当前页面完成浏览器任务",
			target: { handle: "target-1", title: "Mozilla Firefox" },
		}));
		expect(pipeline.run).not.toHaveBeenCalled();
		expect(visibleReplies).toContain("我先确认了一下当前页面。");
		expect(service.getState().lastCompanionText).toBe("任务完成");
	});

	it("voice input no longer triggers delegation execution", async () => {
		const { pipeline, service } = createService();

		await service.submitVoiceText("帮我走一步");

		expect(runDelegatedTaskLoop).not.toHaveBeenCalled();
		expect(pipeline.run).toHaveBeenCalledWith("帮我走一步", { inputSource: "voice" });
	});

	it("voice analyze command still goes through analyze path without delegation loop", async () => {
		const { llm, pipeline, service } = createService({ selectedTargetTitle: "Sokoban" });

		await service.submitVoiceText("帮我看看下一步建议");

		expect(runDelegatedTaskLoop).not.toHaveBeenCalled();
		expect(llm.generateCompanionReply).toHaveBeenCalled();
		expect(pipeline.run).not.toHaveBeenCalled();
	});
});
