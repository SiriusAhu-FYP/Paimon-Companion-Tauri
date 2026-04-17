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
		gameError?: Error;
		reply?: string;
	}) {
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const gameResult = options?.gameResult ?? {
			summary: "board changed",
			boardChanged: true,
			selectedMove: "move_up" as const,
			companionText: "fallback reply",
			reflection: "继续沿着当前方向推进。",
			reasoning: "上移能合并更稳定。",
		};
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: {
				getState: vi.fn(() => ({ running: false, target: null, lastSummary: null, summaryWindowMs: 60_000 })),
			} as never,
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-1", title: "2048" },
				})),
			} as never,
			game2048: {
				runSingleStep: options?.gameError
					? vi.fn().mockRejectedValue(options.gameError)
					: vi.fn().mockResolvedValue({
						target: { handle: "target-1", title: "2048" },
						summary: gameResult.summary,
						selectedMove: gameResult.selectedMove,
						boardChanged: gameResult.boardChanged,
						companionText: gameResult.companionText,
						analysis: {
							reflection: gameResult.reflection ?? "",
							reasoning: gameResult.reasoning ?? "",
						},
					}),
			} as never,
			sokoban: {} as never,
			llm: {
				generateCompanionReply: vi.fn().mockResolvedValue(options?.reply ?? "grounded reply"),
			} as never,
			pipeline: {
				speakText: vi.fn().mockResolvedValue(undefined),
				run: vi.fn(),
			} as never,
			companionMode,
			delegationMemory,
		});

		return { bus, affect, runtime, companionMode, delegationMemory, service };
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
		const { companionMode, service } = createService();
		companionMode.setMode("delegated", "manual-toggle", "manual");

		await service.runUnifiedGameStep("manual", "继续");

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
});
