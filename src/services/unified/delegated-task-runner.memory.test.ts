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
					initialStateSummary: "当前处于夜晚危险状态",
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

	it("keeps observed current page as initial state instead of hard constraint", async () => {
		let visionCallCount = 0;
		let plannerUserPrompt = "";

		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input: {
			userPrompt: string;
		}) => {
			visionCallCount += 1;
			if (visionCallCount === 1) {
				return JSON.stringify({
					taskMode: "browser",
					missionGoal: "使用 Google 查询今日美元-人民币汇率",
					initialStateSummary: "当前处于 GitHub 标签页，尚未打开 Google。",
					hardConstraints: ["在当前 GitHub 标签页中操作", "必须使用 Google 查询"],
					subtaskChain: ["确认当前状态", "新建标签页", "打开 Google", "输入汇率查询"],
					completionSignals: ["看到 Google 汇率结果"],
					analysisReply: "",
					ackReply: "收到委托。",
					reply: "",
				});
			}
			if (visionCallCount === 2) {
				plannerUserPrompt = input.userPrompt;
				return JSON.stringify({
					goalReached: false,
					reasoning: "先确认当前标签页状态，再新建标签页。",
					reply: "先确认页面",
					expectedOutcome: "确认当前页不是 Google，准备切换到新标签页",
					actions: [{ tool: "host.send_key", args: { key: "Ctrl+T" } }],
				});
			}
			return JSON.stringify({
				actionSucceeded: true,
				wasActionCorrect: true,
				expectedMet: true,
				expectationReview: "达成预期",
				goalAlignment: "achieved",
				goalProgress: "done",
				reply: "已经切到新标签页",
				nextHint: "继续打开 Google",
			});
		});

		const orchestrator = {
			runCaptureTask: vi.fn().mockResolvedValue({
				beforeSnapshot: {
					dataUrl: "data:image/png;base64,before",
					width: 1280,
					height: 720,
				},
				afterSnapshot: {
					dataUrl: "data:image/png;base64,after",
					width: 1280,
					height: 720,
				},
			}),
		};

		const result = await runDelegatedTaskLoop({
			taskText: "请使用 Google 查询今日美元-人民币汇率",
			target: { handle: "h-1", title: "GitHub — Mozilla Firefox" },
			orchestrator: orchestrator as never,
			shouldStop: () => false,
		});

		expect(result.status).toBe("completed");
		expect(plannerUserPrompt).toContain("initialState=当前处于 GitHub 标签页，尚未打开 Google。");
		expect(plannerUserPrompt).toContain("missionHardConstraints: 必须使用 Google 查询");
		expect(plannerUserPrompt).not.toContain("在当前 GitHub 标签页中操作");
	});

	it("applies game-specific delegation rules and thinking mode for sokoban", async () => {
		let missionThinkingMode = "";
		let plannerSystemPrompt = "";
		let visionCallCount = 0;

		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input: {
			systemPrompt: string;
			thinkingMode?: string;
		}) => {
			visionCallCount += 1;
			if (visionCallCount === 1) {
				missionThinkingMode = input.thinkingMode ?? "";
				return JSON.stringify({
					taskMode: "game",
					missionGoal: "解决当前推箱子关卡",
					initialStateSummary: "当前处于推箱子页面。",
					initialStateSketch: "#####\n#P.B#\n#..T#\n#####",
					hardConstraints: [],
					subtaskChain: ["确认棋盘", "靠近箱子", "推进到目标点"],
					completionSignals: ["箱子进入目标点"],
					ackReply: "收到。",
				});
			}
			if (visionCallCount === 2) {
				plannerSystemPrompt = input.systemPrompt;
				return JSON.stringify({
					goalReached: true,
					reasoning: "确认当前棋盘后先暂停。",
					reply: "我先确认好局面。",
					expectedOutcome: "确认棋盘局面",
					stateSketch: "#####\n#P.B#\n#..T#\n#####",
					actions: [{ tool: "game.perform_action", args: { actionId: "move_right" } }],
				});
			}
			return JSON.stringify({
				actionSucceeded: false,
				wasActionCorrect: false,
				expectedMet: false,
				expectationReview: "未执行。",
				goalAlignment: "unchanged",
				goalProgress: "none",
				reply: "先停一下。",
				nextHint: "继续确认棋盘。",
			});
		});

		const orchestrator = {
			runCaptureTask: vi.fn().mockResolvedValue({
				beforeSnapshot: {
					dataUrl: "data:image/png;base64,before",
					width: 1280,
					height: 720,
				},
				afterSnapshot: {
					dataUrl: "data:image/png;base64,after",
					width: 1280,
					height: 720,
				},
			}),
		};

		await runDelegatedTaskLoop({
			taskText: "请尝试解决当前推箱子关卡",
			target: { handle: "h-1", title: "Play Sokoban — Mozilla Firefox" },
			orchestrator: orchestrator as never,
			shouldStop: () => false,
		});

		expect(missionThinkingMode).toBe("medium");
		expect(plannerSystemPrompt).toContain("stateSketch");
		expect(plannerSystemPrompt).toContain("下一个动作必须明确对应某个具体局面目标");
	});

	it("treats unchanged board state as a failed step even if evaluator claims success", async () => {
		let visionCallCount = 0;
		let secondPlannerPrompt = "";

		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input: {
			userPrompt: string;
		}) => {
			visionCallCount += 1;
			if (visionCallCount === 1) {
				return JSON.stringify({
					taskMode: "game",
					missionGoal: "解决当前推箱子关卡",
					initialStateSummary: "当前处于推箱子页面。",
					initialStateSketch: "#####\n#P.B#\n#..T#\n#####",
					hardConstraints: [],
					subtaskChain: ["确认棋盘", "尝试移动"],
					completionSignals: ["局面推进"],
					ackReply: "收到。",
				});
			}
			if (visionCallCount === 2) {
				return JSON.stringify({
					goalReached: false,
					reasoning: "先向右试一步。",
					reply: "先试一步。",
					expectedOutcome: "玩家或箱子出现可确认变化",
					stateSketch: "#####\n#P.B#\n#..T#\n#####",
					actions: [{ tool: "host.send_key", args: { key: "Right" } }],
				});
			}
			if (visionCallCount === 3) {
				return JSON.stringify({
					actionSucceeded: true,
					wasActionCorrect: true,
					expectedMet: true,
					expectationReview: "看起来达成预期。",
					goalAlignment: "closer",
					goalProgress: "partial",
					reply: "我推进了一点。",
					nextHint: "继续同样策略。",
					beforeStateSketch: "#####\n#P.B#\n#..T#\n#####",
					afterStateSketch: "#####\n#P.B#\n#..T#\n#####",
					stateDelta: "无可确认变化",
				});
			}
			secondPlannerPrompt = input.userPrompt;
			return JSON.stringify({
				goalReached: true,
				reasoning: "上一轮没有确认变化，先停下重看棋盘。",
				reply: "我先重看一下棋盘。",
				expectedOutcome: "重新确认棋盘状态",
				stateSketch: "#####\n#P.B#\n#..T#\n#####",
				actions: [],
			});
		});

		const orchestrator = {
			runCaptureTask: vi.fn().mockResolvedValue({
				beforeSnapshot: {
					dataUrl: "data:image/png;base64,before",
					width: 1280,
					height: 720,
				},
				afterSnapshot: {
					dataUrl: "data:image/png;base64,after",
					width: 1280,
					height: 720,
				},
			}),
		};

		await runDelegatedTaskLoop({
			taskText: "请尝试解决当前推箱子关卡",
			target: { handle: "h-1", title: "Play Sokoban — Mozilla Firefox" },
			orchestrator: orchestrator as never,
			shouldStop: () => false,
		});

		expect(secondPlannerPrompt).toContain("previousExpectedMet: no");
	});
});
