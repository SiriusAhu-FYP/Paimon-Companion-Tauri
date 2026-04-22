import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDelegatedTaskLoop } from "./delegated-task-runner";
import { requestActiveVisionDecision } from "@/services/games/cloud-decision";
import { callLocalMcpTool, listLocalMcpTools } from "@/services/mcp/local-mcp-client";
import type { MemoryCandidate } from "@/types/memory";

vi.mock("@/services/games/cloud-decision", () => ({
	requestActiveVisionDecision: vi.fn(),
}));

vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpTool: vi.fn(),
	callLocalMcpToolJson: vi.fn(),
	listLocalMcpTools: vi.fn(),
}));

describe("delegated task memory integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(callLocalMcpTool).mockResolvedValue("{}");
		vi.mocked(listLocalMcpTools).mockResolvedValue([
			{ name: "host.send_key", description: "" },
			{ name: "host.capture_window", description: "" },
		] as never);
	});

	it("triggers recall once after mission analysis and injects recall summary into planner context", async () => {
		let visionCallCount = 0;
		let plannerUserPrompt = "";

		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input: {
			userPrompt: string;
		}) => {
			visionCallCount += 1;
			if (visionCallCount === 1) {
				return JSON.stringify({
					taskMode: "game",
					missionGoal: "在生存模式中保持存活",
					hardConstraints: ["不要离开当前窗口"],
					subtaskChain: ["观察威胁", "规避攻击", "回到安全区域"],
					completionSignals: ["角色脱离危险"],
					analysisReply: "",
					ackReply: "收到委托。",
					reply: "",
				});
			}
			if (visionCallCount === 2) {
				plannerUserPrompt = input.userPrompt;
				return JSON.stringify({
					goalReached: false,
					reasoning: "先执行一次按键规避",
					reply: "先躲一下",
					expectedOutcome: "角色脱离僵尸攻击范围",
					actions: [{ tool: "host.send_key", args: { key: "a" } }],
				});
			}
			return JSON.stringify({
				actionSucceeded: true,
				wasActionCorrect: true,
				expectedMet: true,
				expectationReview: "达成预期",
				goalAlignment: "achieved",
				goalProgress: "done",
				reply: "已经脱离危险",
				nextHint: "继续观察",
			});
		});

		let captureCount = 0;
		const orchestrator = {
			runCaptureTask: vi.fn().mockImplementation(async () => {
				captureCount += 1;
				return {
					beforeSnapshot: {
						dataUrl: `data:image/png;base64,${captureCount}`,
						width: 1280,
						height: 720,
					},
					afterSnapshot: {
						dataUrl: `data:image/png;base64,${captureCount}`,
						width: 1280,
						height: 720,
					},
				};
			}),
		};

		const append = vi.fn().mockResolvedValue(undefined);
		let recallCalledAtVisionCount = -1;
		const recallMemoryCandidates = vi.fn().mockImplementation(async () => {
			recallCalledAtVisionCount = visionCallCount;
			const candidates: MemoryCandidate[] = [
				{
					entry: {
						memory_id: "m-1",
						source: "companion",
						time_start: Date.now() - 60_000,
						time_end: Date.now() - 55_000,
						scene_or_task: "Minecraft 生存夜晚",
						entities: ["僵尸"],
						event_result: "failure",
						summary: "角色在夜晚被僵尸击败过一次",
						tags: ["minecraft", "zombie"],
						committed_at: Date.now() - 50_000,
					},
					relevanceScore: 1.5,
				},
			];
			return candidates;
		});

		const result = await runDelegatedTaskLoop({
			taskText: "帮我继续这个生存任务",
			target: { handle: "h-1", title: "Minecraft" },
			orchestrator: orchestrator as never,
			shouldStop: () => false,
			scratchpad: { append },
			recallMemoryCandidates,
		});

		expect(result.status).toBe("completed");
		expect(recallMemoryCandidates).toHaveBeenCalledTimes(1);
		expect(recallCalledAtVisionCount).toBe(1);
		expect(append).toHaveBeenCalledWith(
			"memory-recall.md",
			expect.stringContaining("僵尸"),
			{ append: false },
		);
		expect(plannerUserPrompt).toContain("### memoryRecall");
		expect(plannerUserPrompt).toContain("僵尸");
	});
});
