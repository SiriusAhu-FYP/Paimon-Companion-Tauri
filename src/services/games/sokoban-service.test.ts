import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { SokobanService } from "./sokoban-service";
import { requestActiveTextDecision } from "./cloud-decision";
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";

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

function createService(requireObservationContext: () => { promptContext: string; latestTimestamp: number } | never) {
	return new SokobanService({
		bus: new EventBus(),
		orchestrator: {
			getState: vi.fn(() => ({
				selectedTarget: { handle: "target-sokoban", title: "Sokoban" },
			})),
			setTarget: vi.fn(),
		} as never,
		companionRuntime: {
			refreshNow: vi.fn().mockResolvedValue(undefined),
			requireObservationContext: vi.fn(requireObservationContext),
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

	it("fails when companion runtime is not running", async () => {
		const service = createService(() => {
			throw new Error("companion runtime is not running; start local observation before delegated actions");
		});

		await expect(service.runValidationRound()).rejects.toThrow(
			"companion runtime is not running; start local observation before delegated actions",
		);
	});

	it("fails when companion runtime target does not match the selected target", async () => {
		const service = createService(() => {
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
				refreshNow: vi.fn().mockResolvedValue(undefined),
				requireObservationContext: vi.fn(() => ({ promptContext: "board summary", latestTimestamp: Date.now() })),
			} as never,
		});

		const result = await service.runValidationRound();

		expect(result.analysis.plannedMoves).toHaveLength(8);
		expect(callLocalMcpToolJson).toHaveBeenCalledTimes(8);
	});
});
