import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventBus } from "@/services/event-bus";
import { RuntimeService } from "@/services/runtime";
import { AffectStateService } from "@/services/affect-state";
import { CompanionModeService } from "@/services/companion-mode";
import { DelegationMemoryService } from "@/services/delegation-memory";
import { UnifiedRuntimeService } from "./unified-runtime-service";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";

vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpTool: vi.fn(),
}));

describe("UnifiedRuntimeService affect application", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(callLocalMcpTool).mockResolvedValue("{}");
	});

	function createService(options?: {
		gameResult?: {
			summary: string;
			boardChanged: boolean;
			selectedMove: "move_up" | "move_left" | "move_right" | "move_down" | null;
			companionText: string;
			reflection?: string;
			reasoning?: string;
		};
		gameResults?: Array<{
			summary: string;
			boardChanged: boolean;
			selectedMove: "move_up" | "move_left" | "move_right" | "move_down" | null;
			companionText: string;
			reflection?: string;
			reasoning?: string;
		}>;
		gameError?: Error;
		reply?: string;
	}) {
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const companionRuntime = {
			getState: vi.fn(() => ({ running: false, target: null, lastSummary: null, summaryWindowMs: 60_000 })),
			waitForPostActionObservation: vi.fn().mockResolvedValue({
				promptContext: "fresh observation",
				latestTimestamp: Date.now(),
				changedObservation: true,
				timedOut: false,
			}),
		};
		const llm = {
			generateCompanionReply: vi.fn().mockResolvedValue(options?.reply ?? "grounded reply"),
		};
		const gameResult = options?.gameResult ?? {
			summary: "board changed",
			boardChanged: true,
			selectedMove: "move_up" as const,
			companionText: "fallback reply",
			reflection: "继续沿着当前方向推进。",
			reasoning: "上移能合并更稳定。",
		};
		const queuedGameResults = [...(options?.gameResults ?? [gameResult])];
		const game2048 = {
			runSingleStep: options?.gameError
				? vi.fn().mockRejectedValue(options.gameError)
				: vi.fn().mockImplementation(async () => {
					const nextResult = queuedGameResults.shift() ?? gameResult;
					return {
						target: { handle: "target-1", title: "2048" },
						summary: nextResult.summary,
						selectedMove: nextResult.selectedMove,
						boardChanged: nextResult.boardChanged,
						companionText: nextResult.companionText,
						analysis: {
							source: "cloud-decision",
							decisionSummary: "cloud chose move_left first from local observation context",
							reflection: nextResult.reflection ?? "",
							reasoning: nextResult.reasoning ?? "",
							preferredMoves: ["move_left", "move_up", "move_right", "move_down"],
						},
						attempts: nextResult.boardChanged
							? [{ move: nextResult.selectedMove ?? "move_up", changed: true, changeRatio: 0.12 }]
							: [{ move: nextResult.selectedMove ?? "move_up", changed: false, changeRatio: 0.001 }],
					};
				}),
		};
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: companionRuntime as never,
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-1", title: "2048" },
				})),
			} as never,
			game2048: game2048 as never,
			sokoban: {} as never,
			llm: llm as never,
			pipeline: {
				speakText: vi.fn().mockResolvedValue(undefined),
				run: vi.fn(),
			} as never,
			companionMode,
			delegationMemory,
		});

		return { bus, affect, runtime, companionMode, delegationMemory, companionRuntime, llm, game2048, service };
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

	it("falls back into affect state when the MCP call fails", async () => {
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

	it("returns to companion mode after a unified run when companion is the preferred mode", async () => {
		const { companionMode, delegationMemory, service } = createService();

		await service.runUnifiedGameStep("manual", "帮我走一步");

		expect(companionMode.getState()).toMatchObject({
			mode: "companion",
			preferredMode: "companion",
			lastReason: "unified:run-complete",
		});
		expect(delegationMemory.getLatestRecord()).toMatchObject({
			sourceGame: "2048",
			trigger: "manual",
			verificationResult: {
				success: true,
				boardChanged: true,
				error: null,
			},
			followUpSummary: "grounded reply",
		});
	});

	it("keeps delegated mode after a unified run when the user preference is delegated", async () => {
		const { companionMode, game2048, service } = createService({
			gameResults: [
				{
					summary: "no visible progress",
					boardChanged: false,
					selectedMove: "move_left",
					companionText: "fallback reply",
				},
				{
					summary: "still no visible progress",
					boardChanged: false,
					selectedMove: "move_up",
					companionText: "fallback reply",
				},
			],
		});
		companionMode.setMode("delegated", "manual-toggle", "manual");

		await service.runUnifiedGameStep("manual", "继续");

		expect(game2048.runSingleStep).toHaveBeenCalledTimes(2);
		expect(companionMode.getState()).toMatchObject({
			mode: "delegated",
			preferredMode: "delegated",
			lastReason: "unified:run-complete",
		});
	});

	it("records failed unified runs into delegation memory", async () => {
		const { delegationMemory, service } = createService({
			gameError: new Error("capture failed"),
		});

		await expect(service.runUnifiedGameStep("manual", "帮我走一步")).rejects.toThrow("capture failed");

		expect(delegationMemory.getLatestRecord()).toMatchObject({
			sourceGame: "2048",
			verificationResult: {
				success: false,
				boardChanged: false,
				error: "capture failed",
			},
			followUpSummary: "这轮统一运行没成功，我先停下来，等你检查目标窗口或当前画面。",
		});
	});

	it("builds grounded follow-up from focused delegation memory context", async () => {
		const { delegationMemory, llm, service } = createService({
			gameResult: {
				summary: "board changed",
				boardChanged: true,
				selectedMove: "move_left",
				companionText: "fallback reply",
				reflection: "继续保持左上角稳定。",
				reasoning: "向左可以合并并保留更多空格。",
			},
		});
		delegationMemory.appendRecord({
			createdAt: Date.now() - 1000,
			mode: "delegated",
			sourceGame: "2048",
			trigger: "manual",
			requestText: "上一轮",
			analysisSource: "cloud-decision",
			decisionSummary: "cloud chose move_up first from local observation context",
			plannedActions: ["move_up", "move_left", "move_right", "move_down"],
			attemptedActions: ["move_up"],
			selectedAction: "move_up",
			executionSummary: "previous success",
			verificationResult: {
				success: true,
				boardChanged: true,
				error: null,
			},
			followUpSummary: "上一轮成功了。",
			emotion: "happy",
			nextStepHint: "继续优先保持左上角稳定。",
			traceId: "previous-trace",
		});

		await service.runUnifiedGameStep("manual", "帮我走一步");

		expect(llm.generateCompanionReply).toHaveBeenCalled();
		const options = llm.generateCompanionReply.mock.calls[0]?.[1];
		expect(options?.delegationMemoryContext).toContain("【本轮托管记录】");
		expect(options?.delegationMemoryContext).toContain("【最近下一步提示】");
	});

	it("waits for a fresh post-action observation before grounded follow-up", async () => {
		const { companionRuntime, llm, service } = createService();

		await service.runUnifiedGameStep("manual", "帮我走一步");

		expect(companionRuntime.waitForPostActionObservation).toHaveBeenCalledTimes(1);
		expect(companionRuntime.waitForPostActionObservation).toHaveBeenCalledWith(
			{ handle: "target-1", title: "2048" },
			expect.objectContaining({
				timeoutMs: 5_000,
				requireChanged: true,
			}),
		);
		expect(llm.generateCompanionReply.mock.calls[0]?.[0]).toContain("【动作后观察状态】fresh-changed");
		expect(llm.generateCompanionReply.mock.calls[0]?.[0]).toContain("fresh observation");
	});

	it("auto-stops a delegated loop after repeated no-progress", async () => {
		const { bus, companionMode, game2048, service } = createService({
			gameResults: [
				{
					summary: "no visible progress",
					boardChanged: false,
					selectedMove: "move_left",
					companionText: "fallback reply",
				},
				{
					summary: "still no visible progress",
					boardChanged: false,
					selectedMove: "move_up",
					companionText: "fallback reply",
				},
			],
		});
		companionMode.setMode("delegated", "manual-toggle", "manual");
		const systemErrors: Array<{ module: string; error: string }> = [];
		bus.on("system:error", (payload) => {
			systemErrors.push(payload as { module: string; error: string });
		});

		await service.runUnifiedGameStep("manual", "继续托管");

		expect(game2048.runSingleStep).toHaveBeenCalledTimes(2);
		expect(systemErrors[systemErrors.length - 1]).toMatchObject({
			module: "unified-runtime",
			error: "delegated loop auto-stopped: repeated-no-progress",
		});
	});

	it("uses focused delegation memory when analyzing without acting", async () => {
		const { delegationMemory, llm, service } = createService();
		delegationMemory.appendRecord({
			createdAt: Date.now(),
			mode: "delegated",
			sourceGame: "2048",
			trigger: "manual",
			requestText: "帮我走一步",
			analysisSource: "cloud-decision",
			decisionSummary: "cloud chose move_left first from local observation context",
			plannedActions: ["move_left", "move_up", "move_right", "move_down"],
			attemptedActions: ["move_left"],
			selectedAction: "move_left",
			executionSummary: "board changed",
			verificationResult: {
				success: true,
				boardChanged: true,
				error: null,
			},
			followUpSummary: "这一步已经有效。",
			emotion: "happy",
			nextStepHint: "如果局面没变差，可以继续左移或上移。",
			traceId: "trace-ctx",
		});

		await service.submitVoiceText("帮我看看下一步建议");

		expect(llm.generateCompanionReply).toHaveBeenCalled();
		const options = llm.generateCompanionReply.mock.calls[0]?.[1];
		expect(options?.delegationMemoryContext).toContain("【本轮托管记录】");
		expect(options?.delegationMemoryContext).toContain("如果局面没变差，可以继续左移或上移。");
	});
});
