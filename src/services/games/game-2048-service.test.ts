import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { Game2048Service } from "./game-2048-service";
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
	estimateSnapshotChange: vi.fn(async () => 0.12),
	extractJsonObject: vi.fn((content: string) => content),
	isSnapshotLowConfidence: vi.fn(() => false),
}));

function createService() {
	return new Game2048Service({
		bus: new EventBus(),
		orchestrator: {
			getState: vi.fn(() => ({
				selectedTarget: { handle: "target-2048", title: "2048" },
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

describe("Game2048Service cloud vision decision guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			if (input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "保持一手一步。",
					strategy: "single-step 2048",
					reasoning: "优先执行最高排序的一步。",
					decisionSummary: "choose move_left first",
					preferredMoves: ["move_left", "move_up", "move_right", "move_down"],
				});
			}
			return JSON.stringify({
				changed: true,
				reason: "board changed",
			});
		});
		vi.mocked(callLocalMcpToolJson).mockResolvedValue({} as never);
	});

	it("requests cloud vision decision using current snapshot", async () => {
		const service = createService();

		await service.runSingleStep();

		expect(vi.mocked(requestActiveVisionDecision)).toHaveBeenCalled();
		const firstCall = vi.mocked(requestActiveVisionDecision).mock.calls[0]?.[0];
		expect(firstCall?.imageDataUrls).toHaveLength(1);
	});

	it("fails when cloud vision planning request throws", async () => {
		const service = createService();
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			if (input.imageDataUrls.length === 1) {
				throw new Error("cloud vision unavailable");
			}
			return JSON.stringify({ changed: false, reason: "fallback" });
		});

		await expect(service.runSingleStep()).rejects.toThrow("cloud vision unavailable");
	});

	it("executes only the first ranked move for 2048", async () => {
		let latestTask = {
			beforeSnapshot: { dataUrl: "before" },
			afterSnapshot: { dataUrl: "after" },
		};
		const service = new Game2048Service({
			bus: new EventBus(),
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-2048", title: "2048" },
					latestTask,
				})),
				setTarget: vi.fn(),
				runFocusTask: vi.fn().mockResolvedValue(undefined),
			} as never,
		});

		await service.runSingleStep();

		expect(callLocalMcpToolJson).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callLocalMcpToolJson).mock.calls[0]?.[1]).toMatchObject({
			actionId: "move_left",
		});
	});

	it("prefers cloud changed verdict over tiny pixel delta", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0002);
		const service = createService();

		const result = await service.runSingleStep();

		expect(result.boardChanged).toBe(true);
	});

	it("treats borderline 2048 movement as changed under tuned threshold", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0054);
		let callIndex = 0;
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			callIndex += 1;
			if (callIndex === 1 && input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "保持一手一步。",
					strategy: "single-step 2048",
					reasoning: "优先执行最高排序的一步。",
					decisionSummary: "choose move_left first",
					preferredMoves: ["move_left", "move_up", "move_right", "move_down"],
				});
			}
			throw new Error("verification unavailable");
		});
		const service = new Game2048Service({
			bus: new EventBus(),
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-2048", title: "2048" },
					latestTask: {
						beforeSnapshot: { dataUrl: "before" },
						afterSnapshot: { dataUrl: "after" },
					},
				})),
				setTarget: vi.fn(),
				runFocusTask: vi.fn().mockResolvedValue(undefined),
			} as never,
		});

		const result = await service.runSingleStep();

		expect(result.boardChanged).toBe(true);
	});

	it("keeps very small visual deltas as unchanged in 2048 verification", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0049);
		let callIndex = 0;
		vi.mocked(requestActiveVisionDecision).mockImplementation(async (input) => {
			callIndex += 1;
			if (callIndex === 1 && input.imageDataUrls.length === 1) {
				return JSON.stringify({
					reflection: "保持一手一步。",
					strategy: "single-step 2048",
					reasoning: "优先执行最高排序的一步。",
					decisionSummary: "choose move_left first",
					preferredMoves: ["move_left", "move_up", "move_right", "move_down"],
				});
			}
			throw new Error("verification unavailable");
		});
		const service = new Game2048Service({
			bus: new EventBus(),
			orchestrator: {
				getState: vi.fn(() => ({
					selectedTarget: { handle: "target-2048", title: "2048" },
					latestTask: {
						beforeSnapshot: { dataUrl: "before" },
						afterSnapshot: { dataUrl: "after" },
					},
				})),
				setTarget: vi.fn(),
				runFocusTask: vi.fn().mockResolvedValue(undefined),
			} as never,
		});

		const result = await service.runSingleStep();

		expect(result.boardChanged).toBe(false);
	});
});
