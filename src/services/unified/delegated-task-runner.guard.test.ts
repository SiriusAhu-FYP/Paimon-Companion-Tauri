import { describe, expect, it } from "vitest";
import { __test } from "./delegated-task-runner";

const {
	applyBoardTaskConsistencyGuard,
	applyBoardTaskProgressGuard,
	applyPhasePlanProgressGuard,
	applyMissionCompletionGuard,
	applySokobanDeadlockGuard,
	applySokobanPushTargetDirectionGuard,
	applySokobanPushIntentOutcomeGuard,
	applyEvaluatorHierarchyGuard,
	detectInvalidatedStrategyReuse,
	didRestartActionSucceed,
	shouldInvalidateStrategy,
	hasNoChangeEvidence,
	extractGridSignature,
	extractGridRows,
	hasBoardTaskCompletionEvidence,
	hasBoardTaskPositiveMovementEvidence,
	isSokobanMissionComplete,
	detectSokobanDeadlock,
	didBoardTaskMakeProgress,
	buildStrategyLesson,
	enrichEvaluatorDiagnosisFromExecutionError,
	buildCompletedLongSequenceFailureDetail,
	formatActionSequenceForDiagnosis,
	resolveOperationsNarration,
	resolveReflectionNarration,
	buildInitialCanonicalBoard,
	reconcileBoardObservationWithRouteState,
	reconcileSokobanDynamicBoard,
	parseSokobanBoardState,
	canLockInitialBoardTopology,
	scoreInitialBoardObservation,
	inferDelegationReplyLanguageMode,
	buildOperationsPlannerUserPrompt,
	buildOperationsPlannerSystemPrompt,
	buildProgressEvaluatorSystemPrompt,
	countRawPlannerActions,
	extractRawPlannerActionIds,
	detectLongSequencePlannerIssue,
	detectPlannerPolicyIssue,
	buildRepeatedFailureHint,
	classifySnapshotChangeScore,
	buildLongSequenceSnapshotChangeOptions,
	detectLongSequenceRecoveryReason,
	shouldContinueLongSequenceFromCurrentState,
	resetRouteStateAfterLongSequenceRecovery,
	PROGRESS_EVALUATOR_TEXT_MAX_TOKENS,
	PROGRESS_EVALUATOR_VISION_MAX_TOKENS,
} = __test;

const GAME_CONTEXT = { gameId: "sokoban" as const, displayName: "Sokoban", actionIds: ["move_up"] };

describe("delegation long sequence planning helpers", () => {
	it("infers reply language from explicit task language", () => {
		expect(inferDelegationReplyLanguageMode("Solve this puzzle!")).toBe("en");
		expect(inferDelegationReplyLanguageMode("请解决这个推箱子")).toBe("zh");
	});

	it("uses a dedicated long-sequence planner prompt instead of the short-step schema", () => {
		const prompt = buildOperationsPlannerUserPrompt({
			taskText: "Solve this puzzle!",
			round: 1,
			maxRounds: 20,
			target: { title: "Sokoban", handle: "0x1" },
			history: [],
			latestHint: "",
			mission: {
				taskMode: "game",
				missionGoal: "Solve the current Sokoban level.",
				hardConstraints: [],
				subtaskChain: ["read board", "solve"],
				completionSignals: ["all boxes on targets"],
				candidateStrategies: ["compare routes"],
				strategyWarnings: ["do not solve boxes linearly"],
				initialStateSummary: "",
				initialStateSketch: "",
				analysisReply: "",
				ackReply: "",
				reply: "",
			},
			gameContext: GAME_CONTEXT,
			allowedTools: ["game.perform_action"],
			scratchpadContext: "",
			plannerPolicyReminder: "",
			previousExpectedOutcome: "",
			previousExpectedMet: null,
			latestPhaseGoal: "",
			latestPhaseReason: "",
			latestPhaseAbortCondition: "",
			latestPhaseStatus: "",
			latestPhaseAssessment: "",
			latestActiveStrategy: "",
			latestStrategyRevision: "",
			latestPlanViability: "",
			latestPlanAssessment: "",
			invalidatedStrategies: [],
			strategyLessons: [],
			longSequenceMode: true,
			longSequenceMaxActions: 100,
			longSequenceMinActions: 12,
		});

		expect(prompt).toContain("LONG SEQUENCE MODE");
		expect(prompt).toContain("must not stop at a setup position");
		expect(prompt).toContain("simulate the whole sequence step by step");
		expect(prompt).toContain("wall collision");
		expect(prompt).toContain("up to 100 actions");
		expect(prompt).toContain("fewer than 12 actions");
	});

	it("puts long-sequence min/max action counts in the planner system prompt", () => {
		const prompt = buildOperationsPlannerSystemPrompt({
			allowedTools: ["game.perform_action"],
			maxActionsPerRound: 100,
			minActionsPerRound: 12,
			rules: [],
			gameContext: GAME_CONTEXT,
			longSequenceMode: true,
			mission: {
				taskMode: "game",
				missionGoal: "Solve the current Sokoban level.",
				hardConstraints: [],
				subtaskChain: [],
				completionSignals: [],
				candidateStrategies: [],
				strategyWarnings: [],
				initialStateSummary: "",
				initialStateSketch: "",
				analysisReply: "",
				ackReply: "",
				reply: "",
			},
		});

		expect(prompt).toContain("12 到 100");
		expect(prompt).toContain("短于 12 步会被工程层拒绝");
		expect(prompt).toContain("逐步模拟摘要");
	});

	it("gives progress evaluator enough room for long-sequence reflection", () => {
		expect(PROGRESS_EVALUATOR_TEXT_MAX_TOKENS).toBeGreaterThanOrEqual(1200);
		expect(PROGRESS_EVALUATOR_VISION_MAX_TOKENS).toBeGreaterThanOrEqual(1600);
	});

	it("counts raw planner actions before normalization", () => {
		const raw = JSON.stringify({
			actions: [
				{ tool: "game.perform_action", args: { actionId: "move_left" } },
				{ tool: "game.perform_action", args: { actionId: "move_down" } },
			],
		});
		expect(countRawPlannerActions(raw)).toBe(2);
		expect(extractRawPlannerActionIds(raw)).toEqual(["move_left", "move_down"]);
	});

	it("rejects suspiciously short long-sequence plans before execution", () => {
		const actions = [
			{ tool: "game.perform_action", args: { actionId: "move_left", gameId: "sokoban" } },
			{ tool: "game.perform_action", args: { actionId: "move_right", gameId: "sokoban" } },
		];
		const issue = detectLongSequencePlannerIssue({
			actions,
			minActions: 12,
			maxActions: 100,
			round: 1,
		});
		expect(issue).toContain("only 2/12 actions");
		expect(issue).toContain("move_left -> move_right");
		expect(issue).toContain("planner-contract feedback before execution");
	});

	it("classifies tiny screenshot diffs as unchanged for long-sequence step verification", () => {
		expect(classifySnapshotChangeScore(0)).toBe(true);
		expect(classifySnapshotChangeScore(0.0007)).toBe(true);
		expect(classifySnapshotChangeScore(0.001)).toBe(false);
		expect(classifySnapshotChangeScore(0.002)).toBe(false);
		expect(classifySnapshotChangeScore(0.01)).toBe(false);
	});

	it("does not ban repeated movement directions in long-sequence planner policy", () => {
		const actions = [
			{ tool: "game.perform_action", args: { actionId: "move_right", gameId: "sokoban" } },
		];
		const recentActionOutcomes = [
			makeActionOutcome("game.perform_action|actionId=move_right"),
			makeActionOutcome("game.perform_action|actionId=move_right"),
		];

		expect(detectPlannerPolicyIssue({
			goalReached: false,
			expectedOutcome: "try a corrected route",
			actions,
			latestHint: "",
			recentActionOutcomes,
			longSequenceMode: true,
		})).toBe("");
		expect(detectPlannerPolicyIssue({
			goalReached: false,
			expectedOutcome: "try a corrected route",
			actions,
			latestHint: "",
			recentActionOutcomes,
			longSequenceMode: false,
		})).toContain("禁止再次输出同签名动作");
	});

	it("turns repeated long-sequence action failures into prefix lessons instead of direction bans", () => {
		const hint = buildRepeatedFailureHint([
			makeActionOutcome("game.perform_action|actionId=move_right"),
			makeActionOutcome("game.perform_action|actionId=move_right"),
		], { longSequenceMode: true });

		expect(hint).toContain("不要禁用这个方向");
		expect(hint).toContain("修正失败前缀");
		expect(hint).not.toContain("不得重复同动作");
	});

	it("keeps repeated-action bans in normal step-by-step mode", () => {
		const hint = buildRepeatedFailureHint([
			makeActionOutcome("game.perform_action|actionId=move_right"),
			makeActionOutcome("game.perform_action|actionId=move_right"),
		], { longSequenceMode: false });

		expect(hint).toContain("不得重复同动作");
	});

	it("uses the configured vision crop for long-sequence snapshot change checks", () => {
		const options = buildLongSequenceSnapshotChangeOptions({
			visionPreprocess: {
				enabled: true,
				mode: "crop-only",
				crop: { xNorm: 0.36, yNorm: 0.08, widthNorm: 0.32, heightNorm: 0.88 },
				maxWidth: 960,
				maxHeight: 720,
				format: "png",
				quality: 1,
			},
		} as never);

		expect(options.threshold).toBe(0.00075);
		expect(options.crop).toEqual({ xNorm: 0.36, yNorm: 0.08, widthNorm: 0.32, heightNorm: 0.88 });
	});

	it("falls back to spoken planner narration when the model reply is empty", () => {
		const narration = resolveOperationsNarration({
			goalReached: false,
			reasoning: "",
			reply: "",
			expectedOutcome: "",
			stateSketch: "",
			currentPhaseGoal: "",
			whyThisPhase: "",
			abortCondition: "",
			activeStrategy: "",
			strategyRevision: "",
			routeSelfCheck: "",
			committedRoute: "",
			currentRouteStep: "",
			routeRisks: [],
			actions: [{ tool: "game.perform_action", args: { actionId: "move_right", gameId: "sokoban" } }],
		}, false, "en");

		expect(narration).toContain("right");
	});

	it("falls back to spoken evaluator narration when interrupted reflection has no reply", () => {
		const narration = resolveReflectionNarration(
			makeReflection({ reply: "", expectedMet: false, actionSucceeded: false }),
			"Long sequence stopped at step 1/12",
			"en",
		);

		expect(narration).toContain("failed at step 1/12");
		expect(narration).not.toContain("That attempt stopped early");
	});

	it("falls back to spoken evaluator narration for completed failed long routes", () => {
		const narration = resolveReflectionNarration(
			makeReflection({ reply: "", expectedMet: false, actionSucceeded: false }),
			"Long sequence completed 12/12 actions but did not solve the level.",
			"en",
		);

		expect(narration).toContain("full 12/12 route ran");
		expect(narration).toContain("restart");
	});

	it("uses a long-sequence evaluator prompt that diagnoses failed prefixes without banning directions", () => {
		const prompt = buildProgressEvaluatorSystemPrompt([], makeMission(), { longSequenceMode: true });

		expect(prompt).toContain("动作前缀");
		expect(prompt).toContain("routeStateUpdate/latestDiagnosis");
		expect(prompt).toContain("失败几何原因");
		expect(prompt).toContain("不要把它描述成系统没有执行");
		expect(prompt).toContain("若 after 图仍可续解且更接近目标");
		expect(prompt).toContain("不要把“某方向在某个站位失败”泛化成永远禁止该方向");
		expect(prompt).not.toContain("不得重复同动作");
	});

	it("folds failed-prefix lessons into existing evaluator diagnosis fields when evaluator is sparse", () => {
		const enriched = enrichEvaluatorDiagnosisFromExecutionError(
			makeReflection({ latestDiagnosis: "", routeStateUpdate: "" }),
			"Long sequence stopped at step 10/12: board screenshot did not meaningfully change after 500ms. failedAction=game.perform_action({\"actionId\":\"move_up\",\"gameId\":\"sokoban\"}) executedPrefix=game.perform_action({\"actionId\":\"move_right\",\"gameId\":\"sokoban\"}) -> game.perform_action({\"actionId\":\"move_down\",\"gameId\":\"sokoban\"}) remainingActions=2",
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "",
				strategyRevision: "",
				committedRoute: "lower-box-first, then reroute to upper box",
				actions: [],
			},
			"move_right -> move_down",
		);

		expect(enriched.routeStateUpdate).toContain("failedStep=10/12");
		expect(enriched.routeStateUpdate).toContain("failedPrefix=");
		expect(enriched.routeStateUpdate).toContain("right");
		expect(enriched.routeStateUpdate).toContain("failureGeometry=");
		expect(enriched.routeStateUpdate).toContain("up");
		expect(enriched.routeStateUpdate).toContain("preserveUsefulPrefixFrom=lower-box-first");
		expect(enriched.routeStateUpdate).toContain("abandonUnchangedPrefix=");
		expect(enriched.routeStateUpdate).not.toContain("game.perform_action({");
		expect(enriched.latestDiagnosis).toContain("exact prefix");
	});

	it("builds recovery details for completed long-sequence attempts that miss the expected result", () => {
		const detail = buildCompletedLongSequenceFailureDetail({
			executedCount: 12,
			totalCount: 12,
			actionSummary: 'game.perform_action({"actionId":"move_right","gameId":"sokoban"}) -> game.perform_action({"actionId":"move_down","gameId":"sokoban"})',
			reflection: makeReflection({
				expectedMet: false,
				actionSucceeded: false,
				goalAlignment: "unchanged",
				goalProgress: "none",
				phaseStatus: "stalled",
				latestDiagnosis: "not solved",
			}),
		});

		expect(detail).toContain("Long sequence completed 12/12 actions");
		expect(detail).toContain("right -> down");
		expect(detail).toContain("Restart before the next planner turn");
	});

	it("keeps completed long-sequence details recoverable when evaluator reports partial progress", () => {
		const detail = buildCompletedLongSequenceFailureDetail({
			executedCount: 12,
			totalCount: 12,
			actionSummary: 'game.perform_action({"actionId":"move_right","gameId":"sokoban"})',
			reflection: makeReflection({
				expectedMet: false,
				actionSucceeded: true,
				goalAlignment: "closer",
				goalProgress: "partial",
				phaseStatus: "advanced",
				latestDiagnosis: "one box is on target and the remaining board is recoverable",
			}),
		});

		expect(detail).toContain("Current board appears recoverable");
		expect(detail).not.toContain("Restart before the next planner turn");
	});

	it("formats tool-call action summaries as readable direction chains", () => {
		expect(formatActionSequenceForDiagnosis(
			'game.perform_action({"actionId":"move_right","gameId":"sokoban"}) -> game.perform_action({"actionId":"move_down","gameId":"sokoban"})',
		)).toBe("right -> down");
	});

	it("resets after an interrupted long sequence attempt", () => {
		expect(detectLongSequenceRecoveryReason({
			executionError: "Long sequence stopped at step 4/12: board screenshot did not meaningfully change",
			reflection: makeReflection({
				expectedMet: false,
				actionSucceeded: false,
				goalAlignment: "unchanged",
				goalProgress: "none",
				phaseStatus: "blocked",
			}),
		})).toContain("Long sequence stopped");
	});

	it("resets after a completed long sequence attempt that did not solve the level", () => {
		expect(detectLongSequenceRecoveryReason({
			executionError: "Long sequence completed 12/12 actions but did not solve the level.",
			reflection: makeReflection({
				expectedMet: false,
				actionSucceeded: false,
				goalAlignment: "unchanged",
				goalProgress: "none",
				phaseStatus: "stalled",
			}),
		})).toContain("Long sequence completed");
	});

	it("does not schedule recovery reset when long sequence made recoverable partial progress", () => {
		const reflection = makeReflection({
			expectedMet: false,
			actionSucceeded: true,
			goalAlignment: "closer",
			goalProgress: "partial",
			phaseStatus: "advanced",
			latestDiagnosis: "one box is on target and the board is recoverable",
		});

		expect(shouldContinueLongSequenceFromCurrentState(reflection)).toBe(true);
		expect(detectLongSequenceRecoveryReason({
			executionError: "Long sequence completed 12/12 actions but did not solve the level.",
			reflection,
		})).toBe("");
	});

	it("rejects reset_level inside long-sequence planner actions", () => {
		const issue = detectLongSequencePlannerIssue({
			actions: [
				{ tool: "game.perform_action", args: { actionId: "reset_level", gameId: "sokoban" } },
				{ tool: "game.perform_action", args: { actionId: "move_right", gameId: "sokoban" } },
			],
			minActions: 12,
			maxActions: 100,
			round: 7,
		});

		expect(issue).toContain("Do not output reset_level");
		expect(issue).toContain("step(s): 1");
	});

	it("schedules long-sequence recovery for hard deadlocked attempts", () => {
		expect(detectLongSequenceRecoveryReason({
			executionError: "",
			reflection: makeReflection({
				phaseStatus: "blocked",
				planViability: "invalidated",
				nextHint: "Sokoban deadlock detected; click restart.",
			}),
		})).toContain("deadlock");
	});

	it("clears active long-sequence route state after forced recovery reset", () => {
		const routeState = {
			currentBoard: "deadlocked-board",
			canonicalInitialBoard: "initial-board",
			canonicalTopology: "topology",
			topologyLocked: true,
			latestRawBoard: "deadlocked-board",
			boardObservationWarnings: [],
			routeHypotheses: ["route"],
			committedRoute: "bad route",
			currentRouteStep: "bad step",
			routeRisks: ["risk"],
			invalidatedRouteLessons: ["lesson"],
			latestDiagnosis: "deadlocked",
		};
		const result = resetRouteStateAfterLongSequenceRecovery(routeState);
		expect(result?.currentBoard).toBe("initial-board");
		expect(result?.committedRoute).toBe("");
		expect(result?.currentRouteStep).toBe("");
		expect(result?.invalidatedRouteLessons).toEqual(["lesson"]);
	});
});

function makeActionOutcome(signature: string) {
	return {
		signature,
		actionSucceeded: false,
		wasActionCorrect: false,
		goalAlignment: "unchanged" as const,
		goalProgress: "none" as const,
		madeProgress: false,
	};
}

function makeMission() {
	return {
		taskMode: "game" as const,
		missionGoal: "Solve the current Sokoban level.",
		hardConstraints: [],
		subtaskChain: [],
		completionSignals: [],
		candidateStrategies: [],
		strategyWarnings: [],
		initialStateSummary: "",
		initialStateSketch: "",
		analysisReply: "",
		ackReply: "",
		reply: "",
	};
}

function makeBoardObservation(boardGrid: string, overrides: Record<string, unknown> = {}) {
	return {
		boardGrid,
		entities: [],
		confidence: "high" as const,
		ambiguities: [],
		source: "cloud" as const,
		originalWidth: 100,
		originalHeight: 100,
		processedWidth: 100,
		processedHeight: 100,
		preprocessed: false,
		...overrides,
	};
}

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
		planViability: "unchanged" as const,
		planAssessment: "",
		...overrides,
	};
}

describe("canonical Sokoban board reconciliation", () => {
	it("does not lock a Sokoban topology until core invariants are satisfied", () => {
		const missingTargets = [
			"######",
			"#P...#",
			"#..B.#",
			"#..B.#",
			"######",
		].join("\n");
		const validLevel2 = [
			"######",
			"#P...#",
			"#..BT#",
			"#.TB.#",
			"######",
		].join("\n");
		const mission = { initialStateSketch: missingTargets };

		expect(canLockInitialBoardTopology(GAME_CONTEXT, missingTargets)).toBe(false);
		expect(canLockInitialBoardTopology(GAME_CONTEXT, validLevel2)).toBe(true);
		expect(buildInitialCanonicalBoard(GAME_CONTEXT, mission as never, makeBoardObservation(missingTargets))).toBeNull();
		expect(scoreInitialBoardObservation(makeBoardObservation(validLevel2), GAME_CONTEXT))
			.toBeGreaterThan(scoreInitialBoardObservation(makeBoardObservation(missingTargets), GAME_CONTEXT));
	});

	it("locks mission topology and only merges later P/B dynamics", () => {
		const initial = [
			"######",
			"#P..T#",
			"#..B.#",
			"#.TB.#",
			"######",
		].join("\n");
		const laterMissingTargets = [
			"######",
			"#...P#",
			"#...B#",
			"#..B.#",
			"######",
		].join("\n");
		const mission = {
			initialStateSketch: initial,
		};
		const canonical = buildInitialCanonicalBoard(GAME_CONTEXT, mission as never, makeBoardObservation(""));
		expect(canonical?.topology).toBe([
			"######",
			"#...T#",
			"#....#",
			"#.T..#",
			"######",
		].join("\n"));

		const routeState = {
			currentBoard: canonical?.currentBoard ?? "",
			canonicalInitialBoard: canonical?.currentBoard,
			canonicalTopology: canonical?.topology,
			topologyLocked: true,
			latestRawBoard: initial,
			boardObservationWarnings: [],
			routeHypotheses: [],
			committedRoute: "",
			currentRouteStep: "",
			routeRisks: [],
			invalidatedRouteLessons: [],
			latestDiagnosis: "",
		};
		const result = reconcileBoardObservationWithRouteState(
			routeState,
			makeBoardObservation(laterMissingTargets),
			GAME_CONTEXT,
		);

		expect(result.boardGrid).toBe([
			"######",
			"#...+#",
			"#...B#",
			"#.TB.#",
			"######",
		].join("\n"));
		expect(result.ambiguities.join(" ")).toContain("topology differed");
	});

	it("rejects later boards that lose the player or change dimensions", () => {
		const routeState = {
			currentBoard: [
				"######",
				"#P..T#",
				"#..B.#",
				"#.T..#",
				"######",
			].join("\n"),
			canonicalInitialBoard: [
				"######",
				"#P..T#",
				"#..B.#",
				"#.T..#",
				"######",
			].join("\n"),
			canonicalTopology: [
				"######",
				"#...T#",
				"#....#",
				"#.T..#",
				"######",
			].join("\n"),
			topologyLocked: true,
			latestRawBoard: "",
			boardObservationWarnings: [],
			routeHypotheses: [],
			committedRoute: "",
			currentRouteStep: "",
			routeRisks: [],
			invalidatedRouteLessons: [],
			latestDiagnosis: "",
		};

		expect(reconcileSokobanDynamicBoard(routeState, "###\n#B#\n###").boardGrid).toBe(routeState.currentBoard);
		expect(reconcileSokobanDynamicBoard(routeState, "######\n#...T#\n#..B.#\n#.T..#\n######").boardGrid).toBe(routeState.currentBoard);
	});

	it("parses player/box-on-target as dynamic entities over target topology", () => {
		const parsed = parseSokobanBoardState("#####\n#+*.#\n#####");
		expect(parsed?.topology).toBe("#####\n#TT.#\n#####");
		expect(parsed?.currentBoard).toBe("#####\n#+*.#\n#####");
		expect(parsed?.player).toBe("1:1");
		expect(parsed?.boxes).toEqual(["1:2"]);
	});
});

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

describe("applyPhasePlanProgressGuard", () => {
	it("upgrades advanced phase progress to partial success when the board changed", () => {
		const reflection = makeReflection({
			actionSucceeded: false,
			wasActionCorrect: false,
			expectedMet: false,
			goalAlignment: "unchanged",
			goalProgress: "none",
			beforeStateSketch: "######\n#P...#\n#..B.#\n#.T..#\n######",
			afterStateSketch: "######\n#.P..#\n#..B.#\n#.T..#\n######",
			stateDelta: "P moved one tile right to prepare the next push.",
			phaseStatus: "advanced",
			phaseAssessment: "站位更好，已接近下一推位。",
		});
		const result = applyPhasePlanProgressGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(true);
		expect(result.goalAlignment).toBe("closer");
		expect(result.goalProgress).toBe("partial");
	});

	it("upgrades strengthened plan viability to partial success even when expectedMet is false", () => {
		const reflection = makeReflection({
			actionSucceeded: false,
			wasActionCorrect: false,
			expectedMet: false,
			goalAlignment: "deviated",
			goalProgress: "none",
			beforeStateSketch: "######\n#P...#\n#..B.#\n#.T..#\n######",
			afterStateSketch: "######\n#....#\n#.PB.#\n#.T..#\n######",
			stateDelta: "P moved down beside the box and opened the intended route.",
			phaseStatus: "stalled",
			planViability: "strengthened",
			planAssessment: "当前路线更可信，已完成关键站位。",
		});
		const result = applyPhasePlanProgressGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.goalAlignment).toBe("closer");
		expect(result.goalProgress).toBe("partial");
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

	it("does not treat player standing on a target as completed", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			afterStateSketch: "#####\n#...#\n#.+.#\n#####",
			stateDelta: "The player is standing on the only visible target as +, but no box is on a target.",
		});
		const result = applyMissionCompletionGuard(reflection, GAME_CONTEXT);
		expect(result.goalAlignment).toBe("closer");
		expect(result.goalProgress).toBe("partial");
		expect(result.nextHint).toContain("整关尚未完成");
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
			beforeStateSketch: "######\n#....#\n#....#\n#.TB.#\n#...B#\n######",
			afterStateSketch: "######\n#....#\n#...*#\n#.T.B#\n#....#\n######",
			stateDelta: "B moved right into a wall-locked corner position while the player advanced.",
			nextHint: "Try approaching the lower box from below.",
		});
		const result = applySokobanDeadlockGuard(reflection, GAME_CONTEXT);
		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(false);
		expect(result.expectedMet).toBe(false);
		expect(result.goalAlignment).toBe("deviated");
		expect(result.goalProgress).toBe("none");
		expect(result.planViability).toBe("invalidated");
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

	it("does not treat + alone as solved mission state", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			afterStateSketch: "#####\n#.+.#\n#####",
		});
		expect(isSokobanMissionComplete(reflection)).toBe(false);
	});

	it("does not trigger deadlock on pure player repositioning with unchanged boxes", () => {
		const reflection = makeReflection({
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: false,
			goalAlignment: "closer",
			goalProgress: "partial",
			beforeStateSketch: "######\n#....#\n#..P*#\n#.T.B#\n#....#\n######",
			afterStateSketch: "######\n#...P#\n#...*#\n#.T.B#\n#....#\n######",
			stateDelta: "P moved one tile right above the solved box. No box moved.",
		});
		const result = applySokobanDeadlockGuard(reflection, GAME_CONTEXT);
		expect(result.planViability).toBe("unchanged");
		expect(result.goalProgress).toBe("partial");
	});
});

describe("strategy invalidation helpers", () => {
	it("blocks planner from reusing an invalidated strategy", () => {
		const issue = detectInvalidatedStrategyReuse(
			"先拆下箱，再为上箱腾空间",
			["先拆下箱，再为上箱腾空间"],
		);
		expect(issue).toContain("错误");
	});

	it("does not block broad strategy families after a non-hard invalidation", () => {
		const issue = detectInvalidatedStrategyReuse(
			"Use the upper box for the upper-right target first, then finish the lower box.",
			["Convert the current staged position into the safe partial completion: upper box to upper-right target first, then use the remaining space to finish the lower box onto the lower-left target."],
		);
		expect(issue).toBe("");
	});

	it("blocks semantically similar strategies only after hard deadlock/restart evidence", () => {
		const issue = detectInvalidatedStrategyReuse(
			"Use the upper box for the upper-right target first, then finish the lower box.",
			["Deadlock restart route: upper box to upper-right target first, then finish the lower box onto the lower-left target."],
		);
		expect(issue).toContain("相似");
	});

	it("marks strategy invalid when evaluator reports deadlock/restart route failure", () => {
		const shouldInvalidate = shouldInvalidateStrategy(
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "先拆下箱，再为上箱腾空间",
				strategyRevision: "",
				actions: [],
			},
			makeReflection({
				planViability: "invalidated",
				planAssessment: "当前路线已被死局证明错误。",
			}),
		);
		expect(shouldInvalidate).toBe(true);
	});

	it("detects successful restart actions from reflection text", () => {
		const restarted = didRestartActionSucceed(
			{
				tool: "host.send_mouse",
				args: { locatorHint: "点击右上角紫红色重置按钮 restart" },
			},
			makeReflection({
				stateDelta: "已重开，棋盘回到初始局面。",
				phaseAssessment: "Restart succeeded and the board returned to the initial state.",
			}),
		);
		expect(restarted).toBe(true);
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
		const deadlock = detectSokobanDeadlock(
			"######\n#....#\n#...*#\n#.+B.#\n#....#\n######",
			"######\n#....#\n#...*#\n#.+.B#\n#....#\n######",
			"B moved right into a blocked wall position.",
		);
		expect(deadlock?.reason).toContain("死局");
	});

	it("does not flag ordinary unsolved boards", () => {
		const deadlock = detectSokobanDeadlock(
			"######\n#P...#\n#..BT#\n#.TB.#\n#....#\n######",
			"######\n#P...#\n#..BT#\n#.TB.#\n#....#\n######",
			"No box moved.",
		);
		expect(deadlock).toBeNull();
	});
});

describe("applySokobanPushTargetDirectionGuard", () => {
	it("invalidates a final push that moves a box away from the target side", () => {
		const result = applySokobanPushTargetDirectionGuard(
			makeReflection({
				beforeStateSketch: "######\n#....#\n#...*#\n#.+B.#\n#....#\n######",
				nextHint: "Finish the remaining target.",
			}),
			GAME_CONTEXT,
			{ tool: "game.perform_action", args: { actionId: "move_right" } },
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "Final push: move the remaining box onto the target and complete the level.",
				stateSketch: "",
				currentPhaseGoal: "finish the remaining target",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "finish from left side",
				strategyRevision: "",
				actions: [],
			},
		);

		expect(result.wasActionCorrect).toBe(false);
		expect(result.planViability).toBe("weakened");
		expect(result.nextHint).toContain("move_left");
	});

	it("does not invalidate unrelated reposition moves", () => {
		const result = applySokobanPushTargetDirectionGuard(
			makeReflection({
				beforeStateSketch: "######\n#....#\n#...*#\n#.+B.#\n#....#\n######",
			}),
			GAME_CONTEXT,
			{ tool: "game.perform_action", args: { actionId: "move_right" } },
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "Probe whether the box can move.",
				stateSketch: "",
				currentPhaseGoal: "probe a side lane",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "test lane",
				strategyRevision: "",
				actions: [],
			},
		);

		expect(result.wasActionCorrect).toBe(true);
		expect(result.planViability).toBe("unchanged");
	});

	it("invalidates failed final pushes sent through host.send_key", () => {
		const result = applySokobanPushTargetDirectionGuard(
			makeReflection({
				expectedMet: false,
				goalAlignment: "unchanged",
				goalProgress: "none",
				beforeStateSketch: "#######\n#.....#\n#...P*#\n#....B#\n#######",
				stateDelta: "Only the player moved one tile left; no box was pushed onto the target.",
				planAssessment: "The presumed finishing push direction was incorrect from this position.",
			}),
			GAME_CONTEXT,
			{ tool: "host.send_key", args: { key: "Left" } },
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "The player pushes the final box onto the remaining target and completes the level.",
				stateSketch: "",
				currentPhaseGoal: "Place the lower box onto the remaining target with one final push.",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "finish from current endgame alignment",
				strategyRevision: "",
				actions: [],
			},
		);

		expect(result.wasActionCorrect).toBe(false);
		expect(result.planViability).toBe("weakened");
		expect(result.nextHint).toContain("重置按钮");
	});
});

describe("push intent and evaluator hierarchy guards", () => {
	it("downgrades box-push intent when only the player moved", () => {
		const result = applySokobanPushIntentOutcomeGuard(
			makeReflection({
				expectedMet: false,
				actionSucceeded: true,
				wasActionCorrect: true,
				goalAlignment: "closer",
				goalProgress: "partial",
				phaseStatus: "advanced",
				planViability: "strengthened",
				stateDelta: "Only the player moved one tile right; both boxes stayed fixed and no box was pushed.",
				expectationReview: "The lower box did not move onto the lower-left target.",
			}),
			GAME_CONTEXT,
			{ tool: "game.perform_action", args: { actionId: "move_right" } },
			{
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "The lower box moves one tile left onto the lower-left target.",
				stateSketch: "",
				currentPhaseGoal: "Place the lower box onto the lower target while keeping the upper box movable.",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "Solve the lower target first.",
				strategyRevision: "",
				actions: [],
			},
		);

		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(false);
		expect(result.goalProgress).toBe("none");
		expect(result.planViability).toBe("weakened");
		expect(result.nextHint).toContain("P 必须先站到箱子左侧");
	});

	it("keeps physical execution success but rejects correctness when expectedMet is false", () => {
		const result = applyEvaluatorHierarchyGuard(
			makeReflection({
				expectedMet: false,
				actionSucceeded: true,
				wasActionCorrect: true,
				goalAlignment: "closer",
				goalProgress: "partial",
				phaseStatus: "advanced",
				phaseAssessment: "The phase did not advance because the lower box was not placed on target and setup was lost.",
			}),
			GAME_CONTEXT,
		);

		expect(result.actionSucceeded).toBe(true);
		expect(result.wasActionCorrect).toBe(false);
		expect(result.goalProgress).toBe("none");
		expect(result.phaseStatus).toBe("stalled");
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
				activeStrategy: "先拆下箱，再为上箱腾空间",
				strategyRevision: "放弃先做上箱的路线",
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
		it("falls back to a spoken first-action narration", () => {
			const planner = {
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "",
				strategyRevision: "",
				actions: [{ tool: "host.send_key", args: { key: "Left" } }],
			};
			const result = resolveOperationsNarration(planner, false, "en");
			expect(result).toContain("left");
		});

		it("uses planner reply when goalReached and canFinish", () => {
			const planner = {
				goalReached: true,
				reasoning: "",
				reply: "任务已完成",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "",
				strategyRevision: "",
				actions: [],
			};
			const result = resolveOperationsNarration(planner, true, "zh");
			expect(result).toBe("任务已完成");
		});

		it("falls back to a game.perform_action narration", () => {
			const planner = {
				goalReached: false,
				reasoning: "",
				reply: "",
				expectedOutcome: "",
				stateSketch: "",
				currentPhaseGoal: "",
				whyThisPhase: "",
				abortCondition: "",
				activeStrategy: "",
				strategyRevision: "",
				actions: [{ tool: "game.perform_action", args: { actionId: "move_up" } }],
			};
			const result = resolveOperationsNarration(planner, false, "en");
			expect(result).toContain("up");
		});
	});
