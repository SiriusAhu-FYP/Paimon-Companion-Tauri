import { describe, expect, it } from "vitest";
import { __test } from "./delegated-task-runner";

const { applyBoardTaskConsistencyGuard, hasNoChangeEvidence, extractGridSignature, resolveOperationsNarration } = __test;

const GAME_CONTEXT = { gameId: "sokoban" as const, displayName: "Sokoban", actionIds: ["move_up"] };

function makeReflection(overrides: Record<string, unknown> = {}) {
	return {
		actionSucceeded: true,
		wasActionCorrect: true,
		expectedMet: true,
		expectationReview: "",
		goalAlignment: "closer" as const,
		goalProgress: "partial" as const,
		reply: "",
		nextHint: "",
		beforeStateSketch: "",
		afterStateSketch: "",
		stateDelta: "",
		...overrides,
	};
}

describe("applyBoardTaskConsistencyGuard", () => {
	it("does nothing when gameContext is null", () => {
		const reflection = makeReflection({ actionSucceeded: true });
		const result = applyBoardTaskConsistencyGuard(reflection, null);
		expect(result.actionSucceeded).toBe(true);
	});

	it("forces failure when stateDelta says no change", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			stateDelta: "无可确认变化",
		});
		const result = applyBoardTaskConsistencyGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(false);
		expect(result.expectedMet).toBe(false);
		expect(result.goalAlignment).toBe("unchanged");
		expect(result.goalProgress).toBe("none");
	});

	it("forces failure when before/after sketch are identical after normalization", () => {
		const sketch = "# # #\n# P #\n# B #\n# T #\n# # #";
		const reflection = makeReflection({
			actionSucceeded: true,
			stateDelta: "player moved left",
			beforeStateSketch: sketch,
			afterStateSketch: sketch,
		});
		const result = applyBoardTaskConsistencyGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(false);
		expect(result.goalAlignment).toBe("unchanged");
	});

	it("forces failure when before/after sketch differ only in whitespace/punctuation", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			stateDelta: "player moved left",
			beforeStateSketch: "#.P.B.T",
			afterStateSketch: "# . P . B . T",
		});
		const result = applyBoardTaskConsistencyGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(false);
	});

	it("allows success when before/after sketch genuinely differ", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			stateDelta: "player moved from row 2 to row 3",
			beforeStateSketch: "###\n#P#\n#B#\n#.#",
			afterStateSketch: "###\n#.#\n#P#\n#B#",
		});
		const result = applyBoardTaskConsistencyGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
	});
});

describe("hasNoChangeEvidence", () => {
	it("detects Chinese no-change phrases in stateDelta", () => {
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "无变化" }))).toBe(true);
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "基本没变" }))).toBe(true);
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "无可确认变化" }))).toBe(true);
	});

	it("detects English no-change phrases in stateDelta", () => {
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "no change" }))).toBe(true);
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "unchanged" }))).toBe(true);
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "no visible change" }))).toBe(true);
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "static" }))).toBe(true);
	});

	it("returns false when stateDelta describes actual change", () => {
		expect(hasNoChangeEvidence(makeReflection({ stateDelta: "player moved left" }))).toBe(false);
	});

	it("uses grid signature comparison as secondary check", () => {
		const grid = "###\n#P#\n###";
		const result = hasNoChangeEvidence(makeReflection({
			stateDelta: "player moved left",
			beforeStateSketch: grid,
			afterStateSketch: grid,
		}));
		expect(result).toBe(true);
	});
});

describe("extractGridSignature", () => {
	it("extracts grid rows from a sketch", () => {
		const sketch = "###\n#P#\n#B#\n###";
		const sig = extractGridSignature(sketch);
		expect(sig).toBe("###|#p#|#b#|###");
	});

	it("returns empty for non-grid text", () => {
		expect(extractGridSignature("player is near box")).toBe("");
	});

	it("strips non-grid characters but preserves grid symbols", () => {
		const sketch = "row1: # # P\nrow2: # B T\nrow3: # # #";
		const sig = extractGridSignature(sketch);
		expect(sig).toContain("#");
		expect(sig).toContain("p");
	});
});

describe("resolveOperationsNarration", () => {
		it("returns empty string (narrations are now silent)", () => {
			const planner = {
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				actions: [{ tool: "host.send_key", args: { key: "Left" } }],
			};
			const result = resolveOperationsNarration(planner, false);
			expect(result).toBe("");
		});

		it("returns empty string even when goalReached and canFinish", () => {
			const planner = {
				goalReached: true,
				reasoning: "",
				reply: "任务已完成",
				expectedOutcome: "",
				stateSketch: "",
				actions: [],
			};
			const result = resolveOperationsNarration(planner, true);
			expect(result).toBe("");
		});

		it("returns empty string for game.perform_action tool", () => {
			const planner = {
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				actions: [{ tool: "game.perform_action", args: { actionId: "move_up" } }],
			};
			const result = resolveOperationsNarration(planner, false);
			expect(result).toBe("");
		});
	});
