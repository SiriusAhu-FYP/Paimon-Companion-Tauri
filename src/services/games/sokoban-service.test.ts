import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { SokobanService } from "./sokoban-service";
import { requestActiveVisionDecision } from "./cloud-decision";
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";
import { estimateSnapshotChange } from "./game-utils";

vi.mock("@/services/system", () => ({
	listWindows: vi.fn(),
}));
vi.mock("./cloud-decision", () => ({
	requestActiveVisionDecision: vi.fn(),
}));
vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpToolJson: vi.fn(),
}));
vi.mock("./game-utils", () => ({
	chooseWindowByKeywords: vi.fn(),
	describeSnapshotQuality: vi.fn(() => "ok"),
	ensureReferenceSnapshot: vi.fn(async () => ({ dataUrl: "before" })),
	estimateSnapshotChange: vi.fn(async () => 0.15),
	extractJsonObject: vi.fn((content: string) => content),
	isSnapshotLowConfidence: vi.fn(() => false),
}));

function createService() {
	return new SokobanService({
		bus: new EventBus(),
		orchestrator: {
			getState: vi.fn(() => ({
				selectedTarget: { handle: "target-sokoban", title: "Sokoban" },
				latestTask: {
					beforeSnapshot: { dataUrl: "before" },
					afterSnapshot: { dataUrl: "after" },
				},
			})),
			setTarget: vi.fn(),
			runFocusTask: vi.fn().mockResolvedValue(undefined),
		} as never,
	});
}

describe("SokobanService cloud vision decision guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			if (input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "先给出一段短计划。",
					strategy: "bounded sokoban plan",
					reasoning: "静态棋盘适合短序列。",
					decisionSummary: "short bounded plan",
					plannedMoves: [
						"move_right",
						"move_up",
						"move_left",
						"move_down",
						"move_right",
						"move_up",
						"move_left",
						"move_down",
						"move_right",
						"move_up",
					],
				});
			}
			return JSON.stringify({
				changed: true,
				reason: "board changed",
			});
		});
		vi.mocked(callLocalMcpToolJson).mockResolvedValue({} as never);
	});

	it("requests cloud vision planning with screenshot input", async () => {
		const service = createService();

		await service.runValidationRound();

		expect(vi.mocked(requestActiveVisionDecision)).toHaveBeenCalled();
		const firstCall = vi.mocked(requestActiveVisionDecision).mock.calls[0]?.[0];
		expect(firstCall?.imageDataUrls).toHaveLength(1);
		const prompt = firstCall?.userPrompt ?? "";
		expect(prompt).toContain("Ignore top-page UI such as the Level label");
		expect(prompt).toContain("Before choosing a short plan, identify the nearest actionable box");
		expect(prompt).toContain("Do not call a move 'progress' just because the player sprite moved");
	});

	it("replans when the opening move repeats a recent failed probe", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValue(0);
		const planningResponses = [
			JSON.stringify({
				reflection: "先试左边。",
				strategy: "short probe",
				reasoning: "先探左侧通路。",
				decisionSummary: "move_left first",
				plannedMoves: ["move_left"],
			}),
			JSON.stringify({
				reflection: "继续左探。",
				strategy: "short probe",
				reasoning: "保持一致性。",
				decisionSummary: "move_left first again",
				plannedMoves: ["move_left"],
			}),
			JSON.stringify({
				reflection: "左边刚失败，先换向上。",
				strategy: "switch opening direction",
				reasoning: "避免重复失败开局动作。",
				decisionSummary: "switch opening to move_up",
				plannedMoves: ["move_up"],
			}),
		];
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			if (input.imageDataUrls.length > 1) {
				return JSON.stringify({ changed: false, reason: "no verified change" });
			}
			return planningResponses.shift() ?? JSON.stringify({
				reflection: "fallback",
				strategy: "fallback",
				reasoning: "fallback",
				decisionSummary: "fallback",
				plannedMoves: ["move_up"],
			});
		});
		const service = createService();

		const firstRound = await service.runValidationRound();
		const secondRound = await service.runValidationRound();

		expect(firstRound.analysis.plannedMoves[0]).toBe("move_left");
		expect(secondRound.analysis.plannedMoves[0]).toBe("move_up");
		const planningCalls = vi.mocked(requestActiveVisionDecision).mock.calls
			.map((call) => call[0])
			.filter((call) => call?.imageDataUrls.length === 1);
		expect(planningCalls).toHaveLength(3);
		const retryPrompt = planningCalls[2]?.userPrompt ?? "";
		expect(retryPrompt).toContain("Planner contract check (must follow)");
	});

	it("fails when cloud vision planning request throws", async () => {
		const service = createService();
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			if (input.imageDataUrls.length === 1) {
				throw new Error("cloud vision unavailable");
			}
			return JSON.stringify({ changed: false, reason: "fallback" });
		});

		await expect(service.runValidationRound()).rejects.toThrow("cloud vision unavailable");
	});

	it("clamps Sokoban plans to a bounded short sequence", async () => {
		const service = new SokobanService({
			bus: new EventBus(),
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-sokoban", title: "Sokoban" },
					latestTask: {
						beforeSnapshot: { dataUrl: "before" },
						afterSnapshot: { dataUrl: "after" },
					},
				})),
				setTarget: vi.fn(),
				runFocusTask: vi.fn().mockResolvedValue(undefined),
			} as never,
		});

		const result = await service.runValidationRound();

		expect(result.analysis.plannedMoves).toHaveLength(8);
		expect(callLocalMcpToolJson).toHaveBeenCalledTimes(8);
	});

	it("treats local Sokoban movement as changed under the relaxed threshold", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0035);
		let callIndex = 0;
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			callIndex += 1;
			if (callIndex === 1 && input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "先给出一段短计划。",
					strategy: "bounded sokoban plan",
					reasoning: "静态棋盘适合短序列。",
					decisionSummary: "short bounded plan",
					plannedMoves: ["move_right"],
				});
			}
			throw new Error("verification unavailable");
		});
		const service = new SokobanService({
			bus: new EventBus(),
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-sokoban", title: "Sokoban" },
					latestTask: {
						beforeSnapshot: { dataUrl: "before" },
						afterSnapshot: { dataUrl: "after" },
					},
				})),
				setTarget: vi.fn(),
				runFocusTask: vi.fn().mockResolvedValue(undefined),
			} as never,
		});

		const result = await service.runValidationRound();

		expect(result.boardChanged).toBe(true);
	});

	it("falls back to unchanged when verification cloud check is unavailable and delta is tiny", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.001);
		let callIndex = 0;
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			callIndex += 1;
			if (callIndex === 1 && input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "先给出一段短计划。",
					strategy: "bounded sokoban plan",
					reasoning: "静态棋盘适合短序列。",
					decisionSummary: "short bounded plan",
					plannedMoves: ["move_right"],
				});
			}
			throw new Error("verification unavailable");
		});
		const service = createService();

		const result = await service.runValidationRound();

		expect(result.boardChanged).toBe(false);
	});
});
