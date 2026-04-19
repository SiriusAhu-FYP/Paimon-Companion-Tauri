import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { Game2048Service } from "./game-2048-service";
import { requestActiveTextDecision } from "./cloud-decision";
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";
import { estimateSnapshotChange } from "./game-utils";

vi.mock("@/services/system", () => ({
	listWindows: vi.fn(),
}));
vi.mock("./cloud-decision", () => ({
	requestActiveTextDecision: vi.fn(),
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

function createService(ensureObservationContext: () => Promise<{ promptContext: string; latestTimestamp: number }> | never) {
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
		companionRuntime: {
			ensureObservationContext: vi.fn(ensureObservationContext),
		} as never,
	});
}

describe("Game2048Service local observation guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requestActiveTextDecision).mockResolvedValue(
			JSON.stringify({
				reflection: "保持一手一步。",
				strategy: "single-step 2048",
				reasoning: "优先执行最高排序的一步。",
				decisionSummary: "choose move_left first",
				preferredMoves: ["move_left", "move_up", "move_right", "move_down"],
			}),
		);
		vi.mocked(callLocalMcpToolJson).mockResolvedValue({} as never);
	});

	it("auto-starts local observation context before running", async () => {
		const service = createService(async () => ({
			promptContext: "board summary",
			latestTimestamp: Date.now(),
		}));

		await service.runSingleStep();

		expect(vi.mocked(requestActiveTextDecision)).toHaveBeenCalled();
	});

	it("fails when companion runtime target does not match the selected target", async () => {
		const service = createService(async () => {
			throw new Error("companion runtime target does not match the selected functional target");
		});

		await expect(service.runSingleStep()).rejects.toThrow(
			"companion runtime target does not match the selected functional target",
		);
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
			companionRuntime: {
				ensureObservationContext: vi.fn(async () => ({ promptContext: "board summary", latestTimestamp: Date.now() })),
			} as never,
		});

		await service.runSingleStep();

		expect(callLocalMcpToolJson).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callLocalMcpToolJson).mock.calls[0]?.[1]).toMatchObject({
			actionId: "move_left",
		});
	});

	it("treats local 2048 movement as changed under the relaxed threshold", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0065);
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
			companionRuntime: {
				ensureObservationContext: vi.fn(async () => ({ promptContext: "board summary", latestTimestamp: Date.now() })),
			} as never,
		});

		const result = await service.runSingleStep();

		expect(result.boardChanged).toBe(true);
	});
});
