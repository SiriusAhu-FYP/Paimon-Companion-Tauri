import { describe, expect, it } from "vitest";
import { __test } from "./delegated-task-runner";

const {
	applyBoardTaskConsistencyGuard,
	applyBoardTaskProgressGuard,
	applyMissionCompletionGuard,
	applySokobanDeadlockGuard,
	hasNoChangeEvidence,
	extractGridSignature,
	extractGridRows,
	hasBoardTaskCompletionEvidence,
	hasBoardTaskPositiveMovementEvidence,
	isSokobanMissionComplete,
	detectSokobanDeadlock,
	didBoardTaskMakeProgress,
	buildStrategyLesson,
	resolveOperationsNarration,
} = __test;

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
		phaseStatus: "advanced" as const,
		phaseAssessment: "",
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

describe("applyBoardTaskProgressGuard", () => {
	it("forces terminal success when completion evidence is present", () => {
		const reflection = makeReflection({
			actionSucceeded: false,
			wasActionCorrect: false,
			expectedMet: false,
			goalAlignment: "deviated",
			goalProgress: "none",
			stateDelta: "P moved down onto the box's former tile, B moved down onto T so that tile became *, and the game advanced to a LEVEL COMPLETE state.",
			afterStateSketch: "LEVEL COMPLETE overlay shown",
		});
		const result = applyBoardTaskProgressGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(true);
		expect(result.expectedMet).toBe(true);
		expect(result.goalAlignment).toBe("achieved");
		expect(result.goalProgress).toBe("done");
	});

	it("upgrades positive movement to partial progress without forcing expectedMet", () => {
		const reflection = makeReflection({
			actionSucceeded: false,
			wasActionCorrect: false,
			expectedMet: false,
			goalAlignment: "deviated",
			goalProgress: "none",
			stateDelta: "P moved one tile left onto the cell directly above B. B did not move. T did not move.",
		});
		const result = applyBoardTaskProgressGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(true);
		expect(result.expectedMet).toBe(false);
		expect(result.goalAlignment).toBe("closer");
		expect(result.goalProgress).toBe("partial");
	});

	it("does not upgrade no-change evidence", () => {
		const reflection = makeReflection({
			actionSucceeded: false,
			wasActionCorrect: false,
			expectedMet: false,
			goalAlignment: "deviated",
			goalProgress: "none",
			stateDelta: "No confirmable change.",
		});
		const result = applyBoardTaskProgressGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(false);
		expect(result.goalProgress).toBe("none");
	});
});

describe("applyMissionCompletionGuard", () => {
	it("downgrades false terminal completion when sokoban still has uncovered targets", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			afterStateSketch: "######\n#....#\n#..P*#\n#.TB.#\n#....#\n######",
			stateDelta: "The upper box moved right onto the upper target and became *. The lower box and lower target remained in the same positions.",
			nextHint: "Next state: place the lower box onto the lower target.",
		});
		const result = applyMissionCompletionGuard(reflection, GAME_CONTEXT);
		expect(result.goalAlignment).toBe("closer");
		expect(result.goalProgress).toBe("partial");
		expect(result.nextHint).toContain("整关尚未完成");
	});

	it("keeps terminal completion when all visible targets are covered", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			afterStateSketch: "#####\n#...#\n#.###\n#P#\n#*#\n###",
			stateDelta: "P moved down onto the box's former tile, B moved down onto T so that tile became *.",
		});
		const result = applyMissionCompletionGuard(reflection, GAME_CONTEXT);
		expect(result.goalAlignment).toBe("achieved");
		expect(result.goalProgress).toBe("done");
	});
});

describe("applySokobanDeadlockGuard", () => {
	it("marks wall-locked unsolved box as deadlock and requests restart", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "closer",
			goalProgress: "partial",
			afterStateSketch: "######\n#....#\n#...*#\n#.T.B#\n#....#\n######",
			nextHint: "Try approaching the lower box from below.",
		});
		const result = applySokobanDeadlockGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(false);
		expect(result.expectedMet).toBe(false);
		expect(result.goalAlignment).toBe("deviated");
		expect(result.goalProgress).toBe("none");
		expect(result.nextHint).toContain("重置按钮");
	});

	it("does not trigger on solved mission state", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			afterStateSketch: "#####\n#...#\n#.+*#\n#####",
		});
		const result = applySokobanDeadlockGuard(reflection, GAME_CONTEXT);
		expect(result.goalAlignment).toBe("achieved");
		expect(result.goalProgress).toBe("done");
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

describe("board progress evidence helpers", () => {
	it("detects completion evidence from stateDelta and overlay text", () => {
		const reflection = makeReflection({
			stateDelta: "B moved down onto T so that tile became *, and the game advanced to a LEVEL COMPLETE state.",
			afterStateSketch: "LEVEL COMPLETE overlay shown",
		});
		expect(hasBoardTaskCompletionEvidence(reflection)).toBe(true);
	});

	it("detects positive movement evidence from stateDelta", () => {
		const reflection = makeReflection({
			stateDelta: "P moved one tile left along the top corridor.",
			goalAlignment: "deviated",
			goalProgress: "none",
		});
		expect(hasBoardTaskPositiveMovementEvidence(reflection)).toBe(true);
		expect(didBoardTaskMakeProgress(reflection)).toBe(true);
	});

	it("does not treat no-change text as positive progress", () => {
		const reflection = makeReflection({
			stateDelta: "No visible change: P, B, and T remain in the same cells.",
			actionSucceeded: false,
			wasActionCorrect: false,
			goalAlignment: "unchanged",
			goalProgress: "none",
		});
		expect(hasBoardTaskPositiveMovementEvidence(reflection)).toBe(false);
		expect(didBoardTaskMakeProgress(reflection)).toBe(false);
	});

	it("detects incomplete sokoban boards when uncovered targets remain", () => {
		const reflection = makeReflection({
			afterStateSketch: "######\n#....#\n#..P*#\n#.TB.#\n#....#\n######",
		});
		expect(isSokobanMissionComplete(reflection)).toBe(false);
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

	it("extracts uppercase grid rows for deadlock analysis", () => {
		const rows = extractGridRows("# # P\n# B T\n# # #");
		expect(rows).toEqual(["##P", "#BT", "###"]);
	});
});

describe("detectSokobanDeadlock", () => {
	it("detects a box trapped against wall and completed box", () => {
		const deadlock = detectSokobanDeadlock("######\n#....#\n#...*#\n#.+.B#\n#....#\n######");
		expect(deadlock?.reason).toContain("死局");
	});

	it("does not flag ordinary unsolved boards", () => {
		const deadlock = detectSokobanDeadlock("######\n#P...#\n#..BT#\n#.TB.#\n#....#\n######");
		expect(deadlock).toBeNull();
	});
});

describe("buildStrategyLesson", () => {
	it("records blocked phase lessons with strategy-level wording", () => {
		const lesson = buildStrategyLesson({
			planner: {
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "先把下箱移到可继续操作的位置",
				whyThisPhase: "上箱当前无法直接处理",
				abortCondition: "若下箱被推到右墙死位则重开",
				actions: [],
			},
			reflection: makeReflection({
				phaseStatus: "blocked",
				phaseAssessment: "下箱贴右墙形成死局。",
				nextHint: "点击右上角紫红色重置按钮重开，并不要重复同一路线。",
			}),
		});
		expect(lesson).toContain("避免重复阶段");
		expect(lesson).toContain("先把下箱移到可继续操作的位置");
		expect(lesson).toContain("死局");
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
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
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
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
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
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				actions: [{ tool: "game.perform_action", args: { actionId: "move_up" } }],
			};
			const result = resolveOperationsNarration(planner, false);
			expect(result).toBe("");
		});
	});
