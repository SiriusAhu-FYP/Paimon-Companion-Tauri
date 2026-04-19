import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { SokobanService } from "./sokoban-service";
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
	estimateSnapshotChange: vi.fn(async () => 0.15),
	extractJsonObject: vi.fn((content: string) => content),
	isSnapshotLowConfidence: vi.fn(() => false),
}));

function createService(ensureObservationContext: () => Promise<{ promptContext: string; latestTimestamp: number }> | never) {
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
		companionRuntime: {
			ensureObservationContext: vi.fn(ensureObservationContext),
		} as never,
	});
}

describe("SokobanService local observation guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requestActiveTextDecision).mockResolvedValue(
			JSON.stringify({
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
			}),
		);
		vi.mocked(callLocalMcpToolJson).mockResolvedValue({} as never);
	});

	it("auto-starts local observation context before running", async () => {
		const service = createService(async () => ({
			promptContext: "board summary",
			latestTimestamp: Date.now(),
		}));

		await service.runValidationRound();

		expect(vi.mocked(requestActiveTextDecision)).toHaveBeenCalled();
	});

	it("fails when companion runtime target does not match the selected target", async () => {
		const service = createService(async () => {
			throw new Error("companion runtime target does not match the selected functional target");
		});

		await expect(service.runValidationRound()).rejects.toThrow(
			"companion runtime target does not match the selected functional target",
		);
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
			companionRuntime: {
				ensureObservationContext: vi.fn(async () => ({ promptContext: "board summary", latestTimestamp: Date.now() })),
			} as never,
		});

		const result = await service.runValidationRound();

		expect(result.analysis.plannedMoves).toHaveLength(8);
		expect(callLocalMcpToolJson).toHaveBeenCalledTimes(8);
	});

	it("treats local Sokoban movement as changed under the relaxed threshold", async () => {
		vi.mocked(estimateSnapshotChange).mockResolvedValueOnce(0.0035);
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
			companionRuntime: {
				ensureObservationContext: vi.fn(async () => ({ promptContext: "board summary", latestTimestamp: Date.now() })),
			} as never,
		});

		const result = await service.runValidationRound();

		expect(result.boardChanged).toBe(true);
	});
});
