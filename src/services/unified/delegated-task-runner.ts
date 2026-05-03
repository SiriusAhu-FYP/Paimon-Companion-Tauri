import { getConfig } from "@/services/config";
import { requestActiveTextDecision, requestActiveVisionDecision } from "@/services/games/cloud-decision";
import { estimateSnapshotChange } from "@/services/games/game-utils";
import { findSemanticGameByTargetTitle, getSemanticGameManifest } from "@/services/games/semantic-game-registry";
import { createLogger } from "@/services/logger";
import { callLocalMcpTool, callLocalMcpToolJson, listLocalMcpTools } from "@/services/mcp/local-mcp-client";
import type { OrchestratorService } from "@/services/orchestrator";
import { requestOpenAICompatibleVision } from "@/services/vlm";
import type { FunctionalTarget } from "@/types";
import type { MemoryCandidate } from "@/types/memory";
import { pickReplyLanguageText, type ReplyLanguageMode } from "@/services/config/reply-language";
import { getDelegatedTaskConfig, type DelegatedTaskProfileConfig } from "./delegated-task-config";

const log = createLogger("delegated-task-runner");
const LONG_SEQUENCE_UNCHANGED_THRESHOLD = 0.0025;
const LONG_SEQUENCE_UNCHANGED_SAMPLE_SIZE = 72;
const LONG_SEQUENCE_UNCHANGED_CROP_SCALE = 0.6;

interface DelegatedTaskAction {
	tool: string;
	args: Record<string, unknown>;
}

interface CapturedTargetSnapshot {
	dataUrl: string;
	width: number;
	height: number;
}

function inferDelegationReplyLanguageMode(taskText: string): ReplyLanguageMode {
	const hasCjk = /[\u3400-\u9fff]/u.test(taskText);
	const hasLatinWord = /[A-Za-z]{2,}/u.test(taskText);
	if (hasLatinWord && !hasCjk) {
		return "en";
	}
	if (hasCjk) {
		return "zh";
	}
	return pickReplyLanguageText("zh", "en") as ReplyLanguageMode;
}

type BoardObservationConfidence = "high" | "medium" | "low";

interface BoardObservation {
	boardGrid: string;
	entities: string[];
	confidence: BoardObservationConfidence;
	ambiguities: string[];
	source: "cloud" | "none";
	originalWidth: number;
	originalHeight: number;
	processedWidth: number;
	processedHeight: number;
	preprocessed: boolean;
}

interface LocatorCoordinateDecision {
	x: number;
	y: number;
	xNorm: number;
	yNorm: number;
	confidence: number;
	reason: string;
	tier: "rule" | "cloud" | "local";
}

type MissionTaskMode = "browser" | "game" | "generic";

interface MissionAnalysisDecision {
	taskMode: MissionTaskMode;
	missionGoal: string;
	initialStateSummary: string;
	initialStateSketch: string;
	hardConstraints: string[];
	subtaskChain: string[];
	completionSignals: string[];
	candidateStrategies: string[];
	strategyWarnings: string[];
	analysisReply: string;
	ackReply: string;
	reply: string;
}

interface OperationsPlannerDecision {
	goalReached: boolean;
	reasoning: string;
	reply: string;
	expectedOutcome: string;
	stateSketch: string;
	currentPhaseGoal: string;
	whyThisPhase: string;
	abortCondition: string;
	activeStrategy: string;
	strategyRevision: string;
	routeSelfCheck?: string;
	committedRoute?: string;
	currentRouteStep?: string;
	routeRisks?: string[];
	actions: DelegatedTaskAction[];
}

interface ProgressEvaluatorDecision {
	actionSucceeded: boolean;
	wasActionCorrect: boolean;
	expectedMet: boolean;
	expectationReview: string;
	goalAlignment: "closer" | "unchanged" | "deviated" | "achieved";
	goalProgress: "none" | "partial" | "done";
	reply: string;
	nextHint: string;
	beforeStateSketch: string;
	afterStateSketch: string;
	stateDelta: string;
	phaseStatus: "advanced" | "stalled" | "blocked" | "completed";
	phaseAssessment: string;
	planViability: "strengthened" | "unchanged" | "weakened" | "invalidated";
	planAssessment: string;
	routeStateUpdate?: string;
	latestDiagnosis?: string;
}

interface DelegationRouteState {
	currentBoard: string;
	canonicalInitialBoard?: string;
	canonicalTopology?: string;
	topologyLocked?: boolean;
	latestRawBoard?: string;
	boardObservationWarnings?: string[];
	routeHypotheses: string[];
	committedRoute: string;
	currentRouteStep: string;
	routeRisks: string[];
	invalidatedRouteLessons: string[];
	latestDiagnosis: string;
}

interface DelegatedGameContext {
	gameId: "2048" | "sokoban";
	displayName: string;
	actionIds: string[];
}

interface ExecutableActionPlan {
	primary: DelegatedTaskAction;
	followUps: DelegatedTaskAction[];
	actionForEvaluation: DelegatedTaskAction;
}

export interface DelegationScratchpadRuntime {
	append: (relativePath: string, text: string, options?: { append?: boolean }) => Promise<void> | void;
	read?: (relativePath: string, maxChars?: number) => Promise<string>;
}

interface ActionOutcomeRecord {
	signature: string;
	actionSucceeded: boolean;
	wasActionCorrect: boolean;
	goalAlignment: "closer" | "unchanged" | "deviated" | "achieved";
	goalProgress: "none" | "partial" | "done";
	madeProgress: boolean;
}

export interface DelegatedTaskRunnerResult {
	status: "completed" | "stopped" | "failed";
	rounds: number;
	summary: string;
	timeline: import("@/types/unified").DelegationTimeline;
}

export async function runDelegatedTaskLoop(input: {
	taskText: string;
	target: FunctionalTarget;
	orchestrator: OrchestratorService;
	profileId?: string;
	traceId?: string;
	shouldStop: () => boolean;
	onAssistantReply?: (reply: string, source: "planner" | "reflection") => Promise<void> | void;
	onTimelineUpdate?: (timeline: import("@/types/unified").DelegationTimeline) => Promise<void> | void;
	scratchpad?: DelegationScratchpadRuntime | null;
	recallMemoryCandidates?: (query: string) => Promise<MemoryCandidate[]>;
}): Promise<DelegatedTaskRunnerResult> {
	const candidateGameContext = resolveGameContext(input.target.title);
	const baseConfig = getDelegatedTaskConfig(input.profileId);
	const config = mergeDelegatedConfigForGame(baseConfig, candidateGameContext);
	const replyLanguageMode = inferDelegationReplyLanguageMode(input.taskText);
	const history: string[] = [];
	const plannerNotes: string[] = [];
	const evaluatorNotes: string[] = [];
	const recentActionOutcomes: ActionOutcomeRecord[] = [];
	const timelineRounds: import("@/types/unified").DelegationRoundEntry[] = [];
	let latestHint = "";
	let latestExpectedOutcome = "";
	let latestExpectedMet: boolean | null = null;
	let latestPhaseGoal = "";
	let latestPhaseReason = "";
	let latestPhaseAbortCondition = "";
	let latestPhaseStatus: ProgressEvaluatorDecision["phaseStatus"] | "" = "";
	let latestPhaseAssessment = "";
	let latestActiveStrategy = "";
	let latestStrategyRevision = "";
	let latestPlanViability: ProgressEvaluatorDecision["planViability"] | "" = "";
	let latestPlanAssessment = "";
	const invalidatedStrategies: string[] = [];
	let routeState: DelegationRouteState | null = null;
	let noActionStreak = 0;
	let hasExecutionEvidence = false;
	const strategyLessons: string[] = [];
	const longSequenceMode = config.longSequence.enabled && candidateGameContext?.gameId === "sokoban";
	let pendingLongSequenceRecoveryReason = "";
	const runtimeToolNames = await resolveRuntimeToolNames(input.traceId);
	const missionProbeTools = buildAllowedTools(config.allowedTools, candidateGameContext, runtimeToolNames);
	const missionSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
	const preMissionObservation = candidateGameContext && !longSequenceMode
		? await captureInitialBoardObservation(
			missionSnapshot,
			input.target,
			buildPreMissionForObservation(input.taskText),
			config,
			candidateGameContext,
		)
		: emptyBoardObservation(missionSnapshot);
	const missionRaw = await requestMissionAnalystDecision({
		config,
		taskText: input.taskText,
		target: input.target,
		allowedTools: missionProbeTools,
		candidateGameContext,
		snapshot: missionSnapshot,
		boardObservation: preMissionObservation,
		replyLanguageMode,
	});
	const mission = normalizeMissionAnalysisDecision(missionRaw, input.taskText, input.target);
	const gameContext = resolveOperationalGameContext(candidateGameContext, mission.taskMode, input.taskText);
	const allowedTools = buildAllowedTools(config.allowedTools, gameContext, runtimeToolNames);
	const initialCanonicalBoard = longSequenceMode ? null : buildInitialCanonicalBoard(gameContext, mission, preMissionObservation);
	routeState = gameContext
		? {
			currentBoard: initialCanonicalBoard?.currentBoard || preMissionObservation.boardGrid || mission.initialStateSketch,
			canonicalInitialBoard: initialCanonicalBoard?.currentBoard,
			canonicalTopology: initialCanonicalBoard?.topology,
			topologyLocked: Boolean(initialCanonicalBoard?.topology),
			latestRawBoard: preMissionObservation.boardGrid,
			boardObservationWarnings: initialCanonicalBoard?.warnings ?? [],
			routeHypotheses: [...mission.candidateStrategies],
			committedRoute: "",
			currentRouteStep: "",
			routeRisks: [...mission.strategyWarnings],
			invalidatedRouteLessons: [],
			latestDiagnosis: "",
		}
		: null;

	log.info("delegated mission analyst", {
		taskText: input.taskText,
		profileId: input.profileId ?? "default",
		target: input.target.title,
		taskMode: mission.taskMode,
		missionGoal: mission.missionGoal.slice(0, 200),
		hardConstraints: mission.hardConstraints,
		subtaskChain: mission.subtaskChain,
		completionSignals: mission.completionSignals,
		legacyPlannerGoalReached: false,
	});
	log.info("delegated task context", {
		taskText: input.taskText,
		profileId: input.profileId ?? "default",
		target: input.target.title,
		candidateGameContext: candidateGameContext?.gameId ?? null,
		gameContext: gameContext?.gameId ?? null,
		longSequenceMode,
		longSequenceMaxActions: config.longSequence.maxActions,
		longSequenceMinActions: config.longSequence.minActions,
		longSequenceStepWaitMs: config.longSequence.stepWaitMs,
		replyLanguageMode,
		allowedTools,
	});
	const missionAckReply = resolveMissionAckReply(mission, input.taskText, replyLanguageMode);
	if (missionAckReply) {
		await input.onAssistantReply?.(missionAckReply, "reflection");
	}
	await persistScratchpadText(
		input.scratchpad,
		"roles/analyst.md",
		buildAnalystScratchpadEntry({
			taskText: input.taskText,
			target: input.target,
			mission,
		}),
	);
	await persistScratchpadText(
		input.scratchpad,
		"shared/mission.json",
		`${JSON.stringify({
			taskText: input.taskText,
			target: input.target.title,
			missionGoal: mission.missionGoal,
			initialStateSummary: mission.initialStateSummary,
			hardConstraints: mission.hardConstraints,
			subtaskChain: mission.subtaskChain,
			completionSignals: mission.completionSignals,
			candidateStrategies: mission.candidateStrategies,
			strategyWarnings: mission.strategyWarnings,
			routeState,
		}, null, 2)}\n`,
		{ append: false },
	);
	await persistRouteState(input.scratchpad, routeState);

	let memoryRecallSummary = "";
	if (input.recallMemoryCandidates) {
		const recallQuery = buildMemoryRecallQuery(input.taskText, mission);
		try {
			const candidates = await recallWithTimeout(input.recallMemoryCandidates, recallQuery, 2_500);
			if (candidates.length > 0) {
				log.info("delegation memory recall completed", {
					count: candidates.length,
					queryPreview: recallQuery.slice(0, 120),
				});
				memoryRecallSummary = formatMemoryRecallSummary(candidates);
				await persistScratchpadText(
					input.scratchpad,
					"memory-recall.md",
					`# 历史记忆召回\n${memoryRecallSummary}\n`,
					{ append: false },
				);
			}
		} catch (error) {
			log.warn("delegation memory recall failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const buildTimeline = (): import("@/types/unified").DelegationTimeline => ({
		taskText: input.taskText,
		missionGoal: mission.missionGoal,
		rounds: timelineRounds,
	});
	const emitTimelineUpdate = async () => {
		await input.onTimelineUpdate?.(buildTimeline());
	};

	await emitTimelineUpdate();

	let roundBoardObservation = emptyBoardObservation(missionSnapshot);

	for (let round = 1; round <= config.maxRounds; round += 1) {
		if (input.shouldStop()) {
			return {
				status: "stopped",
				rounds: round - 1,
				summary: pickReplyLanguageText("任务被手动停止。", "Task was stopped manually."),
				timeline: buildTimeline(),
			};
		}

		if (longSequenceMode && pendingLongSequenceRecoveryReason) {
			const recovery = await executeLongSequenceRecoveryReset({
				orchestrator: input.orchestrator,
				target: input.target,
				config,
				mission,
				reason: pendingLongSequenceRecoveryReason,
				round,
				traceId: input.traceId,
			});
			pendingLongSequenceRecoveryReason = "";
			if (!recovery.succeeded) {
				const summary = pickReplyLanguageText(
					`长序列失败后需要重开，但自动点击重置失败：${recovery.error || "重置后画面没有变化"}`,
					`Long-sequence recovery required a restart, but automatic reset failed: ${recovery.error || "no visible change after reset"}`,
				);
				log.warn("long sequence recovery reset failed", {
					round,
					error: recovery.error,
					changeScore: recovery.changeScore,
				});
				return {
					status: "failed",
					rounds: round - 1,
					summary,
					timeline: buildTimeline(),
				};
			}
			latestHint = combineHints(
				latestHint,
				pickReplyLanguageText(
					"系统已强制重开本关；保留上一条失败经验，但下一轮必须从初始局面重新生成完整长序列。",
					"The runner has restarted the level; keep the previous failure lesson, but the next planner turn must generate a fresh full long sequence from the initial board.",
				),
			);
			latestExpectedOutcome = "";
			latestExpectedMet = null;
			latestPhaseGoal = "";
			latestPhaseReason = "";
			latestPhaseAbortCondition = "";
			latestPhaseStatus = "";
			latestPhaseAssessment = "";
			latestActiveStrategy = "";
			latestStrategyRevision = "";
			latestPlanViability = "";
			latestPlanAssessment = "";
			routeState = resetRouteStateAfterLongSequenceRecovery(routeState);
			await persistRouteState(input.scratchpad, routeState);
			await sleep(config.afterActionWaitMs);
		}

		const currentSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
		log.info("[diag] boardPerceptionPrompt configured", {
			hasPrompt: Boolean(config.boardPerceptionPrompt),
			promptLength: config.boardPerceptionPrompt?.length ?? 0,
			promptPreview: config.boardPerceptionPrompt?.slice(0, 120) ?? "(empty)",
		});
		const rawRoundBoardObservation = longSequenceMode
			? emptyBoardObservation(currentSnapshot)
			: await captureBoardObservation(
				currentSnapshot,
				input.target,
				mission,
				config,
			);
		roundBoardObservation = reconcileBoardObservationWithRouteState(
			routeState,
			rawRoundBoardObservation,
			gameContext,
		);
		routeState = updateRouteStateFromObservation(
			routeState,
			roundBoardObservation,
			rawRoundBoardObservation,
		);
		const sharedScratchpadContext = buildSharedScratchpadContext({
			taskText: input.taskText,
			mission,
			memoryRecallSummary,
			latestHint,
			latestExpectedOutcome,
			latestExpectedMet,
			latestPhaseGoal,
			latestPhaseReason,
			latestPhaseAbortCondition,
			latestPhaseStatus,
			latestPhaseAssessment,
			latestActiveStrategy,
			latestStrategyRevision,
			latestPlanViability,
			latestPlanAssessment,
			invalidatedStrategies,
			strategyLessons,
			routeState,
			history,
			plannerNotes,
			evaluatorNotes,
		});
		const plannerSystemPrompt = buildOperationsPlannerSystemPrompt({
			allowedTools,
			maxActionsPerRound: longSequenceMode ? config.longSequence.maxActions : config.maxActionsPerRound,
			minActionsPerRound: longSequenceMode ? config.longSequence.minActions : 1,
			rules: config.operationsPlannerRules,
			gameContext,
			mission,
			longSequenceMode,
		});
		let plannerPolicyReminder = "";
		let plannerRetryCount = 0;
		const maxPlannerRetries = longSequenceMode ? 3 : 1;
		let planner: OperationsPlannerDecision = {
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
			routeRisks: [] as string[],
			actions: [] as DelegatedTaskAction[],
		};
		while (plannerRetryCount <= maxPlannerRetries) {
			const plannerUserPrompt = buildOperationsPlannerUserPrompt({
					taskText: input.taskText,
					round,
					maxRounds: config.maxRounds,
					target: input.target,
					history,
					latestHint,
					mission,
					gameContext,
					allowedTools,
					scratchpadContext: sharedScratchpadContext,
					plannerPolicyReminder,
					previousExpectedOutcome: latestExpectedOutcome,
					previousExpectedMet: latestExpectedMet,
					latestPhaseGoal,
					latestPhaseReason,
					latestPhaseAbortCondition,
					latestPhaseStatus,
					latestPhaseAssessment,
					latestActiveStrategy,
					latestStrategyRevision,
					latestPlanViability,
					latestPlanAssessment,
					invalidatedStrategies,
					strategyLessons,
				boardPositionsText: longSequenceMode ? undefined : formatBoardObservationForPlanner(roundBoardObservation) || undefined,
				longSequenceMode,
				longSequenceMaxActions: config.longSequence.maxActions,
				longSequenceMinActions: config.longSequence.minActions,
			});
			const plannerSnapshot = longSequenceMode
				? await preprocessSnapshotForRoleVision(currentSnapshot, config)
				: currentSnapshot;
			const plannerMaxTokens = longSequenceMode ? 6000 : undefined;
			const plannerRaw = await requestPlannerDecision({
				config,
				systemPrompt: plannerSystemPrompt,
				userPrompt: plannerUserPrompt,
				snapshot: plannerSnapshot,
				boardObservation: roundBoardObservation,
				taskKind: gameContext?.gameId ?? mission.taskMode,
				forceVision: longSequenceMode,
				maxTokens: plannerMaxTokens,
				replyLanguageMode,
			});
			log.info("delegated operations planner raw action count", {
				round,
				rawActionCount: countRawPlannerActions(plannerRaw),
				rawActionIds: extractRawPlannerActionIds(plannerRaw).slice(0, 30),
				normalizedActionLimit: longSequenceMode ? config.longSequence.maxActions : config.maxActionsPerRound,
				longSequenceMode,
			});
			const nextPlanner = normalizeOperationsPlannerDecision(
				plannerRaw,
				allowedTools,
				longSequenceMode ? config.longSequence.maxActions : config.maxActionsPerRound,
				input.target,
				gameContext,
			);
			const invalidatedStrategyIssue = detectInvalidatedStrategyReuse(nextPlanner.activeStrategy, invalidatedStrategies);
			const longSequenceIssue = longSequenceMode
				? detectLongSequencePlannerIssue({
					actions: nextPlanner.actions,
					minActions: config.longSequence.minActions,
					round,
					maxActions: config.longSequence.maxActions,
				})
				: "";
			const policyIssue = invalidatedStrategyIssue || longSequenceIssue || detectPlannerPolicyIssue({
				goalReached: nextPlanner.goalReached,
				expectedOutcome: nextPlanner.expectedOutcome,
				actions: nextPlanner.actions,
				latestHint,
				recentActionOutcomes,
			});
			planner = nextPlanner;
			if (!policyIssue || plannerRetryCount >= maxPlannerRetries) {
				if (policyIssue) {
					log.warn("planner policy issue persisted after retry", {
						round,
						policyIssue,
						actionCount: nextPlanner.actions.length,
						reasoning: nextPlanner.reasoning.slice(0, 180),
					});
				}
				break;
			}
			plannerPolicyReminder = policyIssue;
			plannerRetryCount += 1;
			log.warn("planner policy issue detected; forcing replanning", {
				round,
				policyIssue,
				actionCount: nextPlanner.actions.length,
				reasoning: nextPlanner.reasoning.slice(0, 180),
			});
		}
		const effectivePlannerActions = planner.actions;
		noActionStreak = effectivePlannerActions.length ? 0 : noActionStreak + 1;
		const tooShortLongSequenceIssue = longSequenceMode
			? detectLongSequencePlannerIssue({
				actions: effectivePlannerActions,
				minActions: config.longSequence.minActions,
				round,
				maxActions: config.longSequence.maxActions,
			})
			: "";
		if (tooShortLongSequenceIssue) {
			log.warn("long sequence planner remained too short after retries; executing available prefix", {
				round,
				actionCount: effectivePlannerActions.length,
				minActions: config.longSequence.minActions,
				issue: tooShortLongSequenceIssue,
			});
			plannerPolicyReminder = combineHints(plannerPolicyReminder, tooShortLongSequenceIssue);
		}
		const plannerNote = formatPlannerScratchpadNote({
			round,
			planner,
			effectiveActions: effectivePlannerActions,
			noActionStreak,
			policyReminder: plannerPolicyReminder,
			retryCount: plannerRetryCount,
			previousExpectedOutcome: latestExpectedOutcome,
			previousExpectedMet: latestExpectedMet,
		});
		pushScratchpadNote(plannerNotes, plannerNote, 6);
		latestPhaseGoal = planner.currentPhaseGoal || latestPhaseGoal;
		latestPhaseReason = planner.whyThisPhase || latestPhaseReason;
		latestPhaseAbortCondition = planner.abortCondition || latestPhaseAbortCondition;
		latestActiveStrategy = planner.activeStrategy || latestActiveStrategy;
		latestStrategyRevision = planner.strategyRevision || latestStrategyRevision;
		routeState = updateRouteStateFromPlanner(routeState, planner, roundBoardObservation);
		await persistScratchpadText(input.scratchpad, "roles/planner.md", `${plannerNote}\n`);
		await persistRouteState(input.scratchpad, routeState);
		await persistScratchpadText(
			input.scratchpad,
			"shared/context.md",
			`${buildSharedScratchpadContext({
				taskText: input.taskText,
				mission,
				memoryRecallSummary,
				latestHint,
				latestExpectedOutcome,
				latestExpectedMet,
				latestPhaseGoal,
				latestPhaseReason,
				latestPhaseAbortCondition,
				latestPhaseStatus,
				latestPhaseAssessment,
				latestActiveStrategy,
				latestStrategyRevision,
				latestPlanViability,
				latestPlanAssessment,
				invalidatedStrategies,
				strategyLessons,
				routeState,
				history,
				plannerNotes,
				evaluatorNotes,
			})}\n`,
			{ append: false },
		);
		log.info("delegated operations planner", {
			round,
			goalReached: planner.goalReached,
			actionCount: planner.actions.length,
			effectiveActionCount: effectivePlannerActions.length,
			retryCount: plannerRetryCount,
			policyReminder: plannerPolicyReminder || null,
			reasoning: planner.reasoning.slice(0, 200),
			expectedOutcome: planner.expectedOutcome.slice(0, 120),
			legacyPlannerGoalReached: planner.goalReached,
		});

		const canPlannerFinish = planner.goalReached && hasExecutionEvidence;
		if (planner.goalReached && !canPlannerFinish) {
			log.warn("planner goalReached ignored due missing execution evidence", {
				round,
				historySize: history.length,
				reasoning: planner.reasoning.slice(0, 160),
			});
		}

		const plannerView: OperationsPlannerDecision = {
			...planner,
			actions: effectivePlannerActions,
		};
		const plannerReply = resolveOperationsNarration(plannerView, canPlannerFinish);
		if (plannerReply) {
			await input.onAssistantReply?.(plannerReply, "planner");
		}
		if (canPlannerFinish) {
			return {
				status: "completed",
				rounds: round,
				summary: planner.reasoning || pickReplyLanguageText("规划器判定任务已完成。", "Planner determined the task is complete."),
				timeline: buildTimeline(),
			};
		}
		if (!effectivePlannerActions.length) {
			history.push(`round ${round}: no action generated`);
			if (history.length > 6) {
				history.splice(0, history.length - 6);
			}
			latestHint = plannerPolicyReminder || pickReplyLanguageText("上一轮没有产出可执行动作。下一轮必须给出一个单步工具动作。", "No executable action was produced last round. Next round must provide a single-step tool action.");
			await persistScratchpadText(
				input.scratchpad,
				"shared/context.md",
				`${buildSharedScratchpadContext({
					taskText: input.taskText,
					mission,
					memoryRecallSummary,
					latestHint,
					latestExpectedOutcome,
					latestExpectedMet,
					latestPhaseGoal,
					latestPhaseReason,
					latestPhaseAbortCondition,
					latestPhaseStatus,
					latestPhaseAssessment,
					latestActiveStrategy,
					latestStrategyRevision,
					latestPlanViability,
					latestPlanAssessment,
					invalidatedStrategies,
					strategyLessons,
					routeState,
					history,
					plannerNotes,
					evaluatorNotes,
				})}\n`,
				{ append: false },
			);
			continue;
		}

		if (config.plannerSpeechLeadMs > 0) {
			await sleep(config.plannerSpeechLeadMs);
		}

		const batchBeforeSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
		const executedActions: { plan: ExecutableActionPlan; error: string }[] = [];
		let batchAfterSnapshot = batchBeforeSnapshot;
		let batchExecutionError = "";
		let longSequenceFailureDetail = "";

		for (let actionIndex = 0; actionIndex < effectivePlannerActions.length; actionIndex += 1) {
			const action = effectivePlannerActions[actionIndex];
			if (input.shouldStop()) {
				return {
					status: "stopped",
					rounds: round,
					summary: pickReplyLanguageText("任务在动作执行前被停止。", "Task was stopped before action execution."),
					timeline: buildTimeline(),
				};
			}

			const beforeSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
			const resolvedAction = await resolveActionWithLocator({
				action,
				config,
				target: input.target,
				mission,
				beforeSnapshot,
				round,
			});
			const executionPlan = buildExecutableActionPlan(resolvedAction, input.target);
			let actionExecutionError = "";
			try {
				await callLocalMcpTool(executionPlan.primary.tool, executionPlan.primary.args, {
					timeoutMs: 45_000,
					traceId: input.traceId,
				});
				for (const followUpAction of executionPlan.followUps) {
					await callLocalMcpTool(followUpAction.tool, followUpAction.args, {
						timeoutMs: 45_000,
						traceId: input.traceId,
					});
				}
			} catch (error) {
				actionExecutionError = error instanceof Error ? error.message : String(error);
				log.warn("delegated action execution failed", {
					round,
					tool: executionPlan.actionForEvaluation.tool,
					error: actionExecutionError,
				});
			}
			batchAfterSnapshot = await capturePostActionSnapshot({
				orchestrator: input.orchestrator,
				target: input.target,
				beforeSnapshot,
				baseWaitMs: longSequenceMode ? config.longSequence.stepWaitMs : config.afterActionWaitMs,
			});
			executedActions.push({ plan: executionPlan, error: actionExecutionError });
			if (actionExecutionError) {
				batchExecutionError = actionExecutionError;
				break;
			}
			const snapshotChange = longSequenceMode
				? await assessSnapshotChange(
					await preprocessSnapshotForRoleVision(beforeSnapshot, config),
					await preprocessSnapshotForRoleVision(batchAfterSnapshot, config),
				)
				: null;
			if (snapshotChange) {
				log.info("long sequence step snapshot change", {
					round,
					stepIndex: actionIndex + 1,
					totalActions: effectivePlannerActions.length,
					action: executionPlan.actionForEvaluation,
					changeScore: snapshotChange.score,
					threshold: LONG_SEQUENCE_UNCHANGED_THRESHOLD,
					unchanged: snapshotChange.unchanged,
					reason: snapshotChange.reason,
				});
			}
			if (longSequenceMode && config.longSequence.stopOnUnchangedSnapshot && snapshotChange?.unchanged) {
				const failedStepIndex = actionIndex + 1;
				const remainingActions = effectivePlannerActions.length - failedStepIndex;
				longSequenceFailureDetail = [
					`Long sequence stopped at step ${failedStepIndex}/${effectivePlannerActions.length}: board screenshot did not meaningfully change after ${config.longSequence.stepWaitMs}ms.`,
					`changeScore=${snapshotChange.score === null ? "unknown" : snapshotChange.score.toFixed(6)} threshold=${LONG_SEQUENCE_UNCHANGED_THRESHOLD}`,
					`failedAction=${executionPlan.actionForEvaluation.tool}(${JSON.stringify(executionPlan.actionForEvaluation.args)})`,
					`executedPrefix=${executedActions.map((item) => item.plan.actionForEvaluation.tool + "(" + JSON.stringify(item.plan.actionForEvaluation.args) + ")").join(" -> ")}`,
					`remainingActions=${remainingActions}`,
					"Runner will restart the level before the next planner turn; the next planner must generate a fresh full long-sequence route from the clean initial board.",
				].join(" ");
				batchExecutionError = longSequenceFailureDetail;
				log.warn("long sequence stopped on unchanged snapshot", {
					round,
					failedStepIndex,
					totalActions: effectivePlannerActions.length,
					remainingActions,
					action: executionPlan.actionForEvaluation,
					changeScore: snapshotChange.score,
					threshold: LONG_SEQUENCE_UNCHANGED_THRESHOLD,
					reason: snapshotChange.reason,
				});
				break;
			}
			// 0.5s gap before the next action in a multi-action batch
			const hasNextAction = actionIndex < effectivePlannerActions.length - 1;
			if (hasNextAction && !longSequenceMode) {
				await sleep(500);
			}
		}

		const rawAfterBoardObservation = longSequenceMode
			? emptyBoardObservation(batchAfterSnapshot)
			: await captureBoardObservation(
				batchAfterSnapshot,
				input.target,
				mission,
				config,
			);
		const afterBoardObservation = reconcileBoardObservationWithRouteState(
			routeState,
			rawAfterBoardObservation,
			gameContext,
		);
		const batchActionSummary = executedActions
			.map((item) => `${item.plan.actionForEvaluation.tool}(${JSON.stringify(item.plan.actionForEvaluation.args)})`)
			.join(" -> ");
		const lastExecutedAction = executedActions[executedActions.length - 1]?.plan.actionForEvaluation
			?? effectivePlannerActions[0];

		const evaluatorSystemPrompt = buildProgressEvaluatorSystemPrompt(config.progressEvaluatorRules, mission);
		const evaluatorUserPrompt = buildProgressEvaluatorUserPrompt({
				taskText: input.taskText,
				round,
				target: input.target,
				action: lastExecutedAction,
				mission,
				history,
				expectedOutcome: planner.expectedOutcome,
				executionError: longSequenceFailureDetail || batchExecutionError,
				scratchpadContext: buildSharedScratchpadContext({
					taskText: input.taskText,
					mission,
					memoryRecallSummary,
					latestHint,
					latestExpectedOutcome,
					latestExpectedMet,
					latestPhaseGoal,
					latestPhaseReason,
					latestPhaseAbortCondition,
					latestPhaseStatus,
					latestPhaseAssessment,
					latestActiveStrategy,
					latestStrategyRevision,
					latestPlanViability,
					latestPlanAssessment,
					invalidatedStrategies,
					strategyLessons,
					routeState,
					history,
					plannerNotes,
					evaluatorNotes,
				}),
				batchActionSummary: executedActions.length > 1 ? batchActionSummary : undefined,
				phaseGoal: planner.currentPhaseGoal,
				phaseReason: planner.whyThisPhase,
				phaseAbortCondition: planner.abortCondition,
				activeStrategy: planner.activeStrategy,
				boardPositionsText: longSequenceMode ? undefined : formatBoardObservationForEvaluator(roundBoardObservation, afterBoardObservation) || undefined,
		});
		const evaluatorBeforeSnapshot = longSequenceMode
			? await preprocessSnapshotForRoleVision(batchBeforeSnapshot, config)
			: batchBeforeSnapshot;
		const evaluatorAfterSnapshot = longSequenceMode
			? await preprocessSnapshotForRoleVision(batchAfterSnapshot, config)
			: batchAfterSnapshot;
		const reflectionRaw = await requestEvaluatorDecision({
			config,
			systemPrompt: evaluatorSystemPrompt,
			userPrompt: evaluatorUserPrompt,
			beforeSnapshot: evaluatorBeforeSnapshot,
			afterSnapshot: evaluatorAfterSnapshot,
			beforeObservation: roundBoardObservation,
			afterObservation: afterBoardObservation,
			taskKind: gameContext?.gameId ?? mission.taskMode,
			forceVision: longSequenceMode,
			replyLanguageMode,
		});
		let reflection = normalizeProgressEvaluatorDecision(reflectionRaw);
		reflection = applyBoardTaskConsistencyGuard(reflection, gameContext);
		reflection = applyBoardTaskProgressGuard(reflection, gameContext);
		reflection = applyPhasePlanProgressGuard(reflection, gameContext);
		reflection = applyMissionCompletionGuard(reflection, gameContext);
		reflection = applySokobanDeadlockGuard(reflection, gameContext);
		reflection = applySokobanPushTargetDirectionGuard(reflection, gameContext, lastExecutedAction, planner);
		reflection = applySokobanPushIntentOutcomeGuard(reflection, gameContext, lastExecutedAction, planner);
		reflection = applyEvaluatorHierarchyGuard(reflection, gameContext);
		if (batchExecutionError) {
			reflection = {
				...reflection,
				actionSucceeded: false,
				wasActionCorrect: false,
				expectedMet: false,
				goalAlignment: reflection.goalAlignment === "achieved" ? "deviated" : reflection.goalAlignment,
				goalProgress: reflection.goalProgress === "done" ? "none" : reflection.goalProgress,
				phaseStatus: "blocked",
				beforeStateSketch: reflection.beforeStateSketch || "",
				afterStateSketch: reflection.afterStateSketch || "",
				stateDelta: reflection.stateDelta || "",
					nextHint: combineHints(
						reflection.nextHint,
						longSequenceMode
							? pickReplyLanguageText(
								`长序列执行中断：${batchExecutionError}。下一轮必须从当前截图重新生成完整长序列，不要只给单步纠偏。`,
								`Long sequence interrupted: ${batchExecutionError}. Next round must rebuild a full long-sequence route from the current screenshot, not a single corrective move.`,
							)
							: pickReplyLanguageText(
								`动作执行报错：${batchExecutionError}。下一轮先修正动作参数或先做聚焦/定位校准。`,
								`Action execution error: ${batchExecutionError}. Next round, fix the action parameters or redo focus/locator calibration.`,
							),
					),
				};
			}
		log.info("delegated progress evaluator", {
			round,
			batchSize: executedActions.length,
			tool: lastExecutedAction.tool,
			actionSucceeded: reflection.actionSucceeded,
			wasActionCorrect: reflection.wasActionCorrect,
			expectedMet: reflection.expectedMet,
			goalAlignment: reflection.goalAlignment,
			goalProgress: reflection.goalProgress,
			phaseStatus: reflection.phaseStatus,
		});
		const reflectionReply = normalizeDelegatedCompanionReply(reflection.reply, "reflection", replyLanguageMode);
		if (reflectionReply) {
			await input.onAssistantReply?.(reflectionReply, "reflection");
		}

		const actionSignature = buildActionSignature(lastExecutedAction);
		pushActionOutcome(recentActionOutcomes, {
			signature: actionSignature,
			actionSucceeded: reflection.actionSucceeded,
			wasActionCorrect: reflection.wasActionCorrect,
			goalAlignment: reflection.goalAlignment,
			goalProgress: reflection.goalProgress,
			madeProgress: didBoardTaskMakeProgress(reflection),
		});
		const strategyLesson = buildStrategyLesson({
			planner,
			reflection,
		});
		pushStrategyLesson(strategyLessons, strategyLesson, 4);
		if (shouldInvalidateStrategy(planner, reflection, gameContext)) {
			pushInvalidatedStrategy(invalidatedStrategies, planner.activeStrategy);
		}
		const repeatedFailureHint = buildRepeatedFailureHint(recentActionOutcomes);
		const boardStagnationHint = buildBoardStagnationHint(gameContext, recentActionOutcomes);
		if (repeatedFailureHint && !didBoardTaskMakeProgress(reflection)) {
			reflection = {
				...reflection,
				wasActionCorrect: false,
				expectedMet: false,
				goalAlignment: "deviated",
				phaseStatus: "blocked",
				beforeStateSketch: reflection.beforeStateSketch || "",
				afterStateSketch: reflection.afterStateSketch || "",
				stateDelta: reflection.stateDelta || "",
			};
			const lastOutcome = recentActionOutcomes[recentActionOutcomes.length - 1];
			if (lastOutcome) {
				lastOutcome.wasActionCorrect = false;
				lastOutcome.goalAlignment = "deviated";
				lastOutcome.madeProgress = false;
			}
		}
		if (boardStagnationHint && !didBoardTaskMakeProgress(reflection)) {
			reflection = {
				...reflection,
				actionSucceeded: false,
				wasActionCorrect: false,
				expectedMet: false,
				goalAlignment: "deviated",
				goalProgress: "none",
				phaseStatus: "stalled",
			};
		}
		latestHint = combineHints(reflection.nextHint, repeatedFailureHint);
		latestHint = combineHints(latestHint, boardStagnationHint);
		latestExpectedOutcome = planner.expectedOutcome;
		latestExpectedMet = reflection.expectedMet;
		latestPhaseGoal = planner.currentPhaseGoal || latestPhaseGoal;
		latestPhaseReason = planner.whyThisPhase || latestPhaseReason;
		latestPhaseAbortCondition = planner.abortCondition || latestPhaseAbortCondition;
		latestPhaseStatus = reflection.phaseStatus;
		latestPhaseAssessment = reflection.phaseAssessment || latestPhaseAssessment;
		latestActiveStrategy = planner.activeStrategy || latestActiveStrategy;
		latestStrategyRevision = planner.strategyRevision || latestStrategyRevision;
		latestPlanViability = reflection.planViability;
		latestPlanAssessment = reflection.planAssessment || latestPlanAssessment;
		if (shouldInvalidateStrategy(planner, reflection, gameContext)) {
			latestHint = combineHints(
				latestHint,
				pickReplyLanguageText(
					"上一条高层路线已被否决；不要继续沿用它。若当前局面不可恢复，请重开后从其余候选路线中重选。",
					"The previous high-level route has been invalidated; do not keep following it. If the current board is unrecoverable, restart and choose a different remaining route.",
				),
			);
			latestActiveStrategy = "";
			latestStrategyRevision = pickReplyLanguageText(
				"上一条高层路线已被证明错误，下一轮必须改用未被否决的候选路线。",
				"The previous high-level strategy has been disproven. Next round must choose a different non-invalidated route.",
			);
			latestPhaseGoal = "";
			latestPhaseReason = "";
			latestPhaseAbortCondition = "";
			latestPhaseStatus = "";
			latestPhaseAssessment = "";
			latestPlanViability = "invalidated";
			latestPlanAssessment = reflection.planAssessment || latestPlanAssessment;
		}
		if (didRestartActionSucceed(lastExecutedAction, reflection)) {
			latestHint = pickReplyLanguageText(
				"棋盘已成功重开。保留失败经验，但不要沿用已否决路线；请从其余候选路线中重新选择，并先验证新的中间态方案。",
				"The board has been successfully restarted. Keep the failure lesson, but do not reuse invalidated routes; choose a different remaining route and validate a new intermediate-state plan first.",
			);
			latestActiveStrategy = "";
			latestStrategyRevision = pickReplyLanguageText(
				"本轮已成功重开；保留失败经验，但必须从未被否决的候选路线中重新选择。",
				"The level was successfully restarted; keep the failure lesson, but reselect a route from the non-invalidated candidates.",
			);
			latestPhaseGoal = "";
			latestPhaseReason = "";
			latestPhaseAbortCondition = "";
			latestPhaseStatus = "";
			latestPhaseAssessment = "";
			latestPlanViability = "";
			latestPlanAssessment = "";
			latestExpectedOutcome = "";
			latestExpectedMet = null;
		}
		const longSequenceRecoveryReason = longSequenceMode && !isBoardMissionCompleted(reflection, planner)
			? detectLongSequenceRecoveryReason({
				executionError: longSequenceFailureDetail || batchExecutionError,
				reflection,
			})
			: "";
		if (longSequenceRecoveryReason) {
			pendingLongSequenceRecoveryReason = longSequenceRecoveryReason;
			latestHint = combineHints(
				latestHint,
				pickReplyLanguageText(
					`长序列尝试失败，下一轮开始前系统会先重开本关。原因：${longSequenceRecoveryReason}`,
					`The long-sequence attempt failed; the runner will restart the level before the next planner turn. Reason: ${longSequenceRecoveryReason}`,
				),
			);
			latestActiveStrategy = "";
			latestPhaseGoal = "";
			latestPhaseReason = "";
			latestPhaseAbortCondition = "";
			latestPlanViability = "invalidated";
			latestPlanAssessment = combineHints(latestPlanAssessment, longSequenceRecoveryReason);
			log.warn("long sequence recovery scheduled", {
				round,
				reason: longSequenceRecoveryReason,
				executionError: longSequenceFailureDetail || batchExecutionError,
				planViability: reflection.planViability,
				phaseStatus: reflection.phaseStatus,
			});
		}
		routeState = updateRouteStateFromEvaluator(routeState, reflection, afterBoardObservation, rawAfterBoardObservation, lastExecutedAction);
		hasExecutionEvidence = true;
		const evaluatorNote = formatEvaluatorScratchpadNote({
			round,
			action: lastExecutedAction,
			expectedOutcome: planner.expectedOutcome,
			reflection,
		});
		pushScratchpadNote(evaluatorNotes, evaluatorNote, 6);
		await persistScratchpadText(input.scratchpad, "roles/evaluator.md", `${evaluatorNote}\n`);
		await persistRouteState(input.scratchpad, routeState);
		history.push(
			`round ${round} [${executedActions.map((a) => a.plan.actionForEvaluation.tool).join("+")}]: strategy=${planner.activeStrategy || "(none)"} phase=${planner.currentPhaseGoal || "(none)"} expected=${planner.expectedOutcome || "(none)"} expectedMet=${reflection.expectedMet} success=${reflection.actionSucceeded} correct=${reflection.wasActionCorrect} alignment=${reflection.goalAlignment} progress=${reflection.goalProgress} phaseStatus=${reflection.phaseStatus} planViability=${reflection.planViability} hint=${latestHint}`,
		);
		timelineRounds.push({
			round,
			timestamp: Date.now(),
			plannerReasoning: planner.reasoning,
			plannerExpectedOutcome: planner.expectedOutcome,
			plannerGoalReached: planner.goalReached,
			committedRoute: routeState?.committedRoute ?? "",
			currentRouteStep: routeState?.currentRouteStep ?? "",
			routeDiagnosis: routeState?.latestDiagnosis ?? "",
			boardGrid: routeState?.currentBoard ?? "",
			actionTool: executedActions.map((a) => a.plan.actionForEvaluation.tool).join("+"),
			actionSummary: batchActionSummary,
			evaluatorSucceeded: reflection.actionSucceeded,
			evaluatorCorrect: reflection.wasActionCorrect,
			evaluatorExpectedMet: reflection.expectedMet,
			evaluatorAlignment: reflection.goalAlignment,
			evaluatorProgress: reflection.goalProgress,
			evaluatorReply: reflection.reply,
			evaluatorHint: latestHint,
		});
		await emitTimelineUpdate();
		if (history.length > 6) {
			history.splice(0, history.length - 6);
		}
		await persistScratchpadText(
			input.scratchpad,
			"shared/context.md",
			`${buildSharedScratchpadContext({
				taskText: input.taskText,
				mission,
				memoryRecallSummary,
				latestHint,
				latestExpectedOutcome,
				latestExpectedMet,
				latestPhaseGoal,
				latestPhaseReason,
				latestPhaseAbortCondition,
				latestPhaseStatus,
				latestPhaseAssessment,
				latestActiveStrategy,
				latestStrategyRevision,
				latestPlanViability,
				latestPlanAssessment,
				invalidatedStrategies,
				strategyLessons,
				routeState,
				history,
				plannerNotes,
				evaluatorNotes,
			})}\n`,
			{ append: false },
		);

		const evaluatorDeclaresDone = reflection.goalProgress === "done" || reflection.goalAlignment === "achieved";
			const plannerAgreesDone = planner.goalReached;
			const strongEvidence = reflection.expectedMet && reflection.actionSucceeded && reflection.wasActionCorrect;
			if (evaluatorDeclaresDone && (plannerAgreesDone || strongEvidence)) {
			return {
				status: "completed",
				rounds: round,
				summary: reflection.nextHint || pickReplyLanguageText("Progress Evaluator 判定任务完成。", "Progress Evaluator judged the task complete."),
				timeline: buildTimeline(),
			};
		}
	}

	return {
		status: "failed",
		rounds: config.maxRounds,
		summary: buildDelegationFailureSummary({
			maxRounds: config.maxRounds,
			latestHint,
			recentActionOutcomes,
		}),
		timeline: buildTimeline(),
	};
}

async function captureTargetSnapshot(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
): Promise<CapturedTargetSnapshot> {
	const record = await orchestrator.runCaptureTask(target);
	const snapshot = record.afterSnapshot ?? record.beforeSnapshot;
	if (!snapshot?.dataUrl) {
		throw new Error("无法获取窗口截图，托管任务中止。");
	}
	return {
		dataUrl: snapshot.dataUrl,
		width: snapshot.width,
		height: snapshot.height,
	};
}

async function capturePostActionSnapshot(input: {
	orchestrator: OrchestratorService;
	target: FunctionalTarget;
	beforeSnapshot: CapturedTargetSnapshot;
	baseWaitMs: number;
}): Promise<CapturedTargetSnapshot> {
	await sleep(input.baseWaitMs);
	let afterSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const assessment = await assessSnapshotChange(input.beforeSnapshot, afterSnapshot);
		if (!assessment.unchanged) {
			return afterSnapshot;
		}
		await sleep(320);
		afterSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
	}
	return afterSnapshot;
}

async function assessSnapshotChange(
	beforeSnapshot: CapturedTargetSnapshot,
	afterSnapshot: CapturedTargetSnapshot,
): Promise<{ unchanged: boolean; score: number | null; reason: string }> {
	if (beforeSnapshot.width !== afterSnapshot.width || beforeSnapshot.height !== afterSnapshot.height) {
		return { unchanged: false, score: 1, reason: "size-changed" };
	}
	if (beforeSnapshot.dataUrl === afterSnapshot.dataUrl) {
		return { unchanged: true, score: 0, reason: "identical-data-url" };
	}
	try {
		const score = await estimateSnapshotChange(
			toPerceptionSnapshot(beforeSnapshot),
			toPerceptionSnapshot(afterSnapshot),
			{
				sampleSize: LONG_SEQUENCE_UNCHANGED_SAMPLE_SIZE,
				cropScale: LONG_SEQUENCE_UNCHANGED_CROP_SCALE,
			},
		);
		return {
			unchanged: classifySnapshotChangeScore(score),
			score,
			reason: "pixel-diff",
		};
	} catch (error) {
		log.warn("snapshot change estimation failed; treating snapshots as changed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { unchanged: false, score: null, reason: "pixel-diff-error" };
	}
}

function classifySnapshotChangeScore(score: number, threshold = LONG_SEQUENCE_UNCHANGED_THRESHOLD): boolean {
	return score <= threshold;
}

function toPerceptionSnapshot(snapshot: CapturedTargetSnapshot) {
	return {
		targetHandle: "",
		targetTitle: "",
		width: snapshot.width,
		height: snapshot.height,
		dataUrl: snapshot.dataUrl,
		capturedAt: Date.now(),
		captureMethod: "delegated-capture",
		qualityScore: 1,
		lowConfidence: false,
	};
}

async function executeLongSequenceRecoveryReset(input: {
	orchestrator: OrchestratorService;
	target: FunctionalTarget;
	config: DelegatedTaskProfileConfig;
	mission: MissionAnalysisDecision;
	reason: string;
	round: number;
	traceId?: string;
}): Promise<{ succeeded: boolean; error: string; changeScore: number | null }> {
	let lastError = "";
	let lastChangeScore: number | null = null;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const beforeSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
		const resetAction = buildLongSequenceResetAction(input.target);
		const resolvedAction = await resolveActionWithLocator({
			action: resetAction,
			config: input.config,
			target: input.target,
			mission: input.mission,
			beforeSnapshot,
			round: input.round,
		});
		const executionPlan = buildExecutableActionPlan(resolvedAction, input.target);
		try {
			log.warn("long sequence recovery reset executing", {
				round: input.round,
				attempt,
				reason: input.reason,
				action: executionPlan.actionForEvaluation,
			});
			await callLocalMcpTool(executionPlan.primary.tool, executionPlan.primary.args, {
				timeoutMs: 45_000,
				traceId: input.traceId,
			});
			for (const followUpAction of executionPlan.followUps) {
				await callLocalMcpTool(followUpAction.tool, followUpAction.args, {
					timeoutMs: 45_000,
					traceId: input.traceId,
				});
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			log.warn("long sequence recovery reset action failed", {
				round: input.round,
				attempt,
				error: lastError,
			});
			continue;
		}
		const afterSnapshot = await capturePostActionSnapshot({
			orchestrator: input.orchestrator,
			target: input.target,
			beforeSnapshot,
			baseWaitMs: Math.max(input.config.afterActionWaitMs, input.config.longSequence.stepWaitMs),
		});
		const change = await assessSnapshotChange(beforeSnapshot, afterSnapshot);
		lastChangeScore = change.score;
		log.info("long sequence recovery reset change", {
			round: input.round,
			attempt,
			changeScore: change.score,
			threshold: LONG_SEQUENCE_UNCHANGED_THRESHOLD,
			unchanged: change.unchanged,
			reason: change.reason,
		});
		if (!change.unchanged) {
			return { succeeded: true, error: "", changeScore: change.score };
		}
		lastError = "reset click produced no meaningful screenshot change";
	}
	return { succeeded: false, error: lastError, changeScore: lastChangeScore };
}

function buildLongSequenceResetAction(target: FunctionalTarget): DelegatedTaskAction {
	return {
		tool: "host.send_mouse",
		args: {
			button: "left",
			targetHandle: target.handle,
			targetTitle: target.title,
			locatorHint: "purple-pink circular restart/reset button in the upper-right corner of the Sokoban game; do not click the green undo button",
		},
	};
}

function resetRouteStateAfterLongSequenceRecovery(routeState: DelegationRouteState | null): DelegationRouteState | null {
	if (!routeState) {
		return null;
	}
	return {
		...routeState,
		currentBoard: routeState.canonicalInitialBoard || routeState.currentBoard,
		committedRoute: "",
		currentRouteStep: "",
		routeRisks: routeState.routeRisks,
		latestDiagnosis: pickReplyLanguageText(
			"长序列失败后已重开；保留失败经验，但清除死局中的临时棋盘和路线。",
			"Restarted after long-sequence failure; preserved failure lessons but cleared the deadlocked temporary route.",
		),
	};
}

function isBoardMissionCompleted(
	reflection: ProgressEvaluatorDecision,
	planner: OperationsPlannerDecision,
): boolean {
	const evaluatorDeclaresDone = reflection.goalProgress === "done" || reflection.goalAlignment === "achieved";
	const strongEvidence = reflection.expectedMet && reflection.actionSucceeded && reflection.wasActionCorrect;
	return evaluatorDeclaresDone && (planner.goalReached || strongEvidence);
}

function detectLongSequenceRecoveryReason(input: {
	executionError: string;
	reflection: ProgressEvaluatorDecision;
}): string {
	if (input.executionError) {
		return input.executionError;
	}
	const joined = [
		input.reflection.nextHint,
		input.reflection.planAssessment,
		input.reflection.phaseAssessment,
		input.reflection.latestDiagnosis,
		input.reflection.routeStateUpdate,
	].join(" ");
	if (/deadlock|死局|restart|reset|重开|重新开始|unrecoverable|无法恢复|卡死/i.test(joined)) {
		return joined.slice(0, 500);
	}
	if (input.reflection.planViability === "invalidated" && input.reflection.phaseStatus === "blocked") {
		return input.reflection.planAssessment || input.reflection.phaseAssessment || "long sequence route invalidated";
	}
	return "";
}

function buildPreMissionForObservation(taskText: string): MissionAnalysisDecision {
	return {
		taskMode: "game",
		missionGoal: taskText,
		initialStateSummary: "",
		initialStateSketch: "",
		hardConstraints: [],
		subtaskChain: [],
		completionSignals: [],
		candidateStrategies: [],
		strategyWarnings: [],
		analysisReply: "",
		ackReply: "",
		reply: "",
	};
}

async function requestMissionAnalystDecision(input: {
	config: DelegatedTaskProfileConfig;
	taskText: string;
	target: FunctionalTarget;
	allowedTools: string[];
	candidateGameContext: DelegatedGameContext | null;
	snapshot: CapturedTargetSnapshot;
	boardObservation: BoardObservation;
	replyLanguageMode: ReplyLanguageMode;
}): Promise<string> {
	const systemPrompt = buildMissionAnalystSystemPrompt(input.config.missionAnalystRules);
	const userPrompt = buildMissionAnalystUserPrompt({
		taskText: input.taskText,
		target: input.target,
		allowedTools: input.allowedTools,
		candidateGameContext: input.candidateGameContext,
		boardObservation: input.boardObservation,
	});
	const canUseTextReasoning = input.candidateGameContext && isUsableBoardObservation(input.boardObservation);
	if (canUseTextReasoning) {
		try {
			log.info("delegated role request mode", {
				role: "mission-analyst",
				mode: "text",
				thinkingMode: input.config.missionAnalystThinkingMode,
				boardConfidence: input.boardObservation.confidence,
			});
			return await requestActiveTextDecision({
				systemPrompt,
				userPrompt,
				temperature: input.config.missionAnalystTemperature,
				thinkingMode: input.config.missionAnalystThinkingMode,
				maxTokens: 900,
				jsonResponse: true,
				timeoutMs: 35_000,
				replyLanguageMode: input.replyLanguageMode,
				telemetry: {
					role: "mission-analyst",
					source: "delegation",
					taskKind: input.candidateGameContext?.gameId ?? "generic",
				},
			});
		} catch (error) {
			log.warn("mission analyst text reasoning failed; falling back to vision", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log.info("delegated role request mode", {
		role: "mission-analyst",
		mode: "vision-fallback",
		thinkingMode: "off",
		boardConfidence: input.boardObservation.confidence,
	});
	return requestActiveVisionDecision({
		systemPrompt,
		userPrompt,
		imageDataUrls: [input.snapshot.dataUrl],
		temperature: input.config.missionAnalystTemperature,
		thinkingMode: input.config.missionAnalystThinkingMode,
		maxTokens: 900,
		jsonResponse: true,
		timeoutMs: 35_000,
		replyLanguageMode: input.replyLanguageMode,
		telemetry: {
			role: "mission-analyst",
			source: "delegation",
			taskKind: input.candidateGameContext?.gameId ?? "generic",
		},
	});
}

async function requestPlannerDecision(input: {
	config: DelegatedTaskProfileConfig;
	systemPrompt: string;
	userPrompt: string;
	snapshot: CapturedTargetSnapshot;
	boardObservation: BoardObservation;
	taskKind: string;
	forceVision?: boolean;
	maxTokens?: number;
	replyLanguageMode: ReplyLanguageMode;
}): Promise<string> {
	if (!input.forceVision && isUsableBoardObservation(input.boardObservation)) {
		try {
			log.info("delegated role request mode", {
				role: "operations-planner",
				mode: "text",
				thinkingMode: input.config.operationsPlannerThinkingMode,
				boardConfidence: input.boardObservation.confidence,
			});
			return await requestActiveTextDecision({
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				temperature: input.config.operationsPlannerTemperature,
				thinkingMode: input.config.operationsPlannerThinkingMode,
				maxTokens: input.maxTokens ?? 900,
				jsonResponse: true,
				timeoutMs: 35_000,
				replyLanguageMode: input.replyLanguageMode,
				telemetry: {
					role: "operations-planner",
					source: "delegation",
					taskKind: input.taskKind,
				},
			});
		} catch (error) {
			log.warn("planner text reasoning failed; falling back to vision", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log.info("delegated role request mode", {
		role: "operations-planner",
		mode: input.forceVision ? "vision-forced" : "vision-fallback",
		thinkingMode: "off",
		boardConfidence: input.boardObservation.confidence,
	});
	return requestActiveVisionDecision({
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		imageDataUrls: [input.snapshot.dataUrl],
		temperature: input.config.operationsPlannerTemperature,
		thinkingMode: input.config.operationsPlannerThinkingMode,
		maxTokens: input.maxTokens ?? 700,
		jsonResponse: true,
		timeoutMs: 30_000,
		replyLanguageMode: input.replyLanguageMode,
		telemetry: {
			role: "operations-planner",
			source: "delegation",
			taskKind: input.taskKind,
		},
	});
}

async function requestEvaluatorDecision(input: {
	config: DelegatedTaskProfileConfig;
	systemPrompt: string;
	userPrompt: string;
	beforeSnapshot: CapturedTargetSnapshot;
	afterSnapshot: CapturedTargetSnapshot;
	beforeObservation: BoardObservation;
	afterObservation: BoardObservation;
	taskKind: string;
	forceVision?: boolean;
	replyLanguageMode: ReplyLanguageMode;
}): Promise<string> {
	if (!input.forceVision && isUsableBoardObservation(input.beforeObservation) && isUsableBoardObservation(input.afterObservation)) {
		try {
			log.info("delegated role request mode", {
				role: "progress-evaluator",
				mode: "text",
				thinkingMode: input.config.progressEvaluatorThinkingMode,
				beforeConfidence: input.beforeObservation.confidence,
				afterConfidence: input.afterObservation.confidence,
			});
			return await requestActiveTextDecision({
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				temperature: input.config.progressEvaluatorTemperature,
				thinkingMode: input.config.progressEvaluatorThinkingMode,
				maxTokens: 700,
				jsonResponse: true,
				timeoutMs: 35_000,
				replyLanguageMode: input.replyLanguageMode,
				telemetry: {
					role: "progress-evaluator",
					source: "delegation",
					taskKind: input.taskKind,
				},
			});
		} catch (error) {
			log.warn("evaluator text reasoning failed; falling back to vision", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log.info("delegated role request mode", {
		role: "progress-evaluator",
		mode: input.forceVision ? "vision-forced" : "vision-fallback",
		thinkingMode: "off",
		beforeConfidence: input.beforeObservation.confidence,
		afterConfidence: input.afterObservation.confidence,
	});
	return requestActiveVisionDecision({
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		imageDataUrls: [input.beforeSnapshot.dataUrl, input.afterSnapshot.dataUrl],
		temperature: input.config.progressEvaluatorTemperature,
		thinkingMode: input.config.progressEvaluatorThinkingMode,
		maxTokens: 500,
		jsonResponse: true,
		timeoutMs: 30_000,
		replyLanguageMode: input.replyLanguageMode,
		telemetry: {
			role: "progress-evaluator",
			source: "delegation",
			taskKind: input.taskKind,
		},
	});
}

function buildMissionAnalystSystemPrompt(rules: string[]): string {
	const baseRules = [
		"你是 Mission Analyst。你会在动作执行前分析任务目标、约束和可能的子任务链。",
		"必须优先识别用户显式约束，例如“指定网站”“不要离开当前页面”“不要改动原页面”等。",
		"当前页面/窗口/标签页标题属于初始环境观察，不属于 hardConstraints；除非用户明确要求，否则不得把它们写成约束。",
		"你必须输出 initialStateSummary，用一句话描述当前处于什么页面/窗口状态，以及这会如何影响后续规划。",
		"若用户任务是浏览器操作，不要误判为游戏托管。",
		"浏览器任务必须先分析初始状态：当前标签页是空白新标签页、目标站点页，还是已有内容页。",
		"当当前标签页已有内容且任务可能破坏上下文时，优先把“新建标签页”纳入子任务链，再继续导航。",
		"子任务链应体现状态推进：准备态 -> 站点态 -> 输入态 -> 结果态（按任务裁剪）。",
		"analysisReply 只用于简短说明任务链理解，不得声称“已完成/已打开网页/已得到答案”。",
		"ackReply 用角色口吻确认“已收到任务并马上开始执行”，不要复述过长分析，不要包含窗口句柄。",
		"复杂解谜/棋盘任务必须额外给出 candidateStrategies（候选高层路线）和 strategyWarnings（应避免的贪心错误路线）。",
		"对于推箱子，不要默认“一箱一箱线性完成”；允许候选路线围绕中间态、腾空间、临时占点后再推出等非单调解法。",
		"禁止输出代码块、禁止附加解释文本，只输出 JSON。",
	];
	return [...baseRules, ...rules].join("\n");
}

function buildMissionAnalystUserPrompt(input: {
	taskText: string;
	target: FunctionalTarget;
	allowedTools: string[];
	candidateGameContext: DelegatedGameContext | null;
	boardObservation?: BoardObservation;
}): string {
	const gameContextText = input.candidateGameContext
		? `${input.candidateGameContext.displayName} (${input.candidateGameContext.gameId}) actions=${input.candidateGameContext.actionIds.join(", ")}`
		: "none";
	const boardObservationText = input.boardObservation && isUsableBoardObservation(input.boardObservation)
		? [
			"structuredInitialObservation:",
			formatBoardObservationForPlanner(input.boardObservation),
		].join("\n")
		: "structuredInitialObservation: (none)";
	return [
		`task: ${input.taskText}`,
		`observedCurrentWindow: ${input.target.title} (${input.target.handle})`,
		"注意：observedCurrentWindow 只是当前观察到的初始状态，不是用户约束；不要把它直接抄进 hardConstraints。",
		`candidateGameContext: ${gameContextText}`,
		`allowedTools: ${input.allowedTools.join(", ")}`,
		boardObservationText,
		"",
		"输出 JSON：",
		"{",
		'  "taskMode": "browser|game|generic",',
		'  "missionGoal": "string",',
		'  "initialStateSummary": "string",',
		'  "hardConstraints": ["string"],',
		'  "subtaskChain": ["string"],',
		'  "completionSignals": ["string"],',
		'  "candidateStrategies": ["string（候选高层路线；复杂解谜任务至少给 2 条）"],',
		'  "strategyWarnings": ["string（开局应避免的明显错误路线或贪心方案）"],',
		'  "initialStateSketch": "string（可选；离散棋盘/网格任务时用纯文本表示观察到的局面）",',
		'  "analysisReply": "string",',
		'  "ackReply": "string",',
		'  "reply": "string（兼容旧字段，可与 analysisReply 相同）"',
		"}",
	].join("\n");
}

function buildOperationsPlannerSystemPrompt(input: {
	allowedTools: string[];
	maxActionsPerRound: number;
	minActionsPerRound: number;
	rules: string[];
	gameContext: DelegatedGameContext | null;
	mission: MissionAnalysisDecision;
	longSequenceMode?: boolean;
}): string {
	const baseRules = [
		input.longSequenceMode
			? "你是 Operations Planner。长序列模式下，你负责从当前截图一次性规划完整或尽可能完整的连续动作路线。"
			: "你是 Operations Planner。你只负责下一步动作决策。",
		`missionGoal: ${input.mission.missionGoal}`,
		`hardConstraints: ${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		`completionSignals: ${input.mission.completionSignals.join(" | ") || "(none)"}`,
		`allowedTools: ${input.allowedTools.join(", ")}`,
		input.longSequenceMode
			? `长序列模式动作数量契约：actions 必须尽量输出 ${input.minActionsPerRound} 到 ${input.maxActionsPerRound} 个单步动作；目标是一次给出完整或尽可能长的连续通关序列。`
			: `每轮最多输出 ${input.maxActionsPerRound} 个动作，动作粒度越小越好。`,
		"每轮都要先复盘上一轮“预期结果”与“实际达成”，再决定本轮动作；若上一轮未达成，优先给出纠偏动作链。",
		"当 goalReached=false 时，reply 只能描述“下一步要做什么”，禁止直接回答任务问题本身。",
		"当 goalReached=false 时，必须输出 expectedOutcome（本轮动作执行后应看到的可验证状态变化）。",
		"当 goalReached=false 时，actions 必须至少包含 1 个可执行动作；禁止输出空数组。",
		"每个 action 必须是“单步可执行”，不要把多个动作混在一个 action 里。",
		input.longSequenceMode
			? "长序列模式下，history / latestHint 只能作为失败事实参考；必须从当前截图重新生成完整动作路线，不要按 latestHint 做单步响应。"
			: "若 history / latestHint 表示同一动作连续失败，下一轮必须更换策略，不得重复同签名动作。",
		input.longSequenceMode
			? "长序列模式下，禁止把“走到某个推位”作为整轮终点；除非关卡已完成，否则 actions 必须继续展开后续推箱步骤。"
			: "若 latestHint 要求“Ctrl+L 后输入 URL 并回车”，actions 不能只给 Ctrl+L，必须给完整动作链。",
		"点击类动作：定位特定 UI 元素（按钮、tile、图标等）时，必须在 host.send_mouse 的 args 中提供 locatorHint 描述目标元素，不要自己猜测 x/y/xNorm/yNorm 坐标；系统会通过本地视觉定位阶梯自动解析精确坐标。",
		"只有点击通用位置（游戏棋盘中心、窗口中央等不需要精确定位的地方），才允许直接使用 xNorm/yNorm 而不带 locatorHint。",
		input.longSequenceMode
			? "根据 Mission 的 subtaskChain 先完整解题，再把路线展开为连续单步 actions；不要只输出一个最小可验证动作。"
			: "根据 Mission 的 subtaskChain 分阶段推进，每轮只推进一个最小可验证状态变化。",
		"对复杂棋盘任务，必须显式维护 currentPhaseGoal / whyThisPhase / abortCondition。phaseGoal 应描述当前阶段要创造的中间态，而不只是最终目标。",
		"对复杂棋盘任务，必须维护 committedRoute / currentRouteStep / routeSelfCheck：先说明当前承诺路线，再自检这一轮动作是否服务于该路线，最后才给 actions。",
		"如果 committedRoute 与当前棋盘或失败经验冲突，必须在 strategyRevision 中改路线；不要只跟随 latestHint 做局部动作。",
		"对复杂推箱子任务，优先围绕“释放空间、调整箱子相对关系、验证候选路线”选择 activeStrategy，而不是贪心地先完成看起来最近的箱子。",
		"对推箱子任务，任何推动箱子的动作都必须在 reasoning 或 expectedOutcome 中显式写清：目标箱子、箱子要移动的方向、P 必须站在箱子的哪一侧、P 当前是否已经在该侧、最终 actionId。若 P 不在正确侧，本轮只能先走位，不能假装已经能推。",
		"推箱几何硬规则：箱子向左，P 必须在箱子右侧并执行 move_left；箱子向右，P 必须在箱子左侧并执行 move_right；箱子向上，P 必须在箱子下侧并执行 move_up；箱子向下，P 必须在箱子上侧并执行 move_down。",
		"不要把“高层策略失败”和“站位/方向执行失败”混为一谈。若 lower-box-first 这类高层路线还可能成立，只修正具体站位或动作方向，不要把整类路线写进 invalidatedStrategies。",
		"activeStrategy 应代表当前正在验证的高层路线；strategyRevision 用一句话说明本轮是否维持、修正或放弃原路线。",
		"若 scratchpadContext 中已经列出 invalidatedStrategies，禁止继续复用这些已被否决的高层路线，必须改选候选路线或明确修正原路线。",
		"允许为了更优解暂时把箱子推离目标点，只要这个中间态明确服务于后续解题；不要把“某箱已经在目标点上”自动等同于整个策略结束。",
		"reply 必须简短（建议不超过 24 个字符），不包含窗口句柄、十六进制 ID 或长解释。",
		"若需要“输入并回车”，请拆成两步动作：先 host.paste_text 输入纯文本，再 host.send_key(\"Enter\")；不要把 {ENTER} 混进 text。",
		"禁止输出代码块、禁止附加解释文本，只输出 JSON。",
	];
	if (input.longSequenceMode) {
		baseRules.push("长序列模式覆盖常规短步策略：本轮不要求只推进一个最小状态变化，而是要求给出可连续验证的一整段解题动作。");
		baseRules.push(`长序列模式：当前轮次应尽量输出从当前棋盘到通关的一整条动作序列，而不是局部短序列。除非这些动作会直接通关，否则 actions 不应少于 ${input.minActionsPerRound} 步。每个动作仍必须是一个单步 action。`);
		baseRules.push(`长序列模式动作范围为 ${input.minActionsPerRound}-${input.maxActionsPerRound} 步；只输出你有理由相信从当前局面可连续执行的步骤，系统会在某步无截图变化时自动停止并交给 Evaluator 反思。`);
		baseRules.push("长序列模式下，优先全部使用 game.perform_action；不要夹杂 reset、刷新、换标签页等恢复动作，除非当前局面已经明确死局。");
	}
	if (input.gameContext) {
		baseRules.push(`若当前任务模式是游戏且窗口识别为 ${input.gameContext.displayName}，优先使用 game.perform_action。`);
	}
	if (input.mission.taskMode === "browser") {
		baseRules.push("浏览器任务优先执行“当前状态确认”，再决定是否新建标签页、导航站点、输入查询。");
		baseRules.push("若 Mission 包含“不要破坏当前页”或当前页已有内容，优先规划 Ctrl+T 或点击新标签页，再进行后续步骤。");
		baseRules.push("输入类动作优先 host.paste_text 一次性输入整句，不要默认使用 Ctrl+L。");
	}
	return [...baseRules, ...input.rules].join("\n");
}

function buildOperationsPlannerUserPrompt(input: {
	taskText: string;
	round: number;
	maxRounds: number;
	target: FunctionalTarget;
	history: string[];
	latestHint: string;
	mission: MissionAnalysisDecision;
	gameContext: DelegatedGameContext | null;
	allowedTools: string[];
	scratchpadContext: string;
	plannerPolicyReminder: string;
	previousExpectedOutcome: string;
	previousExpectedMet: boolean | null;
	latestPhaseGoal: string;
	latestPhaseReason: string;
	latestPhaseAbortCondition: string;
	latestPhaseStatus: string;
	latestPhaseAssessment: string;
	latestActiveStrategy: string;
	latestStrategyRevision: string;
	latestPlanViability: string;
	latestPlanAssessment: string;
	invalidatedStrategies: string[];
	strategyLessons: string[];
	boardPositionsText?: string;
	longSequenceMode?: boolean;
	longSequenceMaxActions?: number;
	longSequenceMinActions?: number;
}): string {
	const historyText = input.history.length ? input.history.map((item) => `- ${item}`).join("\n") : "- (empty)";
	const positionLines: string[] = [];
	if (input.boardPositionsText) {
		positionLines.push(input.boardPositionsText);
	}
	const gameContextText = input.gameContext
		? [
			`gameContext: ${input.gameContext.displayName} (${input.gameContext.gameId})`,
			`gameActionIds: ${input.gameContext.actionIds.join(", ")}`,
			"若你选择 game.perform_action，必须给出合法 actionId。",
		].join("\n")
		: "gameContext: none";
	if (input.longSequenceMode) {
		return buildLongSequencePlannerUserPrompt({
			...input,
			gameContextText,
			historyText,
			maxActions: input.longSequenceMaxActions ?? input.allowedTools.length,
			minActions: input.longSequenceMinActions ?? 1,
		});
	}
	return [
		`task: ${input.taskText}`,
		`round: ${input.round}/${input.maxRounds}`,
		`target: ${input.target.title} (${input.target.handle})`,
		`missionGoal: ${input.mission.missionGoal}`,
		`missionSubtaskChain: ${input.mission.subtaskChain.join(" -> ") || "(none)"}`,
		`missionHardConstraints: ${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		gameContextText,
		...positionLines,
		`latestHint: ${input.latestHint || "(none)"}`,
		`previousExpectedOutcome: ${input.previousExpectedOutcome || "(none)"}`,
		`previousExpectedMet: ${input.previousExpectedMet === null ? "unknown" : input.previousExpectedMet ? "yes" : "no"}`,
		`latestPhaseGoal: ${input.latestPhaseGoal || "(none)"}`,
		`latestPhaseReason: ${input.latestPhaseReason || "(none)"}`,
		`latestPhaseAbortCondition: ${input.latestPhaseAbortCondition || "(none)"}`,
		`latestPhaseStatus: ${input.latestPhaseStatus || "(none)"}`,
		`latestPhaseAssessment: ${input.latestPhaseAssessment || "(none)"}`,
		`latestActiveStrategy: ${input.latestActiveStrategy || "(none)"}`,
		`latestStrategyRevision: ${input.latestStrategyRevision || "(none)"}`,
		`latestPlanViability: ${input.latestPlanViability || "(none)"}`,
		`latestPlanAssessment: ${input.latestPlanAssessment || "(none)"}`,
		`candidateStrategies: ${input.mission.candidateStrategies.join(" || ") || "(none)"}`,
		`strategyWarnings: ${input.mission.strategyWarnings.join(" || ") || "(none)"}`,
		`invalidatedStrategies: ${input.invalidatedStrategies.join(" || ") || "(none)"}`,
		`strategyLessons: ${input.strategyLessons.join(" || ") || "(none)"}`,
		`plannerPolicyReminder: ${input.plannerPolicyReminder || "(none)"}`,
		"scratchpadContext:",
		input.scratchpadContext || "(empty)",
		"history:",
		historyText,
		"",
		"输出 JSON：",
		"{",
		'  "goalReached": boolean,',
		'  "reasoning": "string",',
		'  "reply": "string",',
		'  "expectedOutcome": "string",',
		'  "stateSketch": "string（可选；离散棋盘/网格任务时用纯文本表示当前理解到的局面）",',
		'  "currentPhaseGoal": "string（当前阶段要创造的中间态或局面目标）",',
		'  "whyThisPhase": "string（为什么当前先做这个阶段）",',
		'  "abortCondition": "string（什么迹象出现后要放弃当前阶段并换策略/重开）",',
		'  "activeStrategy": "string（当前正在验证的高层路线/箱子-目标分配思路）",',
		'  "strategyRevision": "string（本轮对高层路线的维持、修正或切换说明）",',
		'  "routeSelfCheck": "string（行动前自检：本轮动作如何服务 committedRoute，是否保持整体可达性）",',
		'  "committedRoute": "string（当前承诺执行的路线骨架；不要只写单步动作）",',
		'  "currentRouteStep": "string（当前正在执行的路线步骤）",',
		'  "routeRisks": ["string（当前路线的主要风险）"],',
		'  "actions": [',
		`    { "tool": "${input.allowedTools.join("|")}", "args": { "locatorHint": "点击绿色 tile '1'" } }`,
		"  ]",
		"}",
	].join("\n");
}

function buildLongSequencePlannerUserPrompt(input: {
	taskText: string;
	round: number;
	maxRounds: number;
	target: FunctionalTarget;
	history: string[];
	latestHint: string;
	mission: MissionAnalysisDecision;
	gameContext: DelegatedGameContext | null;
	allowedTools: string[];
	scratchpadContext: string;
	plannerPolicyReminder: string;
	previousExpectedOutcome: string;
	previousExpectedMet: boolean | null;
	latestPhaseGoal: string;
	latestPhaseReason: string;
	latestPhaseAbortCondition: string;
	latestPhaseStatus: string;
	latestPhaseAssessment: string;
	latestActiveStrategy: string;
	latestStrategyRevision: string;
	latestPlanViability: string;
	latestPlanAssessment: string;
	invalidatedStrategies: string[];
	strategyLessons: string[];
	gameContextText: string;
	historyText: string;
	maxActions: number;
	minActions: number;
}): string {
	const failureContext = [
		`previousExpectedOutcome: ${input.previousExpectedOutcome || "(none)"}`,
		`previousExpectedMet: ${input.previousExpectedMet === null ? "unknown" : input.previousExpectedMet ? "yes" : "no"}`,
		`latestHint: ${input.latestHint || "(none)"}`,
		`latestPlanViability: ${input.latestPlanViability || "(none)"}`,
		`latestPlanAssessment: ${input.latestPlanAssessment || "(none)"}`,
		`invalidatedStrategies: ${input.invalidatedStrategies.join(" || ") || "(none)"}`,
		`strategyLessons: ${input.strategyLessons.join(" || ") || "(none)"}`,
		`plannerPolicyReminder: ${input.plannerPolicyReminder || "(none)"}`,
	].join("\n");
	return [
		`task: ${input.taskText}`,
		`round: ${input.round}/${input.maxRounds}`,
		`target: ${input.target.title} (${input.target.handle})`,
		`missionGoal: ${input.mission.missionGoal}`,
		`missionSubtaskChain: ${input.mission.subtaskChain.join(" -> ") || "(none)"}`,
		`missionHardConstraints: ${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		`candidateStrategies: ${input.mission.candidateStrategies.join(" || ") || "(none)"}`,
		`strategyWarnings: ${input.mission.strategyWarnings.join(" || ") || "(none)"}`,
		input.gameContextText,
		"",
		"LONG SEQUENCE MODE:",
		"- Use the current screenshot as the source of truth for the current board.",
		"- First solve the puzzle mentally from the current board, then expand that route into consecutive single-step game.perform_action actions.",
		"- The actions array is the execution plan. It must not stop at a setup position, a stance correction, or a partial milestone.",
		"- If the level is visible and solvable, output the full solution sequence or the longest contiguous prefix you genuinely believe will solve it.",
		`- You may output up to ${input.maxActions} actions. A short sequence is acceptable only when it genuinely completes the level, performs a required reset, or the board is unreadable; explain that in abortCondition.`,
		`- Engineering acceptance: for this game profile, fewer than ${input.minActions} actions is treated as suspiciously short unless the level is visibly solved by that exact sequence. Do not stop after a setup move.`,
		"- Prefer game.perform_action only. Do not insert evaluator checkpoints; the runner will execute each step and stop automatically on no-change.",
		"- If a prior attempt failed or deadlocked, the runner restarts the level before asking you again. Do not continue patching the corrupted board unless the current screenshot clearly shows a non-initial board.",
		"- Treat each planner turn as a fresh complete solve attempt from the visible board. Do not output a short local repair sequence after a failed long sequence.",
		"- For Sokoban, compare multiple route ideas before committing. Do not assume boxes are solved linearly or permanently once they touch a target.",
		"- Temporary placements, moving a box off a target, and interleaving boxes are allowed when they preserve global solvability.",
		"- Before any push in the sequence, internally verify push geometry: player side, push direction, destination cell, and later access.",
		"",
		"Failure facts from previous attempts, if any. Treat them as evidence, not as commands:",
		failureContext,
		"",
		"scratchpadContext:",
		input.scratchpadContext || "(empty)",
		"",
		"history:",
		input.historyText,
		"",
		"Output JSON only:",
		"{",
		'  "goalReached": false,',
		'  "reasoning": "briefly describe the complete route and why it should solve the board",',
		'  "reply": "short spoken plan in the requested reply language",',
		'  "expectedOutcome": "what the whole sequence should accomplish, including final completion signal if expected",',
		'  "stateSketch": "ASCII board you read from the current screenshot, with # . P B T * +",',
		'  "currentPhaseGoal": "execute one continuous solve attempt, not a one-step correction",',
		'  "whyThisPhase": "why this full route is globally viable",',
		'  "abortCondition": "when the runner/evaluator should stop and replan, especially the likely first bad step",',
		'  "activeStrategy": "the chosen global route, including box/target ordering and temporary placements",',
		'  "strategyRevision": "how previous failure facts changed this route, or no prior failure",',
		'  "routeSelfCheck": "explicitly state that the action list continues past setup moves toward completion",',
		'  "committedRoute": "numbered route milestones for the full attempt",',
		'  "currentRouteStep": "full-sequence attempt from current board",',
		'  "routeRisks": ["risk strings"],',
		`  "actionCountRequirement": "actions array should contain ${input.minActions}..${input.maxActions} items unless the shorter list truly completes the level",`,
		'  "actions": [',
		'    { "tool": "game.perform_action", "args": { "actionId": "move_left" } }',
		"  ]",
		"}",
	].join("\n");
}

function buildProgressEvaluatorSystemPrompt(rules: string[], mission: MissionAnalysisDecision): string {
	const baseRules = [
		"你是 Progress Evaluator。你会收到 before/after 两张图。",
		"你不仅要判断是否有变化，还要判断动作是否做对、是否朝 mission 目标推进。",
		"你必须检查 preExpectedOutcome 是否达成，并输出 expectedMet（布尔）与 expectationReview（一句话）。",
		"层级判定规则：expectedMet 是本轮动作正确性的主判定。若 expectedMet=false，wasActionCorrect 默认必须为 false；除非 after 图显示了一个明确、非预期但有价值的替代中间态，也只能在 planViability/phaseAssessment 里说明，不能把原动作判为正确。",
		"actionSucceeded 只表示动作是否造成可见执行结果；wasActionCorrect 表示该执行是否符合本轮预期；goalProgress 表示整关目标是否推进。三者不得混用。",
		"如果本轮预期是推动箱子，但 after 图显示只有 P 移动、箱子没有移动，则 expectedMet=false、wasActionCorrect=false、goalProgress=none；除非该纯走位正好是 currentPhaseGoal 明确要求的站位。",
		"若 preExpectedOutcome 未达成，nextHint 必须明确给出修正动作链，不能只给抽象建议。",
		"你还必须判断当前阶段目标是否推进，输出 phaseStatus（advanced|stalled|blocked|completed）和 phaseAssessment（一句话）。",
		"phaseStatus=completed 只表示当前阶段完成，不等于整个 mission 完成；mission 是否完成仍必须严格服从 completionSignals。",
		"你还必须判断当前高层路线是否更可信，输出 planViability（strengthened|unchanged|weakened|invalidated）和 planAssessment（一句话）。",
		"你必须输出 routeStateUpdate 和 latestDiagnosis：只诊断路线状态如何变化，不要把 nextHint 写成强制命令。",
		"如果这一步虽然没完成局部 expectedOutcome，但让当前路线更可行、释放了空间、或验证了某条路线错误，也必须在 planViability / phaseAssessment 中明确指出。",
		"你还要检查 executedAction 是否拆成“单步可执行动作”；若动作过于抽象或一步里混了多步，判定 wasActionCorrect=false 并在 nextHint 指出应拆成的最小动作。",
		"若 history 显示同签名动作已连续失败 >=2 轮，你必须判定 wasActionCorrect=false 且 goalAlignment=deviated，并在 nextHint 强制要求“换策略/换动作链，不得重复同动作”。",
		`missionGoal: ${mission.missionGoal}`,
		`initialState: ${mission.initialStateSummary || "(none)"}`,
		`hardConstraints: ${mission.hardConstraints.join(" | ") || "(none)"}`,
		`subtaskChain: ${mission.subtaskChain.join(" -> ") || "(none)"}`,
		`completionSignals: ${mission.completionSignals.join(" | ") || "(none)"}`,
		"若 executedAction 的 text 内含 {ENTER}/{RETURN} 这类字面宏，必须判定 wasActionCorrect=false、goalAlignment=deviated。",
		"你必须评估当前环境是否仍然满足任务前提：页面是否正确、站点是否相关、是否发生页面漂移、前置条件是否被破坏。",
		"若环境已经偏离任务前提，不要只评估局部动作是否成功；要在 nextHint 中明确说明当前错误状态与应恢复到的目标状态。",
		"reply 是一句自然口语化的简短复盘（≤40字），以派蒙第一人称说话，像跟朋友汇报进度一样，避免重复相同句式。",
		"nextHint 要明确“当前处于哪个状态、下一轮应推进到哪个状态”，不要笼统描述。",
		"禁止输出代码块、禁止附加解释文本，只输出 JSON。",
	];
	return [...baseRules, ...rules].join("\n");
}

function buildProgressEvaluatorUserPrompt(input: {
	taskText: string;
	round: number;
	target: FunctionalTarget;
	action: DelegatedTaskAction;
	mission: MissionAnalysisDecision;
	history: string[];
	expectedOutcome: string;
	executionError: string;
	scratchpadContext: string;
	batchActionSummary?: string;
	phaseGoal: string;
	phaseReason: string;
	phaseAbortCondition: string;
	activeStrategy: string;
	boardPositionsText?: string;
}): string {
	const historyText = input.history.length ? input.history.map((item) => `- ${item}`).join("\n") : "- (empty)";
	const initLines: string[] = [];
	if (input.boardPositionsText) {
		initLines.push(input.boardPositionsText);
	}
	const lines = [
		`task: ${input.taskText}`,
		`round: ${input.round}`,
		`target: ${input.target.title} (${input.target.handle})`,
		`missionGoal: ${input.mission.missionGoal}`,
		`missionInitialState: ${input.mission.initialStateSummary || "(none)"}`,
		...initLines,
	];
	if (input.batchActionSummary) {
		lines.push(`executedActionBatch: ${input.batchActionSummary}`);
		lines.push("注意：本轮执行了多步动作序列。before 图为本轮首步执行前，after 图为末步执行后。请基于整体结果做出判断。");
	} else {
		lines.push(`executedAction: ${input.action.tool}`);
		lines.push(`actionArgs: ${JSON.stringify(input.action.args)}`);
	}
	lines.push(
		`preExpectedOutcome: ${input.expectedOutcome || "(none)"}`,
		`currentPhaseGoal: ${input.phaseGoal || "(none)"}`,
		`phaseReason: ${input.phaseReason || "(none)"}`,
		`phaseAbortCondition: ${input.phaseAbortCondition || "(none)"}`,
		`activeStrategy: ${input.activeStrategy || "(none)"}`,
		`executionError: ${input.executionError || "(none)"}`,
		"scratchpadContext:",
		input.scratchpadContext || "(empty)",
		"history:",
		historyText,
		"",
		"输出 JSON：",
		"{",
		'  "actionSucceeded": boolean,',
		'  "wasActionCorrect": boolean,',
		'  "expectedMet": boolean,',
		'  "expectationReview": "string",',
		'  "goalAlignment": "closer|unchanged|deviated|achieved",',
		'  "goalProgress": "none|partial|done",',
		'  "reply": "string",',
		'  "nextHint": "string",',
		'  "beforeStateSketch": "string（可选；离散棋盘/网格任务时描述 before 局面）",',
		'  "afterStateSketch": "string（可选；离散棋盘/网格任务时描述 after 局面）",',
		'  "stateDelta": "string（可选；说明这一步到底哪里变了；若几乎没变应明确写无变化）",',
		'  "phaseStatus": "advanced|stalled|blocked|completed",',
		'  "phaseAssessment": "string",',
		'  "planViability": "strengthened|unchanged|weakened|invalidated",',
		'  "planAssessment": "string",',
		'  "routeStateUpdate": "string（本轮对 committedRoute/currentRouteStep/失败经验的更新）",',
		'  "latestDiagnosis": "string（给下一轮 Planner 的诊断，不是命令）"',
		"}",
	);
	return lines.join("\n");
}

function normalizeMissionAnalysisDecision(rawText: string, taskText: string, target: FunctionalTarget): MissionAnalysisDecision {
	const parsed = parseJsonObject(rawText);
	const hardConstraints = sanitizeMissionHardConstraints(
		toStringArray(parsed.hardConstraints).slice(0, 8),
		taskText,
		target.title,
	);
	const subtaskChain = toStringArray(parsed.subtaskChain).slice(0, 8);
	const completionSignals = toStringArray(parsed.completionSignals).slice(0, 8);
	const taskMode = normalizeTaskMode(toText(parsed.taskMode), taskText);
	const missionGoal = toText(parsed.missionGoal) || taskText;
	const initialStateSummary = toText(parsed.initialStateSummary) || `当前窗口/页面状态：${target.title}`;
	const initialStateSketch = toText(parsed.initialStateSketch);
	const analysisReply = toText(parsed.analysisReply || parsed.reply);
	const ackReply = toText(parsed.ackReply);
	return {
		taskMode,
		missionGoal,
		initialStateSummary,
		initialStateSketch,
		hardConstraints,
		subtaskChain,
		completionSignals,
		candidateStrategies: toStringArray(parsed.candidateStrategies).slice(0, 4),
		strategyWarnings: toStringArray(parsed.strategyWarnings).slice(0, 4),
		analysisReply,
		ackReply,
		reply: toText(parsed.reply),
	};
}

function sanitizeMissionHardConstraints(
	rawConstraints: string[],
	taskText: string,
	targetTitle: string,
): string[] {
	const titleKeywords = extractObservedTitleKeywords(targetTitle);
	return rawConstraints.filter((constraint) => {
		const normalized = constraint.trim();
		if (!normalized) {
			return false;
		}
		if (!titleKeywords.length) {
			return true;
		}
		const matchesObservedTitle = titleKeywords.some((keyword) => normalized.toLowerCase().includes(keyword.toLowerCase()));
		const taskMentionsObservedTitle = titleKeywords.some((keyword) => taskText.toLowerCase().includes(keyword.toLowerCase()));
		if (matchesObservedTitle && !taskMentionsObservedTitle) {
			return false;
		}
		return true;
	});
}

function extractObservedTitleKeywords(targetTitle: string): string[] {
	return targetTitle
		.split(/[—\-|·•:：/\\()[\]\s]+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 2)
		.filter((part) => !["mozilla", "firefox", "chrome", "edge", "browser"].includes(part.toLowerCase()));
}

function normalizeOperationsPlannerDecision(
	rawText: string,
	allowedTools: string[],
	maxActionsPerRound: number,
	target: FunctionalTarget,
	gameContext: DelegatedGameContext | null,
): OperationsPlannerDecision {
	const parsed = parseJsonObject(rawText);
	const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];
	const actions: DelegatedTaskAction[] = actionsRaw
		.map((item) => normalizeAction(item, allowedTools, target, gameContext))
		.filter((item): item is DelegatedTaskAction => item !== null)
		.slice(0, maxActionsPerRound);

	return {
		goalReached: Boolean(parsed.goalReached),
		reasoning: toText(parsed.reasoning),
		reply: toText(parsed.reply),
		expectedOutcome: toText(parsed.expectedOutcome),
		stateSketch: toText(parsed.stateSketch),
		currentPhaseGoal: toText(parsed.currentPhaseGoal),
		whyThisPhase: toText(parsed.whyThisPhase),
		abortCondition: toText(parsed.abortCondition),
		activeStrategy: toText(parsed.activeStrategy),
		strategyRevision: toText(parsed.strategyRevision),
		routeSelfCheck: toText(parsed.routeSelfCheck || parsed.selfCheck),
		committedRoute: toText(parsed.committedRoute),
		currentRouteStep: toText(parsed.currentRouteStep || parsed.routeStep),
		routeRisks: toStringArray(parsed.routeRisks).slice(0, 8),
		actions,
	};
}

function countRawPlannerActions(rawText: string): number {
	try {
		const parsed = parseJsonObject(rawText);
		return Array.isArray(parsed.actions) ? parsed.actions.length : 0;
	} catch {
		return 0;
	}
}

function extractRawPlannerActionIds(rawText: string): string[] {
	try {
		const parsed = parseJsonObject(rawText);
		if (!Array.isArray(parsed.actions)) {
			return [];
		}
		return parsed.actions
			.map((item) => {
				if (!item || typeof item !== "object") {
					return "";
				}
				const args = (item as { args?: unknown }).args;
				if (!args || typeof args !== "object" || Array.isArray(args)) {
					return "";
				}
				return toText((args as { actionId?: unknown }).actionId);
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function detectLongSequencePlannerIssue(input: {
	actions: DelegatedTaskAction[];
	minActions: number;
	maxActions: number;
	round: number;
}): string {
	if (input.minActions <= 1 || input.actions.length >= input.minActions) {
		return "";
	}
	const actionIds = input.actions
		.map((action) => toText(action.args.actionId))
		.filter(Boolean)
		.join(" -> ");
	return [
		`Long sequence mode requires a complete or near-complete solve attempt, but only ${input.actions.length}/${input.minActions} actions were produced.`,
		`Regenerate the plan with a full contiguous action sequence up to ${input.maxActions} actions.`,
		"Do not stop at setup, stance correction, or a partial milestone.",
		"Only output fewer actions if those exact actions visibly complete the level; otherwise continue the route.",
		actionIds ? `Previous too-short sequence was: ${actionIds}.` : "",
		`This is round ${input.round}; treat this as an engineering rejection before execution, not as evaluator feedback.`,
	].filter(Boolean).join(" ");
}

function normalizeAction(
	raw: unknown,
	allowedTools: string[],
	target: FunctionalTarget,
	gameContext: DelegatedGameContext | null,
): DelegatedTaskAction | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const tool = toText((raw as { tool?: unknown }).tool);
	if (!tool || !allowedTools.includes(tool)) {
		return null;
	}
	const args = (raw as { args?: unknown }).args;
	const normalizedArgs = args && typeof args === "object" && !Array.isArray(args)
		? { ...(args as Record<string, unknown>) }
		: {};
	if (tool === "game.perform_action") {
		if (!gameContext) {
			return null;
		}
		const actionId = normalizeGameActionId(toText(normalizedArgs.actionId));
		if (!actionId || !gameContext.actionIds.includes(actionId)) {
			return null;
		}
		normalizedArgs.gameId = gameContext.gameId;
		normalizedArgs.actionId = actionId;
	}
	if (tool === "host.send_key") {
		const normalizedKey = normalizeHostKey(toText(normalizedArgs.key));
		if (!normalizedKey) {
			return null;
		}
		normalizedArgs.key = normalizedKey;
	}
	if (tool === "host.send_mouse") {
		const x = toFiniteNumber(normalizedArgs.x);
		const y = toFiniteNumber(normalizedArgs.y);
		const xNorm = toUnitNumber(normalizedArgs.xNorm);
		const yNorm = toUnitNumber(normalizedArgs.yNorm);
		if (x !== null) {
			normalizedArgs.x = Math.round(x);
		} else {
			delete normalizedArgs.x;
		}
		if (y !== null) {
			normalizedArgs.y = Math.round(y);
		} else {
			delete normalizedArgs.y;
		}
		if (xNorm !== null) {
			normalizedArgs.xNorm = xNorm;
		} else {
			delete normalizedArgs.xNorm;
		}
		if (yNorm !== null) {
			normalizedArgs.yNorm = yNorm;
		} else {
			delete normalizedArgs.yNorm;
		}
		const locatorHint = toText(normalizedArgs.locatorHint ?? normalizedArgs.hint);
		if (locatorHint) {
			normalizedArgs.locatorHint = locatorHint;
		}
		if (typeof normalizedArgs.allowLocalVisionFallback !== "boolean") {
			delete normalizedArgs.allowLocalVisionFallback;
		}
		delete normalizedArgs.hint;
	}
	if (tool === "host.paste_text") {
		const text = toText(normalizedArgs.text);
		if (!text) {
			return null;
		}
		normalizedArgs.text = text;
	}

	if (tool !== "host.list_windows" && tool !== "game.perform_action") {
		if (typeof normalizedArgs.targetHandle !== "string" || !normalizedArgs.targetHandle.trim()) {
			normalizedArgs.targetHandle = target.handle;
		}
		if (typeof normalizedArgs.targetTitle !== "string" || !normalizedArgs.targetTitle.trim()) {
			normalizedArgs.targetTitle = target.title;
		}
	}
	return { tool, args: normalizedArgs };
}

function normalizeProgressEvaluatorDecision(rawText: string): ProgressEvaluatorDecision {
	const parsed = parseJsonObject(rawText);
	const alignmentRaw = toText(parsed.goalAlignment).toLowerCase();
	const goalAlignment: "closer" | "unchanged" | "deviated" | "achieved" = alignmentRaw === "achieved"
		? "achieved"
		: alignmentRaw === "deviated"
			? "deviated"
			: alignmentRaw === "closer"
				? "closer"
				: "unchanged";
	const goalProgressRaw = toText(parsed.goalProgress).toLowerCase();
	const goalProgress: "none" | "partial" | "done" = goalProgressRaw === "done"
		? "done"
		: goalProgressRaw === "partial"
			? "partial"
			: "none";
	const changedLegacy = Boolean(parsed.changed);
	const actionSucceeded = typeof parsed.actionSucceeded === "boolean"
		? parsed.actionSucceeded
		: changedLegacy;
	const wasActionCorrect = typeof parsed.wasActionCorrect === "boolean"
		? parsed.wasActionCorrect
		: actionSucceeded;
	const expectedMet = typeof parsed.expectedMet === "boolean"
		? parsed.expectedMet
		: (actionSucceeded && (goalAlignment === "closer" || goalAlignment === "achieved"));
	const correctedWasActionCorrect = !actionSucceeded && goalAlignment === "deviated"
		? false
		: wasActionCorrect;
	const hasTerminalSuccess = goalAlignment === "achieved" || goalProgress === "done";
	const phaseStatusRaw = toText(parsed.phaseStatus).toLowerCase();
	const phaseStatus: ProgressEvaluatorDecision["phaseStatus"] = hasTerminalSuccess
		? "completed"
		: phaseStatusRaw === "completed"
			? "completed"
			: phaseStatusRaw === "blocked"
				? "blocked"
				: phaseStatusRaw === "advanced"
					? "advanced"
					: phaseStatusRaw === "stalled"
						? "stalled"
						: actionSucceeded
							? "advanced"
							: goalAlignment === "deviated"
								? "blocked"
								: "stalled";
	const adjustedGoalProgress: "none" | "partial" | "done" = hasTerminalSuccess
		? "done"
		: goalProgress;
	const adjustedGoalAlignment: "closer" | "unchanged" | "deviated" | "achieved" = hasTerminalSuccess
		? "achieved"
		: goalAlignment;
	const planViabilityRaw = toText(parsed.planViability).toLowerCase();
	const planViability: ProgressEvaluatorDecision["planViability"] = hasTerminalSuccess
		? "strengthened"
		: planViabilityRaw === "invalidated"
			? "invalidated"
			: planViabilityRaw === "weakened"
				? "weakened"
				: planViabilityRaw === "strengthened"
					? "strengthened"
					: "unchanged";
	return {
		actionSucceeded: hasTerminalSuccess ? true : actionSucceeded,
		wasActionCorrect: hasTerminalSuccess ? true : correctedWasActionCorrect,
		expectedMet: hasTerminalSuccess ? true : expectedMet,
		expectationReview: toText(parsed.expectationReview),
		goalProgress: adjustedGoalProgress,
		goalAlignment: adjustedGoalAlignment,
		reply: toText(parsed.reply),
		nextHint: toText(parsed.nextHint),
		beforeStateSketch: toText(parsed.beforeStateSketch),
		afterStateSketch: toText(parsed.afterStateSketch),
		stateDelta: toText(parsed.stateDelta),
		phaseStatus,
		phaseAssessment: toText(parsed.phaseAssessment || parsed.expectationReview),
		planViability,
		planAssessment: toText(parsed.planAssessment || parsed.phaseAssessment || parsed.expectationReview),
		routeStateUpdate: toText(parsed.routeStateUpdate),
		latestDiagnosis: toText(parsed.latestDiagnosis || parsed.nextHint || parsed.expectationReview),
	};
}

function applyBoardTaskConsistencyGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext) {
		return reflection;
	}
	if (!hasNoChangeEvidence(reflection)) {
		return reflection;
	}
	return {
		...reflection,
		actionSucceeded: false,
		wasActionCorrect: false,
		expectedMet: false,
		goalAlignment: "unchanged",
		goalProgress: "none",
		phaseStatus: "stalled",
	};
}

function applyBoardTaskProgressGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext) {
		return reflection;
	}
	if (hasBoardTaskCompletionEvidence(reflection)) {
		return {
			...reflection,
			actionSucceeded: true,
			wasActionCorrect: true,
			expectedMet: true,
			goalAlignment: "achieved",
			goalProgress: "done",
			phaseStatus: "completed",
		};
	}
	if (!hasBoardTaskPositiveMovementEvidence(reflection)) {
		return reflection;
	}
	return {
		...reflection,
		actionSucceeded: true,
		wasActionCorrect: true,
		goalAlignment: reflection.goalAlignment === "achieved" ? "achieved" : "closer",
		goalProgress: reflection.goalProgress === "done" ? "done" : "partial",
		phaseStatus: reflection.phaseStatus === "completed" ? "completed" : "advanced",
	};
}

function applyPhasePlanProgressGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext || hasBoardTaskCompletionEvidence(reflection) || hasNoChangeEvidence(reflection)) {
		return reflection;
	}
	const phaseAdvanced = reflection.phaseStatus === "advanced" || reflection.phaseStatus === "completed";
	const planAdvanced = reflection.planViability === "strengthened";
	if (!phaseAdvanced && !planAdvanced) {
		return reflection;
	}
	return {
		...reflection,
		actionSucceeded: true,
		wasActionCorrect: true,
		goalAlignment: reflection.goalAlignment === "achieved" ? "achieved" : "closer",
		goalProgress: reflection.goalProgress === "done" ? "done" : "partial",
		planViability: reflection.planViability === "invalidated" ? "weakened" : reflection.planViability,
	};
}

function applyMissionCompletionGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext) {
		return reflection;
	}
	const evaluatorDeclaresDone = reflection.goalProgress === "done" || reflection.goalAlignment === "achieved";
	if (!evaluatorDeclaresDone) {
		return reflection;
	}
	if (gameContext.gameId !== "sokoban") {
		return reflection;
	}
	if (isSokobanMissionComplete(reflection)) {
		return reflection;
	}
	const madeProgress = didBoardTaskMakeProgress(reflection) || reflection.expectedMet || reflection.actionSucceeded;
	return {
		...reflection,
		goalAlignment: madeProgress ? "closer" : "unchanged",
		goalProgress: madeProgress ? "partial" : "none",
		phaseStatus: madeProgress ? "advanced" : "stalled",
		nextHint: combineHints(
			reflection.nextHint,
			pickReplyLanguageText(
				"整关尚未完成：当前棋盘仍显示未覆盖目标或未出现通关画面。把这一步视为局部推进，不要提前结束任务。",
				"Mission not complete: the current board still shows uncovered targets or no level-clear state. Treat this as local progress and keep solving.",
			),
		),
	};
}

function applySokobanDeadlockGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext || gameContext.gameId !== "sokoban") {
		return reflection;
	}
	if (isSokobanMissionComplete(reflection)) {
		return reflection;
	}
	const deadlock = detectSokobanDeadlock(reflection.beforeStateSketch, reflection.afterStateSketch, reflection.stateDelta);
	if (!deadlock) {
		return reflection;
	}
	return {
		...reflection,
		wasActionCorrect: false,
		expectedMet: false,
		goalAlignment: "deviated",
		goalProgress: "none",
		phaseStatus: "blocked",
		planViability: "invalidated",
		planAssessment: pickReplyLanguageText(
			`当前高层路线已被否决：${deadlock.reason}`,
			`The current high-level route is invalidated: ${deadlock.reason}`,
		),
		nextHint: combineHints(
			reflection.nextHint,
			pickReplyLanguageText(
				`检测到推箱子死局：${deadlock.reason}。不要继续在当前局面乱走；请点击右上角紫红色/偏粉红色的重置按钮重新开始本关，并记录这条错误思路。`,
				`Sokoban deadlock detected: ${deadlock.reason}. Do not keep wandering in the current state; click the purple-pink restart button in the upper-right corner, restart the level, and remember this failed idea.`,
			),
		),
	};
}

function applySokobanPushTargetDirectionGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
	action: DelegatedTaskAction,
	planner: OperationsPlannerDecision,
): ProgressEvaluatorDecision {
	if (gameContext?.gameId !== "sokoban") {
		return reflection;
	}
	const actionId = getSokobanMoveActionId(action);
	if (!actionId) {
		return reflection;
	}
	const intentText = normalizeStateSketchText([
		planner.expectedOutcome,
		planner.currentPhaseGoal,
		planner.whyThisPhase,
		reflection.expectationReview,
		reflection.nextHint,
	].join(" "));
	const expectsTargetPlacement = /final|finish|complete|solve|remainingtarget|onto.*target|目标|完成|最后|剩余/.test(intentText);
	const finalPushFailed = expectsTargetPlacement && isFailedFinalPushEvidence(reflection);
	if (!expectsTargetPlacement || (!finalPushFailed && !isPushingAwayFromPlayerTarget(reflection.beforeStateSketch, actionId))) {
		return reflection;
	}
	const correction = buildSokobanPushTargetDirectionHint(actionId);
	return {
		...reflection,
		actionSucceeded: false,
		wasActionCorrect: false,
		expectedMet: false,
		goalAlignment: "deviated",
		goalProgress: "none",
		phaseStatus: "blocked",
		planViability: reflection.planViability === "invalidated" ? "invalidated" : "weakened",
		phaseAssessment: combineHints(
			reflection.phaseAssessment,
			pickReplyLanguageText(
				"这一步没有完成预期推箱，属于收尾推箱方向或站位错误。",
				"This step did not perform the expected box push, so the finishing push direction or stance is wrong.",
			),
		),
		planAssessment: combineHints(
			reflection.planAssessment,
			pickReplyLanguageText(
				"当前具体收尾推法已失效：不能站在目标格一侧把相邻箱子继续向外推；但不要因此否掉整个箱子-目标分配策略，先修正站位和推向。",
				"The current concrete finishing push is invalid: do not stand on the target side and push the adjacent box outward; do not invalidate the whole box-target strategy just because the stance/direction was wrong.",
			),
		),
		nextHint: combineHints(reflection.nextHint, correction),
	};
}

function applySokobanPushIntentOutcomeGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
	action: DelegatedTaskAction,
	planner: OperationsPlannerDecision,
): ProgressEvaluatorDecision {
	if (gameContext?.gameId !== "sokoban" || isSokobanMissionComplete(reflection)) {
		return reflection;
	}
	const actionId = getSokobanMoveActionId(action);
	if (!actionId || reflection.expectedMet) {
		return reflection;
	}
	const intentText = normalizeStateSketchText([
		planner.expectedOutcome,
		planner.currentPhaseGoal,
		planner.whyThisPhase,
	].join(" "));
	const intendedBoxPush = /box|boxes|push|pushed|箱子|推/.test(intentText);
	if (!intendedBoxPush) {
		return reflection;
	}
	const outcomeText = normalizeStateSketchText([
		reflection.expectationReview,
		reflection.phaseAssessment,
		reflection.planAssessment,
		reflection.stateDelta,
	].join(" "));
	const onlyPlayerMoved = /only.*player.*moved|onlytheplayermoved|p\s*moved|playermoved|玩家.*移动|只.*玩家/.test(outcomeText)
		&& /nobox|box.*didnotmove|box.*stayed|boxes.*stayed|box.*not.*pushed|箱子.*未|箱子.*没有|没有推/.test(outcomeText);
	if (!onlyPlayerMoved) {
		return reflection;
	}
	return {
		...reflection,
		actionSucceeded: true,
		wasActionCorrect: false,
		expectedMet: false,
		goalAlignment: reflection.goalAlignment === "achieved" ? "deviated" : "unchanged",
		goalProgress: "none",
		phaseStatus: reflection.phaseStatus === "completed" ? "blocked" : reflection.phaseStatus,
		planViability: reflection.planViability === "strengthened" ? "weakened" : reflection.planViability,
		phaseAssessment: combineHints(
			reflection.phaseAssessment,
			pickReplyLanguageText(
				"本轮预期是推箱，但实际只移动了玩家；这是站位或推向错误，不是目标进展。",
				"This round intended a box push, but only the player moved; this is a stance/direction error, not goal progress.",
			),
		),
		nextHint: combineHints(
			reflection.nextHint,
			buildSokobanPushGeometryHint(actionId),
		),
	};
}

function applyEvaluatorHierarchyGuard(
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null,
): ProgressEvaluatorDecision {
	if (!gameContext || hasBoardTaskCompletionEvidence(reflection) || isSokobanMissionComplete(reflection)) {
		return reflection;
	}
	let next = { ...reflection };
	if (!next.expectedMet) {
		next.wasActionCorrect = false;
		if (next.goalProgress === "done") {
			next.goalProgress = "partial";
		}
		if (next.goalAlignment === "achieved") {
			next.goalAlignment = next.actionSucceeded ? "closer" : "unchanged";
		}
	}
	const joinedAssessment = normalizeStateSketchText([
		next.expectationReview,
		next.phaseAssessment,
		next.planAssessment,
		next.stateDelta,
	].join(" "));
	const saysDidNotAdvance = /didnotadvance|notadvance|notprogress|lostsetup|setup.*lost|phase.*didnot|没有推进|未推进|没有达成|未达成|站位.*丢失/.test(joinedAssessment);
	if (!next.expectedMet && saysDidNotAdvance) {
		next = {
			...next,
			wasActionCorrect: false,
			goalAlignment: next.goalAlignment === "deviated" ? "deviated" : "unchanged",
			goalProgress: "none",
			phaseStatus: next.phaseStatus === "blocked" ? "blocked" : "stalled",
			planViability: next.planViability === "invalidated" ? "invalidated" : "weakened",
		};
	}
	return next;
}

function getSokobanMoveActionId(action: DelegatedTaskAction): string {
	if (action.tool === "game.perform_action") {
		return normalizeGameActionId(toText((action.args as Record<string, unknown>)?.actionId));
	}
	if (action.tool === "host.send_key") {
		return normalizeGameActionId(toText((action.args as Record<string, unknown>)?.key));
	}
	return "";
}

function isFailedFinalPushEvidence(reflection: ProgressEvaluatorDecision): boolean {
	if (reflection.expectedMet || reflection.goalProgress === "done" || reflection.goalAlignment === "achieved") {
		return false;
	}
	const joined = normalizeStateSketchText([
		reflection.expectationReview,
		reflection.phaseAssessment,
		reflection.planAssessment,
		reflection.stateDelta,
	].join(" "));
	return /only.*player.*moved|onlytheplayermoved|nobox.*push|boxwasnotpushed|didnotgetpushed|notpushedont|finishingpush.*incorrect|pushdirection.*incorrect|presumedfinishingpushdirectionwasincorrect|没有推|未推动|只移动了玩家|推箱方向错误/.test(joined);
}

function isPushingAwayFromPlayerTarget(sketch: string, actionId: string): boolean {
	const rows = extractGridRows(sketch);
	if (!rows.length) {
		return false;
	}
	if (actionId === "move_right") {
		return rows.some((row) => row.includes("+B") || row.includes("TPB"));
	}
	if (actionId === "move_left") {
		return rows.some((row) => row.includes("B+") || row.includes("BPT"));
	}
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex] ?? "";
		for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
			if (actionId === "move_down") {
				if (row[colIndex] === "+" && rows[rowIndex + 1]?.[colIndex] === "B") {
					return true;
				}
				if (row[colIndex] === "T" && rows[rowIndex + 1]?.[colIndex] === "P" && rows[rowIndex + 2]?.[colIndex] === "B") {
					return true;
				}
			}
			if (actionId === "move_up") {
				if (row[colIndex] === "B" && rows[rowIndex + 1]?.[colIndex] === "+") {
					return true;
				}
				if (row[colIndex] === "B" && rows[rowIndex + 1]?.[colIndex] === "P" && rows[rowIndex + 2]?.[colIndex] === "T") {
					return true;
				}
			}
		}
	}
	return false;
}

function buildSokobanPushTargetDirectionHint(actionId: string): string {
	const suffix = pickReplyLanguageText(
		"当前具体收尾推法已被否决；不要继续修补同一最后推法。若无法立即绕到正确推箱侧，请点击右上角紫红色/偏粉红色重置按钮重开。",
		"The current concrete finishing push is invalidated; do not keep patching the same final push. If you cannot immediately route to the correct push side, click the purple-pink restart button in the upper-right corner.",
	);
	if (actionId === "move_right") {
		return pickReplyLanguageText(
			`如果目标在箱子左侧，不能从左侧向右推；必须先绕到箱子右侧，再执行 move_left 把箱子推回目标。${suffix}`,
			`If the target is left of the box, do not push right from the left side; first route to the box's right side, then use move_left to push it back onto the target. ${suffix}`,
		);
	}
	if (actionId === "move_left") {
		return pickReplyLanguageText(
			`如果目标在箱子右侧，不能从右侧向左推；必须先绕到箱子左侧，再执行 move_right 把箱子推回目标。${suffix}`,
			`If the target is right of the box, do not push left from the right side; first route to the box's left side, then use move_right to push it back onto the target. ${suffix}`,
		);
	}
	if (actionId === "move_down") {
		return pickReplyLanguageText(
			`如果目标在箱子上方，不能从上方向下推；必须先绕到箱子下方，再执行 move_up 把箱子推回目标。${suffix}`,
			`If the target is above the box, do not push down from above; first route below the box, then use move_up to push it back onto the target. ${suffix}`,
		);
	}
	if (actionId === "move_up") {
		return pickReplyLanguageText(
			`如果目标在箱子下方，不能从下方向上推；必须先绕到箱子上方，再执行 move_down 把箱子推回目标。${suffix}`,
			`If the target is below the box, do not push up from below; first route above the box, then use move_down to push it back onto the target. ${suffix}`,
		);
	}
	return pickReplyLanguageText(
		`重新确认目标、P、箱子的相对位置：要把箱子推到目标上，P 必须站在箱子与目标相反的一侧，然后朝目标方向推。${suffix}`,
		`Reconfirm target/P/box geometry: to push a box onto a target, P must stand on the opposite side of the box and push toward the target. ${suffix}`,
	);
}

function buildSokobanPushGeometryHint(actionId: string): string {
	const directionRule = actionId === "move_left"
		? pickReplyLanguageText(
			"若要让箱子向左，P 必须先站到箱子右侧，再执行 move_left。",
			"To move a box left, P must first stand on the box's right side, then execute move_left.",
		)
		: actionId === "move_right"
			? pickReplyLanguageText(
				"若要让箱子向右，P 必须先站到箱子左侧，再执行 move_right。",
				"To move a box right, P must first stand on the box's left side, then execute move_right.",
			)
			: actionId === "move_up"
				? pickReplyLanguageText(
					"若要让箱子向上，P 必须先站到箱子下方，再执行 move_up。",
					"To move a box up, P must first stand below the box, then execute move_up.",
				)
				: actionId === "move_down"
					? pickReplyLanguageText(
						"若要让箱子向下，P 必须先站到箱子上方，再执行 move_down。",
						"To move a box down, P must first stand above the box, then execute move_down.",
					)
					: pickReplyLanguageText(
						"推箱前必须重新确认 P、箱子、目标三者方向关系。",
						"Before pushing, reconfirm the directional relationship between P, the box, and the target.",
					);
	return pickReplyLanguageText(
		`${directionRule} 下一轮先写清“目标箱子、目标方向、P 所需站位、P 当前站位”，若当前站位不满足，只做走位，不要把整条高层路线判死。`,
		`${directionRule} Next round, explicitly state target box, target direction, required P side, and current P side. If the current stance is wrong, only reposition; do not invalidate the whole high-level route.`,
	);
}

function hasNoChangeEvidence(reflection: ProgressEvaluatorDecision): boolean {
	const stateDelta = normalizeStateSketchText(reflection.stateDelta);
	if (/(无(?:可确认)?变化|基本没变|no(?:[a-z]+)?change|unchanged|novisiblechange|static)/i.test(stateDelta)) {
		return true;
	}
	const beforeGrid = extractGridSignature(reflection.beforeStateSketch);
	const afterGrid = extractGridSignature(reflection.afterStateSketch);
	if (beforeGrid && afterGrid) {
		return beforeGrid === afterGrid;
	}
	const beforeSketch = normalizeStateSketchText(reflection.beforeStateSketch);
	const afterSketch = normalizeStateSketchText(reflection.afterStateSketch);
	return Boolean(beforeSketch && afterSketch && beforeSketch === afterSketch);
}

function extractGridSignature(sketch: string): string {
	const rows = extractGridRows(sketch);
	if (rows.length < 2) {
		return "";
	}
	return rows.map((r) => r.replace(/\s+/g, "").toLowerCase()).join("|");
}

function extractGridRows(sketch: string): string[] {
	return sketch
		.split(/[\n\r]+/)
		.map((row) => row.replace(/[^#.PBTW_*+\s]/gi, "").trim())
		.filter((row) => row.length > 0 && /[#.PBTW_*+]/i.test(row))
		.map((row) => row.replace(/\s+/g, "").toUpperCase().replace(/W/g, "#").replace(/_/g, "."));
}

function hasBoardTaskCompletionEvidence(reflection: ProgressEvaluatorDecision): boolean {
	const joined = normalizeStateSketchText([
		reflection.expectationReview,
		reflection.afterStateSketch,
		reflection.stateDelta,
		reflection.nextHint,
	].join(" "));
	return /(levelcomplete|overlayshown|missionasfinished|taskcomplete|levelcleared|leveladvanced|successanimation|levelsolvedtransition)/i.test(joined);
}

function isSokobanMissionComplete(reflection: ProgressEvaluatorDecision): boolean {
	if (hasBoardTaskCompletionEvidence(reflection)) {
		return true;
	}
	const afterGrid = extractGridSignature(reflection.afterStateSketch);
	if (!afterGrid) {
		return false;
	}
	const remainingTargets = (afterGrid.match(/t/g) ?? []).length;
	const boxCoveredTargets = (afterGrid.match(/\*/g) ?? []).length;
	return remainingTargets === 0 && boxCoveredTargets > 0;
}

function detectSokobanDeadlock(
	beforeStateSketch: string,
	afterStateSketch: string,
	_stateDelta: string,
): { reason: string } | null {
	const afterRows = extractGridRows(afterStateSketch);
	const beforeRows = extractGridRows(beforeStateSketch);
	const beforeBoxes = extractBoxPositions(beforeRows);
	const afterBoxes = extractBoxPositions(afterRows);
	if (!afterBoxes.length) {
		return null;
	}
	if (beforeBoxes.length === afterBoxes.length && beforeBoxes.join("|") === afterBoxes.join("|")) {
		return null;
	}
	const beforeDeadlock = detectSokobanDeadlockInRows(beforeRows);
	const afterDeadlock = detectSokobanDeadlockInRows(afterRows);
	if (!afterDeadlock) {
		return null;
	}
	if (beforeDeadlock && beforeDeadlock.reason === afterDeadlock.reason) {
		return null;
	}
	return afterDeadlock;
}

function detectSokobanDeadlockInRows(rows: string[]): { reason: string } | null {
	if (rows.length < 2) {
		return null;
	}
	const grid = rows.map((row) => row.split(""));
	const height = grid.length;
	const width = Math.max(...grid.map((row) => row.length));
	const getCell = (r: number, c: number): string => {
		if (r < 0 || r >= height || c < 0) {
			return "#";
		}
		const row = grid[r];
		if (!row || c >= row.length) {
			return "#";
		}
		return row[c] ?? "#";
	};
	const isBlocked = (cell: string): boolean => cell === "#" || cell === "*";
	for (let r = 0; r < height; r += 1) {
		for (let c = 0; c < width; c += 1) {
			const cell = getCell(r, c);
			if (cell !== "B") {
				continue;
			}
			const leftBlocked = isBlocked(getCell(r, c - 1));
			const rightBlocked = isBlocked(getCell(r, c + 1));
			const upBlocked = isBlocked(getCell(r - 1, c));
			const downBlocked = isBlocked(getCell(r + 1, c));
			const stuckInCornerLikeSpot = (leftBlocked || rightBlocked) && (upBlocked || downBlocked);
			if (stuckInCornerLikeSpot) {
				return {
					reason: `普通箱子 B 被推到阻塞位（r${r + 1},c${c + 1}），相邻墙体/已完成箱子形成角落式死局`,
				};
			}
		}
	}
	return null;
}

function extractBoxPositions(rows: string[]): string[] {
	const positions: string[] = [];
	for (let r = 0; r < rows.length; r += 1) {
		for (let c = 0; c < rows[r]!.length; c += 1) {
			if (rows[r]![c] === "B") {
				positions.push(`r${r + 1}c${c + 1}`);
			}
		}
	}
	return positions;
}

function hasBoardTaskPositiveMovementEvidence(reflection: ProgressEvaluatorDecision): boolean {
	if (hasNoChangeEvidence(reflection) || hasBoardTaskCompletionEvidence(reflection)) {
		return false;
	}
	const joined = normalizeStateSketchText([
		reflection.expectationReview,
		reflection.stateDelta,
	].join(" "));
	return /(\bp\s*moved\b|\bb\s*moved\b|playermoved|boxmoved|movedonetile|movedtwofloortiles|pushed)/i.test(joined);
}

function didBoardTaskMakeProgress(reflection: ProgressEvaluatorDecision): boolean {
	return hasBoardTaskCompletionEvidence(reflection)
		|| (reflection.actionSucceeded
			&& reflection.wasActionCorrect
			&& (reflection.goalAlignment === "closer" || reflection.goalAlignment === "achieved")
			&& (reflection.goalProgress === "partial" || reflection.goalProgress === "done"))
		|| hasBoardTaskPositiveMovementEvidence(reflection);
}

function normalizeStateSketchText(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "")
		.replace(/[，。；：、,.!?！？|]/g, "");
}

function buildExecutableActionPlan(action: DelegatedTaskAction, target: FunctionalTarget): ExecutableActionPlan {
	if (action.tool !== "host.paste_text") {
		return {
			primary: action,
			followUps: [],
			actionForEvaluation: action,
		};
	}
	const originalText = toText(action.args.text);
	if (!originalText) {
		return {
			primary: action,
			followUps: [],
			actionForEvaluation: action,
		};
	}
	const macroParse = parseInlineSubmitKeys(originalText);
	if (!macroParse.keys.length) {
		return {
			primary: action,
			followUps: [],
			actionForEvaluation: action,
		};
	}
	const targetHandle = typeof action.args.targetHandle === "string" && action.args.targetHandle.trim()
		? action.args.targetHandle
		: target.handle;
	const targetTitle = typeof action.args.targetTitle === "string" && action.args.targetTitle.trim()
		? action.args.targetTitle
		: target.title;
	const primaryArgs = {
		...action.args,
		text: macroParse.cleanedText || originalText.replace(/\{[^}]+\}/g, "").trim(),
		targetHandle,
		targetTitle,
	};
	const followUps = macroParse.keys.map((key) => ({
		tool: "host.send_key",
		args: {
			key,
			targetHandle,
			targetTitle,
		},
	}));
	const primary = toText(primaryArgs.text)
		? { tool: "host.paste_text", args: primaryArgs }
		: (followUps.shift() ?? action);
	const actionForEvaluation: DelegatedTaskAction = {
		tool: action.tool,
		args: {
			...primaryArgs,
			inlineSubmitKeys: macroParse.keys.join(","),
		},
	};
	return {
		primary,
		followUps,
		actionForEvaluation,
	};
}

function parseInlineSubmitKeys(text: string): { cleanedText: string; keys: string[] } {
	const keys: string[] = [];
	const cleanedText = text
		.replace(/\{([^}]+)\}/g, (matched, tokenRaw: string) => {
			const normalized = normalizeHostKey(tokenRaw);
			if (!normalized) {
				return matched;
			}
			const lowered = normalized.toLowerCase();
			if (lowered !== "enter" && lowered !== "return" && lowered !== "tab") {
				return matched;
			}
			keys.push(normalized);
			return "";
		})
		.replace(/\s{2,}/g, " ")
		.trim();
	return { cleanedText, keys };
}

async function resolveActionWithLocator(input: {
	action: DelegatedTaskAction;
	config: DelegatedTaskProfileConfig;
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
	beforeSnapshot: CapturedTargetSnapshot;
	round: number;
}): Promise<DelegatedTaskAction> {
	if (input.action.tool !== "host.send_mouse") {
		return input.action;
	}
	const args = { ...input.action.args };
	const plannerX = toFiniteNumber(args.x);
	const plannerY = toFiniteNumber(args.y);
	const plannerXNorm = toUnitNumber(args.xNorm);
	const plannerYNorm = toUnitNumber(args.yNorm);
	const locatorHint = toText(args.locatorHint);

	// If the planner provided a locatorHint, always run the locator ladder first.
	// The locator (local vision consensus) has better spatial precision than
	// the planner's raw coordinate guess from screenshot viewing.
	if (locatorHint) {
		const decision = await resolveLocatorCoordinatesWithLadder({
			config: input.config,
			target: input.target,
			mission: input.mission,
			beforeSnapshot: input.beforeSnapshot,
			locatorHint,
			allowLocalFallback: args.allowLocalVisionFallback !== false,
		});
		if (decision) {
			args.x = decision.x;
			args.y = decision.y;
			args.xNorm = decision.xNorm;
			args.yNorm = decision.yNorm;
			args.locatorTier = decision.tier;
			args.locatorConfidence = decision.confidence;
			args.locatorReason = decision.reason;
			log.info("locator ladder resolved coordinate", {
				round: input.round,
				target: input.target.title,
				locatorHint,
				tier: decision.tier,
				confidence: decision.confidence,
				x: decision.x,
				y: decision.y,
			});
			return { tool: input.action.tool, args };
		}
		log.warn("locator ladder failed, falling back to planner coordinates", {
			round: input.round,
			target: input.target.title,
			locatorHint,
		});
	}

	// Fallback: use planner-supplied coordinates when no locatorHint or locator failed.
	if (plannerX !== null && plannerY !== null) {
		args.x = Math.round(plannerX);
		args.y = Math.round(plannerY);
		return { tool: input.action.tool, args };
	}
	if (plannerXNorm !== null && plannerYNorm !== null) {
		args.x = denormalizeCoordinate(plannerXNorm, input.beforeSnapshot.width);
		args.y = denormalizeCoordinate(plannerYNorm, input.beforeSnapshot.height);
		return { tool: input.action.tool, args };
	}

	return { tool: input.action.tool, args };
}

async function resolveLocatorCoordinatesWithLadder(input: {
	config: DelegatedTaskProfileConfig;
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
	beforeSnapshot: CapturedTargetSnapshot;
	locatorHint: string;
	allowLocalFallback: boolean;
}): Promise<LocatorCoordinateDecision | null> {
	if (input.allowLocalFallback && input.config.locatorLocalFallbackEnabled) {
		const consensusDecision = await resolveLocatorFromConsensusTool(input).catch((err) => {
			log.warn("locator consensus tool failed", {
				error: err instanceof Error ? err.message : String(err),
				target: input.target.title,
				locatorHint: input.locatorHint,
			});
			return null;
		});
		if (consensusDecision) {
			const correctedConsensusDecision = applyLocatorCoordinateCorrections(
				consensusDecision,
				input.locatorHint,
				input.beforeSnapshot,
			);
			if (correctedConsensusDecision.confidence >= input.config.locatorMinConfidence) {
				return correctedConsensusDecision;
			}
		}
		const localDecision = await resolveLocatorFromLocalVision(input).catch((err) => {
			log.warn("local locator failed", {
				error: err instanceof Error ? err.message : String(err),
				target: input.target.title,
				locatorHint: input.locatorHint,
			});
			return null;
		});
		if (localDecision) {
			const correctedLocalDecision = applyLocatorCoordinateCorrections(
				localDecision,
				input.locatorHint,
				input.beforeSnapshot,
			);
			if (correctedLocalDecision.confidence >= input.config.locatorMinConfidence) {
				return correctedLocalDecision;
			}
		}
	}

	if (input.config.locatorRulesEnabled) {
		const ruleDecision = resolveRuleBasedLocator(input.locatorHint, input.beforeSnapshot);
		if (ruleDecision) {
			const correctedRuleDecision = applyLocatorCoordinateCorrections(
				ruleDecision,
				input.locatorHint,
				input.beforeSnapshot,
			);
			if (correctedRuleDecision.confidence >= input.config.locatorMinConfidence) {
				return correctedRuleDecision;
			}
		}
	}

	if (input.config.locatorCloudEnabled) {
		const cloudDecision = await resolveLocatorFromCloudVision(input).catch((err) => {
			log.warn("cloud locator failed", {
				error: err instanceof Error ? err.message : String(err),
				target: input.target.title,
				locatorHint: input.locatorHint,
			});
			return null;
		});
		if (cloudDecision) {
			const correctedCloudDecision = applyLocatorCoordinateCorrections(
				cloudDecision,
				input.locatorHint,
				input.beforeSnapshot,
			);
			if (correctedCloudDecision.confidence >= input.config.locatorMinConfidence) {
				return correctedCloudDecision;
			}
		}
	}

	return null;
}

function resolveRuleBasedLocator(
	locatorHint: string,
	snapshot: CapturedTargetSnapshot,
): LocatorCoordinateDecision | null {
	const normalized = locatorHint.trim().toLowerCase();
	if (!normalized) {
		return null;
	}

	const width = snapshot.width;
	const height = snapshot.height;
	if (/(地址栏|url|网址|omnibox|导航栏)/i.test(normalized)) {
		const x = Math.round(width * 0.22);
		const y = Math.max(10, Math.round(height * 0.025));
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.8, "rule: browser address bar");
	}
	if (/(google.*搜索框|google.*search|搜索框|search\s*box|query\s*input|输入框)/i.test(normalized)) {
		const x = Math.round(width * 0.5);
		const y = Math.round(height * 0.32);
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.74, "rule: page search input");
	}
	if (/(first\s*result|第一条|首条|第一个结果|第一個結果)/i.test(normalized)) {
		const x = Math.round(width * 0.34);
		const y = Math.round(height * 0.37);
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.7, "rule: first search result area");
	}
	if (/(new\s*repo|new\s*repository|新建仓库|新仓库|创建仓库)/i.test(normalized)) {
		const x = Math.round(width * 0.12);
		const y = Math.round(height * 0.1);
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.68, "rule: repository creation button");
	}
	if (/(repository entry|repo entry|仓库条目|仓库入口|具体仓库)/i.test(normalized)) {
		const x = Math.round(width * 0.08);
		const y = Math.round(height * 0.16);
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.67, "rule: repository list entry area");
	}
	if (/(next|继续|下一步|continue|start|开始按钮)/i.test(normalized)) {
		const x = Math.round(width * 0.72);
		const y = Math.round(height * 0.86);
		return buildLocatorDecisionFromPixels("rule", x, y, width, height, 0.62, "rule: lower-right CTA area");
	}
	return null;
}

// --- Board observation capture (pre-round perception) ---

async function captureBoardObservation(
	snapshot: CapturedTargetSnapshot,
	target: FunctionalTarget,
	mission: MissionAnalysisDecision,
	config: DelegatedTaskProfileConfig,
): Promise<BoardObservation> {
	if (!config.boardPerceptionPrompt) {
		log.info("[diag] captureBoardObservation skipped — boardPerceptionPrompt is empty");
		return emptyBoardObservation(snapshot);
	}
	if (config.visionPreprocess.enabled && !hasBrowserImagePreprocessingSupport()) {
		log.info("[diag] captureBoardObservation skipped — vision preprocessing requires browser DOM");
		return emptyBoardObservation(snapshot);
	}
	try {
		const processed = await preprocessSnapshotForVision(snapshot, config);
		const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
		const rawText = await requestActiveVisionDecision({
			systemPrompt: [
				"You are a game board parser.",
				"Given a screenshot from a puzzle game, extract the exact structured board state.",
				"Use # for wall, . for floor, P for player, B for box, T for target, * for box-on-target, + for player-on-target.",
				"Count exact rows and columns. Do not guess dimensions; use low confidence if uncertain.",
				"Return JSON only.",
			].join("\n"),
			userPrompt: [
				`target: ${target.title} (${target.handle})`,
				`missionGoal: ${mission.missionGoal}`,
				"Output shape:",
				'{ "boardGrid": "ASCII grid", "entities": ["P=r2c2"], "confidence": "high|medium|low", "ambiguities": ["string"] }',
				config.boardPerceptionPrompt,
			].join("\n"),
			imageDataUrls: [processed.dataUrl],
			maxTokens: 700,
			temperature: 0,
			timeoutMs: 25_000,
			jsonResponse: true,
			thinkingMode: "off",
			telemetry: {
				role: "board-parser",
				source: "delegation",
				taskKind: mission.taskMode,
			},
		});
		const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
		const parsed = parseJsonObject(rawText);
		const gridText = toText(parsed.boardGrid || parsed.grid || parsed.board);
		const gridLines = normalizeBoardGridLines(gridText);
		const result = gridLines.join("\n");
		const confidence = normalizeBoardConfidence(toText(parsed.confidence), result);
		const observation: BoardObservation = {
			boardGrid: confidence === "low" ? "" : result,
			entities: toStringArray(parsed.entities).slice(0, 24),
			confidence,
			ambiguities: toStringArray(parsed.ambiguities).slice(0, 8),
			source: "cloud",
			originalWidth: snapshot.width,
			originalHeight: snapshot.height,
			processedWidth: processed.width,
			processedHeight: processed.height,
			preprocessed: processed.preprocessed,
		};
		log.info("[diag] captureBoardObservation completed", {
			confidence: observation.confidence,
			lineCount: gridLines.length,
			gridPreview: observation.boardGrid.slice(0, 200),
			entityCount: observation.entities.length,
			ambiguityCount: observation.ambiguities.length,
			elapsedMs: Math.round(elapsedMs),
			originalWidth: observation.originalWidth,
			originalHeight: observation.originalHeight,
			processedWidth: observation.processedWidth,
			processedHeight: observation.processedHeight,
			preprocessed: observation.preprocessed,
			preprocessMode: config.visionPreprocess.mode,
		});
		return observation;
	} catch (err) {
		log.warn("board observation capture failed", { error: err instanceof Error ? err.message : String(err) });
		return emptyBoardObservation(snapshot);
	}
}

async function captureInitialBoardObservation(
	snapshot: CapturedTargetSnapshot,
	target: FunctionalTarget,
	mission: MissionAnalysisDecision,
	config: DelegatedTaskProfileConfig,
	gameContext: DelegatedGameContext,
): Promise<BoardObservation> {
	const maxAttempts = gameContext.gameId === "sokoban" ? 3 : 1;
	let bestObservation: BoardObservation | null = null;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const observation = await captureBoardObservation(snapshot, target, mission, config);
		if (!bestObservation || scoreInitialBoardObservation(observation, gameContext) > scoreInitialBoardObservation(bestObservation, gameContext)) {
			bestObservation = observation;
		}
		if (canLockInitialBoardTopology(gameContext, observation.boardGrid)) {
			if (attempt > 1) {
				log.info("[diag] initial board observation accepted after retry", {
					gameId: gameContext.gameId,
					attempt,
					gridPreview: observation.boardGrid.slice(0, 200),
				});
			}
			return observation;
		}
		log.warn("[diag] initial board observation not lockable", {
			gameId: gameContext.gameId,
			attempt,
			maxAttempts,
			reason: describeInitialBoardLockIssue(gameContext, observation.boardGrid),
			gridPreview: observation.boardGrid.slice(0, 200),
		});
	}
	return bestObservation ?? emptyBoardObservation(snapshot);
}

function emptyBoardObservation(snapshot: CapturedTargetSnapshot): BoardObservation {
	return {
		boardGrid: "",
		entities: [],
		confidence: "low",
		ambiguities: [],
		source: "none",
		originalWidth: snapshot.width,
		originalHeight: snapshot.height,
		processedWidth: snapshot.width,
		processedHeight: snapshot.height,
		preprocessed: false,
	};
}

function normalizeBoardGridLines(gridText: string): string[] {
	const gridLines = gridText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^[#.PBT*+\d\s]+$/.test(line) && line.length > 0)
		.map((line) => /\d/.test(line) ? line.replace(/\s+/g, " ") : line.replace(/\s+/g, ""));
	if (gridLines.length > 24) {
		return [];
	}
	return gridLines;
}

function normalizeBoardConfidence(rawConfidence: string, boardGrid: string): BoardObservationConfidence {
	const normalized = rawConfidence.trim().toLowerCase();
	if (!boardGrid) {
		return "low";
	}
	if (normalized === "high" || normalized === "medium" || normalized === "low") {
		return normalized;
	}
	return "medium";
}

interface SokobanBoardState {
	topology: string;
	currentBoard: string;
	player: string | null;
	playerCount: number;
	boxes: string[];
	targetCount: number;
	boxCount: number;
	warnings: string[];
}

function buildInitialCanonicalBoard(
	gameContext: DelegatedGameContext | null,
	mission: MissionAnalysisDecision,
	observation: BoardObservation,
): SokobanBoardState | null {
	if (gameContext?.gameId !== "sokoban") {
		return null;
	}
	const missionGrid = normalizeBoardGridLines(mission.initialStateSketch).join("\n");
	const sourceGrid = missionGrid || observation.boardGrid;
	const parsed = parseSokobanBoardState(sourceGrid);
	if (!parsed || !isLockableSokobanBoardState(parsed)) {
		log.warn("[diag] initial Sokoban topology lock skipped", {
			reason: describeSokobanBoardLockIssue(parsed),
			missionGridPreview: missionGrid.slice(0, 200),
			observationGridPreview: observation.boardGrid.slice(0, 200),
		});
		return null;
	}
	return parsed;
}

function canLockInitialBoardTopology(gameContext: DelegatedGameContext | null, boardGrid: string): boolean {
	if (gameContext?.gameId !== "sokoban") {
		return Boolean(boardGrid);
	}
	return isLockableSokobanBoardState(parseSokobanBoardState(boardGrid));
}

function scoreInitialBoardObservation(observation: BoardObservation, gameContext: DelegatedGameContext | null): number {
	if (gameContext?.gameId !== "sokoban") {
		return observation.boardGrid ? 1 : 0;
	}
	const parsed = parseSokobanBoardState(observation.boardGrid);
	if (!parsed) {
		return 0;
	}
	let score = 0;
	if (parsed.playerCount === 1) score += 3;
	if (parsed.boxCount >= 1) score += 2;
	if (parsed.targetCount === parsed.boxCount && parsed.boxCount >= 1) score += 4;
	score += Math.min(parsed.targetCount, parsed.boxCount);
	return score;
}

function describeInitialBoardLockIssue(gameContext: DelegatedGameContext | null, boardGrid: string): string {
	if (gameContext?.gameId !== "sokoban") {
		return boardGrid ? "" : "empty board";
	}
	return describeSokobanBoardLockIssue(parseSokobanBoardState(boardGrid));
}

function isLockableSokobanBoardState(state: SokobanBoardState | null): boolean {
	return Boolean(state && state.playerCount === 1 && state.boxCount >= 1 && state.targetCount === state.boxCount);
}

function describeSokobanBoardLockIssue(state: SokobanBoardState | null): string {
	if (!state) {
		return "invalid or empty Sokoban board";
	}
	const issues: string[] = [];
	if (state.playerCount !== 1) issues.push(`expected 1 player but saw ${state.playerCount}`);
	if (state.boxCount < 1) issues.push(`expected at least 1 box but saw ${state.boxCount}`);
	if (state.targetCount !== state.boxCount) issues.push(`expected targets (${state.targetCount}) to equal boxes (${state.boxCount})`);
	return issues.join("; ") || "none";
}

function reconcileBoardObservationWithRouteState(
	routeState: DelegationRouteState | null,
	observation: BoardObservation,
	gameContext: DelegatedGameContext | null,
): BoardObservation {
	if (gameContext?.gameId !== "sokoban" || !routeState?.topologyLocked || !routeState.canonicalTopology) {
		return observation;
	}
	const reconciled = reconcileSokobanDynamicBoard(routeState, observation.boardGrid);
	const warnings = [
		...observation.ambiguities,
		...reconciled.warnings,
	].slice(0, 12);
	if (reconciled.warnings.length > 0) {
		log.info("[diag] board observation reconciled with locked topology", {
			gameId: gameContext.gameId,
			warnings: reconciled.warnings,
			rawPreview: observation.boardGrid.slice(0, 200),
			canonicalPreview: (reconciled.boardGrid || routeState.currentBoard).slice(0, 200),
		});
	}
	return {
		...observation,
		boardGrid: reconciled.boardGrid || routeState.currentBoard,
		confidence: reconciled.boardGrid ? observation.confidence : "low",
		ambiguities: warnings,
	};
}

function updateRouteStateFromObservation(
	routeState: DelegationRouteState | null,
	reconciledObservation: BoardObservation,
	rawObservation: BoardObservation,
): DelegationRouteState | null {
	if (!routeState) {
		return null;
	}
	if (!routeState.topologyLocked) {
		return {
			...routeState,
			currentBoard: reconciledObservation.boardGrid || routeState.currentBoard,
			latestRawBoard: rawObservation.boardGrid || routeState.latestRawBoard,
			boardObservationWarnings: reconciledObservation.ambiguities,
		};
	}
	return {
		...routeState,
		currentBoard: reconciledObservation.boardGrid || routeState.currentBoard,
		latestRawBoard: rawObservation.boardGrid || routeState.latestRawBoard,
		boardObservationWarnings: reconciledObservation.ambiguities,
	};
}

function reconcileSokobanDynamicBoard(
	routeState: DelegationRouteState,
	rawBoardGrid: string,
): { boardGrid: string; warnings: string[] } {
	const warnings: string[] = [];
	if (!routeState.canonicalTopology) {
		return { boardGrid: rawBoardGrid, warnings };
	}
	const rawState = parseSokobanBoardState(rawBoardGrid);
	const currentState = parseSokobanBoardState(routeState.currentBoard);
	if (!rawState) {
		warnings.push("raw board rejected: parser output is not a valid Sokoban grid; keeping canonical dynamic state");
		return { boardGrid: routeState.currentBoard, warnings };
	}
	const topologyRows = routeState.canonicalTopology.split("\n");
	const rawRows = rawState.currentBoard.split("\n");
	if (rawRows.length !== topologyRows.length || rawRows.some((line, index) => line.length !== topologyRows[index]?.length)) {
		warnings.push("raw board rejected: dimensions differ from locked mission topology");
		return { boardGrid: routeState.currentBoard, warnings };
	}
	const expectedBoxes = currentState?.boxCount || parseSokobanBoardState(routeState.canonicalInitialBoard || "")?.boxCount || rawState.boxCount;
	if (!rawState.player) {
		warnings.push("raw board rejected: missing player");
		return { boardGrid: routeState.currentBoard, warnings };
	}
	if (expectedBoxes > 0 && rawState.boxCount !== expectedBoxes) {
		warnings.push(`raw board rejected: expected ${expectedBoxes} boxes but saw ${rawState.boxCount}`);
		return { boardGrid: routeState.currentBoard, warnings };
	}
	const canonical = composeSokobanBoard(routeState.canonicalTopology, rawState.player, rawState.boxes);
	const rawTopology = rawState.topology;
	if (rawTopology !== routeState.canonicalTopology) {
		warnings.push("raw board topology differed; kept mission topology and only merged P/B dynamics");
	}
	return { boardGrid: canonical, warnings };
}

function parseSokobanBoardState(boardGrid: string): SokobanBoardState | null {
	const rows = normalizeBoardGridLines(boardGrid);
	if (!rows.length || rows.some((row) => !/^[#.PBT*+]+$/.test(row))) {
		return null;
	}
	const topologyRows: string[] = [];
	const boxes: string[] = [];
	let player: string | null = null;
	let playerCount = 0;
	let targetCount = 0;
	const warnings: string[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex] ?? "";
		let topologyRow = "";
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const char = row[columnIndex];
			const position = `${rowIndex}:${columnIndex}`;
			if (char === "#") {
				topologyRow += "#";
				continue;
			}
			if (char === "T" || char === "*" || char === "+") {
				targetCount += 1;
				topologyRow += "T";
			} else {
				topologyRow += ".";
			}
			if (char === "P" || char === "+") {
				playerCount += 1;
				if (player) {
					warnings.push("multiple players detected");
				}
				player = position;
			}
			if (char === "B" || char === "*") {
				boxes.push(position);
			}
		}
		topologyRows.push(topologyRow);
	}
	return {
		topology: topologyRows.join("\n"),
		currentBoard: composeSokobanBoard(topologyRows.join("\n"), player, boxes),
		player,
		playerCount,
		boxes,
		targetCount,
		boxCount: boxes.length,
		warnings,
	};
}

function composeSokobanBoard(topology: string, player: string | null, boxes: string[]): string {
	const boxSet = new Set(boxes);
	const rows = topology.split("\n");
	return rows.map((row, rowIndex) => {
		let result = "";
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const position = `${rowIndex}:${columnIndex}`;
			const topologyChar = row[columnIndex] === "#" ? "#" : row[columnIndex] === "T" ? "T" : ".";
			if (boxSet.has(position)) {
				result += topologyChar === "T" ? "*" : "B";
			} else if (player === position) {
				result += topologyChar === "T" ? "+" : "P";
			} else {
				result += topologyChar;
			}
		}
		return result;
	}).join("\n");
}

async function preprocessSnapshotForVision(
	snapshot: CapturedTargetSnapshot,
	config: DelegatedTaskProfileConfig,
): Promise<{ dataUrl: string; width: number; height: number; preprocessed: boolean }> {
	if (!config.visionPreprocess.enabled || config.visionPreprocess.mode === "none") {
		return {
			dataUrl: snapshot.dataUrl,
			width: snapshot.width,
			height: snapshot.height,
			preprocessed: false,
		};
	}
	if (!hasBrowserImagePreprocessingSupport()) {
		log.info("vision preprocessing skipped outside browser DOM");
		return {
			dataUrl: snapshot.dataUrl,
			width: snapshot.width,
			height: snapshot.height,
			preprocessed: false,
		};
	}
	const image = await loadDataUrlImage(snapshot.dataUrl);
	const crop = config.visionPreprocess.crop;
	const sourceX = Math.round(snapshot.width * crop.xNorm);
	const sourceY = Math.round(snapshot.height * crop.yNorm);
	const sourceWidth = Math.max(1, Math.round(snapshot.width * Math.min(crop.widthNorm, 1 - crop.xNorm)));
	const sourceHeight = Math.max(1, Math.round(snapshot.height * Math.min(crop.heightNorm, 1 - crop.yNorm)));
	const scale = config.visionPreprocess.mode === "crop-resize"
		? Math.min(
			1,
			config.visionPreprocess.maxWidth / sourceWidth,
			config.visionPreprocess.maxHeight / sourceHeight,
		)
		: 1;
	const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
	const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
	const canvas = document.createElement("canvas");
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("2d canvas context unavailable for vision preprocessing");
	}
	context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
	const mime = config.visionPreprocess.format === "jpeg" ? "image/jpeg" : "image/png";
	const dataUrl = config.visionPreprocess.format === "jpeg"
		? canvas.toDataURL(mime, config.visionPreprocess.quality)
		: canvas.toDataURL(mime);
	return {
		dataUrl,
		width: targetWidth,
		height: targetHeight,
		preprocessed: true,
	};
}

async function preprocessSnapshotForRoleVision(
	snapshot: CapturedTargetSnapshot,
	config: DelegatedTaskProfileConfig,
): Promise<CapturedTargetSnapshot> {
	try {
		const processed = await preprocessSnapshotForVision(snapshot, config);
		return {
			dataUrl: processed.dataUrl,
			width: processed.width,
			height: processed.height,
		};
	} catch (error) {
		log.warn("role vision preprocessing failed; using original screenshot", {
			error: error instanceof Error ? error.message : String(error),
		});
		return snapshot;
	}
}

function hasBrowserImagePreprocessingSupport(): boolean {
	return typeof Image !== "undefined" && typeof document !== "undefined";
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to load screenshot for vision preprocessing"));
		image.src = dataUrl;
	});
}

function isUsableBoardObservation(observation: BoardObservation): boolean {
	return Boolean(observation.boardGrid) && observation.confidence !== "low";
}

function formatBoardObservationForPlanner(observation: BoardObservation): string {
	if (!isUsableBoardObservation(observation)) return "";
	return [
		"========== BOARD ANALYSIS (PROGRAMMATIC GRID SCANNER) ==========",
		"权威数据：以下棋盘是融合后的 canonical board；若启用拓扑锁，墙/地面/目标点来自 Mission Analyst 的初始判断，后续视觉只更新 P/B 动态位置。",
		"必须在 stateSketch 中使用以下棋盘布局，不可用单轮视觉印象覆盖固定拓扑。",
		`confidence=${observation.confidence}`,
		`entities=${observation.entities.join(", ") || "(none)"}`,
		`ambiguities=${observation.ambiguities.join(" | ") || "(none)"}`,
		"",
		observation.boardGrid,
		"",
		"================================================================",
	].join("\n");
}

function formatBoardObservationForEvaluator(before: BoardObservation, after: BoardObservation): string {
	if (!isUsableBoardObservation(before) && !isUsableBoardObservation(after)) return "";
	const hasChange = before.boardGrid !== after.boardGrid;
	const verdict = hasChange
		? "棋盘发生了变化。请比较前后棋盘差异来判断动作效果。"
		: "棋盘完全相同——动作未能产生任何实质位移。";
	return [
		"========== BOARD ANALYSIS (PROGRAMMATIC GRID SCANNER) ==========",
		"权威数据：以下前后棋盘是融合后的 canonical board；若启用拓扑锁，静态地图不会被单轮视觉覆盖。",
		`beforeConfidence=${before.confidence}; afterConfidence=${after.confidence}`,
		"",
		"动作前:",
		before.boardGrid || "(none)",
		"动作后:",
		after.boardGrid || "(none)",
		"",
		`>>> 判定: ${verdict}`,
		"================================================================",
	].join("\n");
}

// --- end board grid capture ---

async function resolveLocatorFromCloudVision(input: {
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
	beforeSnapshot: CapturedTargetSnapshot;
	locatorHint: string;
}): Promise<LocatorCoordinateDecision | null> {
	const content = await requestActiveVisionDecision({
		systemPrompt: buildLocatorSystemPrompt("cloud"),
		userPrompt: buildLocatorUserPrompt(input.target, input.mission, input.locatorHint),
		imageDataUrls: [input.beforeSnapshot.dataUrl],
		temperature: 0,
		maxTokens: 260,
		jsonResponse: true,
		timeoutMs: 20_000,
		telemetry: {
			role: "cloud-locator",
			source: "delegation",
			taskKind: input.mission.taskMode,
		},
	});
	return parseLocatorVisionDecision(content, input.beforeSnapshot, "cloud");
}

async function resolveLocatorFromLocalVision(input: {
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
	beforeSnapshot: CapturedTargetSnapshot;
	locatorHint: string;
}): Promise<LocatorCoordinateDecision | null> {
	const runtimeConfig = getConfig().companionRuntime;
	const content = await requestOpenAICompatibleVision({
		client: {
			baseUrl: runtimeConfig.localVisionBaseUrl,
			model: runtimeConfig.localVisionModel,
		},
		systemPrompt: buildLocatorSystemPrompt("local"),
		userPrompt: buildLocatorUserPrompt(input.target, input.mission, input.locatorHint),
		imageDataUrl: input.beforeSnapshot.dataUrl,
		maxTokens: 260,
		temperature: 0,
		timeoutMs: 20_000,
		jsonResponse: true,
	});
	return parseLocatorVisionDecision(content, input.beforeSnapshot, "local");
}

async function resolveLocatorFromConsensusTool(input: {
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
	beforeSnapshot: CapturedTargetSnapshot;
	locatorHint: string;
}): Promise<LocatorCoordinateDecision | null> {
	const response = await callLocalMcpToolJson<Record<string, unknown>>(
		"host.resolve_locator_consensus",
		{
			targetHandle: input.target.handle,
			targetTitle: input.target.title,
			locatorHint: input.locatorHint,
			taskGoal: input.mission.missionGoal,
			samples: 4,
		},
		{
			timeoutMs: 45_000,
		},
	);
	const parsed = response ?? {};
	const found = parsed.found;
	if (typeof found === "boolean" && !found) {
		return null;
	}
	const center = parsed.center && typeof parsed.center === "object" && !Array.isArray(parsed.center)
		? parsed.center as Record<string, unknown>
		: null;
	const xNorm = normalizeCoordinateCandidate(
		center?.xNorm ?? parsed.xNorm ?? parsed.x,
		input.beforeSnapshot.width,
	);
	const yNorm = normalizeCoordinateCandidate(
		center?.yNorm ?? parsed.yNorm ?? parsed.y,
		input.beforeSnapshot.height,
	);
	if (xNorm === null || yNorm === null) {
		return null;
	}
	const confidence = normalizeConfidenceCandidate(parsed.confidence);
	const reason = toText(parsed.reason) || "consensus locator result";
	return {
		tier: "local",
		xNorm,
		yNorm,
		x: denormalizeCoordinate(xNorm, input.beforeSnapshot.width),
		y: denormalizeCoordinate(yNorm, input.beforeSnapshot.height),
		confidence,
		reason,
	};
}

function buildLocatorSystemPrompt(source: "cloud" | "local"): string {
	return [
		`You are a ${source} image click locator.`,
		"Given one screenshot and a locator hint, return normalized click coordinates.",
		"Output strict JSON only: {\"found\": boolean, \"xNorm\": number, \"yNorm\": number, \"confidence\": number, \"reason\": string}.",
		"Use xNorm/yNorm in [0, 1]. confidence in [0, 1].",
		"If unsure, set found=false and explain briefly.",
	].join("\n");
}

function buildLocatorUserPrompt(target: FunctionalTarget, mission: MissionAnalysisDecision, locatorHint: string): string {
	return [
		`target: ${target.title} (${target.handle})`,
		`missionGoal: ${mission.missionGoal}`,
		`hardConstraints: ${mission.hardConstraints.join(" | ") || "(none)"}`,
		`locatorHint: ${locatorHint}`,
	].join("\n");
}

function parseLocatorVisionDecision(
	rawText: string,
	snapshot: CapturedTargetSnapshot,
	tier: "cloud" | "local",
): LocatorCoordinateDecision | null {
	const parsed = parseJsonObject(rawText);
	const foundValue = parsed.found;
	if (typeof foundValue === "boolean" && !foundValue) {
		return null;
	}
	const xNorm = normalizeCoordinateCandidate(parsed.xNorm ?? parsed.x, snapshot.width);
	const yNorm = normalizeCoordinateCandidate(parsed.yNorm ?? parsed.y, snapshot.height);
	if (xNorm === null || yNorm === null) {
		return null;
	}
	const confidence = normalizeConfidenceCandidate(parsed.confidence);
	const reason = toText(parsed.reason) || `${tier} locator result`;
	return {
		tier,
		xNorm,
		yNorm,
		x: denormalizeCoordinate(xNorm, snapshot.width),
		y: denormalizeCoordinate(yNorm, snapshot.height),
		confidence,
		reason,
	};
}

function buildLocatorDecisionFromPixels(
	tier: "rule",
	x: number,
	y: number,
	width: number,
	height: number,
	confidence: number,
	reason: string,
): LocatorCoordinateDecision {
	const clampedX = Math.max(0, Math.min(width - 1, x));
	const clampedY = Math.max(0, Math.min(height - 1, y));
	return {
		tier,
		x: clampedX,
		y: clampedY,
		xNorm: normalizePixelToUnit(clampedX, width),
		yNorm: normalizePixelToUnit(clampedY, height),
		confidence,
		reason,
	};
}

function applyLocatorCoordinateCorrections(
	decision: LocatorCoordinateDecision,
	locatorHint: string,
	snapshot: CapturedTargetSnapshot,
): LocatorCoordinateDecision {
	const normalizedHint = locatorHint.trim().toLowerCase();
	let xNorm = decision.xNorm;
	let yNorm = decision.yNorm;
	const reasonSegments = [decision.reason];

	if (/(地址栏|url|网址|omnibox|导航栏)/i.test(normalizedHint)) {
		if (yNorm > 0.8) {
			yNorm = 1 - yNorm;
			reasonSegments.push("correction: inverted-y");
		}
		if (yNorm > 0.12 && yNorm < 0.45) {
			yNorm = Math.max(0, yNorm - 0.06);
			reasonSegments.push("correction: offset-y(-0.06)");
		}
	}

	if (xNorm === decision.xNorm && yNorm === decision.yNorm) {
		return decision;
	}

	return {
		...decision,
		xNorm,
		yNorm,
		x: denormalizeCoordinate(xNorm, snapshot.width),
		y: denormalizeCoordinate(yNorm, snapshot.height),
		reason: reasonSegments.join(" | "),
	};
}

function parseJsonObject(rawText: string): Record<string, unknown> {
	const trimmed = rawText.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				const parsed = JSON.parse(trimmed.slice(start, end + 1));
				return parsed && typeof parsed === "object" && !Array.isArray(parsed)
					? parsed as Record<string, unknown>
					: {};
			} catch {
				return {};
			}
		}
		return {};
	}
}

function toText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

function toUnitNumber(value: unknown): number | null {
	const raw = toFiniteNumber(value);
	if (raw === null) {
		return null;
	}
	if (raw < 0 || raw > 1) {
		return null;
	}
	return raw;
}

function normalizeCoordinateCandidate(value: unknown, size: number): number | null {
	const numeric = toFiniteNumber(value);
	if (numeric === null) {
		return null;
	}
	if (numeric >= 0 && numeric <= 1) {
		return numeric;
	}
	if (size <= 1) {
		return null;
	}
	const normalized = numeric / (size - 1);
	if (normalized < 0 || normalized > 1) {
		return null;
	}
	return normalized;
}

function normalizeConfidenceCandidate(value: unknown): number {
	const numeric = toFiniteNumber(value);
	if (numeric === null) {
		return 0.5;
	}
	return Math.max(0, Math.min(1, numeric));
}

function denormalizeCoordinate(unitValue: number, size: number): number {
	const max = Math.max(1, size) - 1;
	return Math.max(0, Math.min(max, Math.round(unitValue * max)));
}

function normalizePixelToUnit(pixel: number, size: number): number {
	const max = Math.max(1, size) - 1;
	if (max <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(1, pixel / max));
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const normalized = value
		.map((item) => toText(item))
		.filter(Boolean);
	return [...new Set(normalized)];
}

function hasBrowserIntent(taskText: string): boolean {
	const normalized = taskText.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	const browserKeywords = [
		"google",
		"浏览器",
		"网页",
		"搜索",
		"网址",
		"打开网站",
		"打开页面",
		"address bar",
		"url",
		"site:",
	];
	return browserKeywords.some((item) => normalized.includes(item));
}

function hasGameIntent(taskText: string): boolean {
	const normalized = taskText.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	const gameKeywords = [
		"2048",
		"sokoban",
		"推箱子",
		"棋盘",
		"移动一步",
		"move_up",
		"move_left",
		"move_right",
		"move_down",
	];
	return gameKeywords.some((item) => normalized.includes(item));
}

function normalizeTaskMode(rawMode: string, taskText: string): MissionTaskMode {
	if (hasBrowserIntent(taskText)) {
		return "browser";
	}
	if (hasGameIntent(taskText)) {
		return "game";
	}
	const lowered = rawMode.trim().toLowerCase();
	if (lowered === "browser" || lowered === "game" || lowered === "generic") {
		return lowered;
	}
	return inferTaskModeFromTaskText(taskText);
}

function inferTaskModeFromTaskText(taskText: string): MissionTaskMode {
	if (!taskText.trim()) {
		return "generic";
	}
	if (hasBrowserIntent(taskText)) {
		return "browser";
	}
	if (hasGameIntent(taskText)) {
		return "game";
	}
	return "generic";
}

async function resolveRuntimeToolNames(traceId?: string): Promise<Set<string> | null> {
	try {
		const tools = await listLocalMcpTools({ timeoutMs: 10_000 });
		if (!tools.length) {
			return null;
		}
		return new Set(
			tools
				.map((tool) => tool.name.trim())
				.filter(Boolean),
		);
	} catch (error) {
		log.warn("failed to list runtime MCP tools; fallback to config-allowed tools", {
			traceId: traceId ?? null,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

function buildAllowedTools(
	configAllowedTools: string[],
	gameContext: DelegatedGameContext | null,
	runtimeToolNames: Set<string> | null,
): string[] {
	const tools = new Set(configAllowedTools.map((item) => item.trim()).filter(Boolean));
	if (gameContext) {
		tools.add("game.perform_action");
	}
	const candidates = [...tools];
	if (!runtimeToolNames || !runtimeToolNames.size) {
		return candidates;
	}
	const intersected = candidates.filter((tool) => runtimeToolNames.has(tool));
	return intersected.length ? intersected : candidates;
}

function resolveGameContext(targetTitle: string): DelegatedGameContext | null {
	const matched = findSemanticGameByTargetTitle(targetTitle);
	if (!matched) {
		return null;
	}
	const manifest = getSemanticGameManifest(matched.gameId);
	return {
		gameId: matched.gameId,
		displayName: matched.displayName,
		actionIds: manifest.actions.map((action) => action.id),
	};
}

function mergeDelegatedConfigForGame(
	baseConfig: DelegatedTaskProfileConfig,
	gameContext: DelegatedGameContext | null,
): DelegatedTaskProfileConfig {
	if (!gameContext) {
		return baseConfig;
	}
	const gameProfile = getSemanticGameManifest(gameContext.gameId).delegationProfile;
	if (!gameProfile) {
		return baseConfig;
	}
	return {
		...baseConfig,
		taskId: gameProfile.taskId ?? baseConfig.taskId,
		displayName: gameProfile.displayName ?? baseConfig.displayName,
		maxRounds: gameProfile.maxRounds ?? baseConfig.maxRounds,
		maxActionsPerRound: gameProfile.maxActionsPerRound ?? baseConfig.maxActionsPerRound,
		afterActionWaitMs: gameProfile.afterActionWaitMs ?? baseConfig.afterActionWaitMs,
		longSequence: gameProfile.longSequence
			? {
				enabled: gameProfile.longSequence.enabled ?? baseConfig.longSequence.enabled,
				maxActions: gameProfile.longSequence.maxActions ?? baseConfig.longSequence.maxActions,
				minActions: gameProfile.longSequence.minActions ?? baseConfig.longSequence.minActions,
				stepWaitMs: gameProfile.longSequence.stepWaitMs ?? baseConfig.longSequence.stepWaitMs,
				stopOnUnchangedSnapshot: gameProfile.longSequence.stopOnUnchangedSnapshot ?? baseConfig.longSequence.stopOnUnchangedSnapshot,
			}
			: baseConfig.longSequence,
		locatorRulesEnabled: gameProfile.locatorRulesEnabled ?? baseConfig.locatorRulesEnabled,
		locatorCloudEnabled: gameProfile.locatorCloudEnabled ?? baseConfig.locatorCloudEnabled,
		locatorLocalFallbackEnabled: gameProfile.locatorLocalFallbackEnabled ?? baseConfig.locatorLocalFallbackEnabled,
		locatorMinConfidence: gameProfile.locatorMinConfidence ?? baseConfig.locatorMinConfidence,
		missionAnalystTemperature: gameProfile.missionAnalystTemperature ?? baseConfig.missionAnalystTemperature,
		missionAnalystThinkingMode: gameProfile.missionAnalystThinkingMode ?? baseConfig.missionAnalystThinkingMode,
		operationsPlannerTemperature: gameProfile.operationsPlannerTemperature ?? baseConfig.operationsPlannerTemperature,
		operationsPlannerThinkingMode: gameProfile.operationsPlannerThinkingMode ?? baseConfig.operationsPlannerThinkingMode,
		progressEvaluatorTemperature: gameProfile.progressEvaluatorTemperature ?? baseConfig.progressEvaluatorTemperature,
		progressEvaluatorThinkingMode: gameProfile.progressEvaluatorThinkingMode ?? baseConfig.progressEvaluatorThinkingMode,
		allowedTools: gameProfile.allowedTools?.length ? [...gameProfile.allowedTools] : [...baseConfig.allowedTools],
		missionAnalystRules: gameProfile.missionAnalystRules?.length ? [...gameProfile.missionAnalystRules] : [...baseConfig.missionAnalystRules],
		operationsPlannerRules: gameProfile.operationsPlannerRules?.length ? [...gameProfile.operationsPlannerRules] : [...baseConfig.operationsPlannerRules],
		progressEvaluatorRules: gameProfile.progressEvaluatorRules?.length ? [...gameProfile.progressEvaluatorRules] : [...baseConfig.progressEvaluatorRules],
		boardPerceptionPrompt: gameProfile.boardPerceptionPrompt ?? baseConfig.boardPerceptionPrompt,
		visionPreprocess: gameProfile.visionPreprocess
			? {
				...baseConfig.visionPreprocess,
				...gameProfile.visionPreprocess,
				crop: {
					...baseConfig.visionPreprocess.crop,
					...gameProfile.visionPreprocess.crop,
				},
			}
			: baseConfig.visionPreprocess,
	};
}

function resolveOperationalGameContext(
	candidateGameContext: DelegatedGameContext | null,
	taskMode: MissionTaskMode,
	taskText: string,
): DelegatedGameContext | null {
	if (!candidateGameContext) {
		return null;
	}
	if (taskMode === "game") {
		return candidateGameContext;
	}
	if (taskMode === "browser") {
		return null;
	}
	return inferTaskModeFromTaskText(taskText) === "game" ? candidateGameContext : null;
}

function resolveOperationsNarration(_planner: OperationsPlannerDecision, _canPlannerFinish: boolean): string {
		return "";
	}

function resolveMissionAckReply(mission: MissionAnalysisDecision, taskText: string, languageMode: ReplyLanguageMode): string {
	const fallback = languageMode === "en"
		? `Received. I’ll start working on “${truncateTaskForAck(taskText, languageMode)}” now.`
		: `派蒙知道啦！你要我帮忙“${truncateTaskForAck(taskText, languageMode)}”，派蒙这就去做。`;
	const raw = mission.ackReply || fallback;
	if (!raw) {
		return "";
	}
	const normalized = normalizeDelegatedCompanionReply(raw, "planner", languageMode);
	return normalized || fallback;
}

function normalizeDelegatedCompanionReply(reply: string, source: "planner" | "reflection", languageMode: ReplyLanguageMode): string {
		let text = reply.trim();
		if (!text) {
			return "";
		}
		text = text
			.replace(/（0x[0-9a-f]+）/gi, "")
			.replace(/(0x[0-9a-f]+)/gi, "");
		if (languageMode === "en" && hasCjkText(text)) {
			return source === "planner"
				? "I’ll execute the planned route now."
				: "That sequence did not work; I need to rebuild the route.";
		}
		if (languageMode === "zh") {
			text = text
				.replace(/你已经/g, "派蒙已经")
				.replace(/你可以/g, "派蒙可以")
				.replace(/你刚刚/g, "派蒙刚刚")
				.replace(/你现在/g, "派蒙现在")
				.replace(/请你/g, "派蒙来");
			if (/^我/.test(text)) {
				text = text.replace(/^我/, "派蒙");
			}
		}
		text = text.replace(/\s+/g, " ").trim();
		return text;
	}

function truncateTaskForAck(taskText: string, languageMode?: ReplyLanguageMode): string {
	const compact = taskText.trim().replace(/\s+/g, " ");
	if (!compact) {
		return languageMode === "en" ? "this task" : pickReplyLanguageText("这个委托", "this task");
	}
	return compact.length > 22 ? compact.slice(0, 22) : compact;
}

function hasCjkText(text: string): boolean {
	return /[\u3400-\u9fff]/u.test(text);
}

function normalizeHostKey(rawKey: string): string {
	const lowered = rawKey.trim().toLowerCase();
	if (!lowered) {
		return "";
	}
	switch (lowered) {
		case "arrowup":
		case "up":
			return "Up";
		case "arrowdown":
		case "down":
			return "Down";
		case "arrowleft":
		case "left":
			return "Left";
		case "arrowright":
		case "right":
			return "Right";
		case "enter":
		case "return":
			return "Enter";
		case "space":
			return "Space";
		default:
			return rawKey.trim();
	}
}

function normalizeGameActionId(rawActionId: string): string {
	const lowered = rawActionId.trim().toLowerCase();
	if (!lowered) {
		return "";
	}
	switch (lowered) {
		case "up":
		case "arrowup":
		case "move-up":
		case "moveup":
			return "move_up";
		case "down":
		case "arrowdown":
		case "move-down":
		case "movedown":
			return "move_down";
		case "left":
		case "arrowleft":
		case "move-left":
		case "moveleft":
			return "move_left";
		case "right":
		case "arrowright":
		case "move-right":
		case "moveright":
			return "move_right";
		default:
			return rawActionId.trim();
	}
}

function buildAnalystScratchpadEntry(input: {
	taskText: string;
	target: FunctionalTarget;
	mission: MissionAnalysisDecision;
}): string {
	return [
		`[analyst] task=${input.taskText}`,
		`target=${input.target.title}`,
		`missionGoal=${input.mission.missionGoal}`,
		`initialState=${input.mission.initialStateSummary || "(none)"}`,
		`initialStateSketch=${input.mission.initialStateSketch || "(none)"}`,
		`hardConstraints=${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		`subtaskChain=${input.mission.subtaskChain.join(" -> ") || "(none)"}`,
		`completionSignals=${input.mission.completionSignals.join(" | ") || "(none)"}`,
		`candidateStrategies=${input.mission.candidateStrategies.join(" || ") || "(none)"}`,
		`strategyWarnings=${input.mission.strategyWarnings.join(" || ") || "(none)"}`,
	].join("\n") + "\n";
}

function formatPlannerScratchpadNote(input: {
	round: number;
	planner: OperationsPlannerDecision;
	effectiveActions: DelegatedTaskAction[];
	noActionStreak: number;
	policyReminder: string;
	retryCount: number;
	previousExpectedOutcome: string;
	previousExpectedMet: boolean | null;
}): string {
	const actionsText = input.effectiveActions.length
		? input.effectiveActions.map((action) => action.tool).join(" -> ")
		: "(none)";
	return [
		`[planner][round=${input.round}]`,
		`goalReached=${input.planner.goalReached}`,
		`actions=${actionsText}`,
		`retryCount=${input.retryCount}`,
		`policyReminder=${input.policyReminder || "(none)"}`,
		`noActionStreak=${input.noActionStreak}`,
		`previousExpectedOutcome=${input.previousExpectedOutcome || "(none)"}`,
		`previousExpectedMet=${input.previousExpectedMet === null ? "unknown" : input.previousExpectedMet ? "yes" : "no"}`,
		`currentPhaseGoal=${input.planner.currentPhaseGoal || "(none)"}`,
		`whyThisPhase=${input.planner.whyThisPhase || "(none)"}`,
		`abortCondition=${input.planner.abortCondition || "(none)"}`,
		`activeStrategy=${input.planner.activeStrategy || "(none)"}`,
		`strategyRevision=${input.planner.strategyRevision || "(none)"}`,
		`committedRoute=${input.planner.committedRoute || "(none)"}`,
		`currentRouteStep=${input.planner.currentRouteStep || "(none)"}`,
		`routeSelfCheck=${input.planner.routeSelfCheck || "(none)"}`,
		`routeRisks=${input.planner.routeRisks?.join(" || ") || "(none)"}`,
		`expectedOutcome=${input.planner.expectedOutcome || "(none)"}`,
		`stateSketch=${input.planner.stateSketch || "(none)"}`,
		`reasoning=${input.planner.reasoning || "(none)"}`,
	].join(" | ");
}

function formatEvaluatorScratchpadNote(input: {
	round: number;
	action: DelegatedTaskAction;
	expectedOutcome: string;
	reflection: ProgressEvaluatorDecision;
}): string {
	return [
		`[evaluator][round=${input.round}]`,
		`action=${input.action.tool}`,
		`expectedOutcome=${input.expectedOutcome || "(none)"}`,
		`expectedMet=${input.reflection.expectedMet}`,
		`expectationReview=${input.reflection.expectationReview || "(none)"}`,
		`actionSucceeded=${input.reflection.actionSucceeded}`,
		`wasActionCorrect=${input.reflection.wasActionCorrect}`,
		`goalAlignment=${input.reflection.goalAlignment}`,
		`goalProgress=${input.reflection.goalProgress}`,
		`phaseStatus=${input.reflection.phaseStatus}`,
		`phaseAssessment=${input.reflection.phaseAssessment || "(none)"}`,
		`planViability=${input.reflection.planViability}`,
		`planAssessment=${input.reflection.planAssessment || "(none)"}`,
		`routeStateUpdate=${input.reflection.routeStateUpdate || "(none)"}`,
		`latestDiagnosis=${input.reflection.latestDiagnosis || "(none)"}`,
		`beforeStateSketch=${input.reflection.beforeStateSketch || "(none)"}`,
		`afterStateSketch=${input.reflection.afterStateSketch || "(none)"}`,
		`stateDelta=${input.reflection.stateDelta || "(none)"}`,
		`nextHint=${input.reflection.nextHint || "(none)"}`,
	].join(" | ");
}

function pushScratchpadNote(bucket: string[], note: string, limit: number): void {
	bucket.push(note);
	if (bucket.length > limit) {
		bucket.splice(0, bucket.length - limit);
	}
}

function buildStrategyLesson(input: {
	planner: OperationsPlannerDecision;
	reflection: ProgressEvaluatorDecision;
}): string {
	const phaseGoal = input.planner.currentPhaseGoal.trim();
	const phaseReason = input.planner.whyThisPhase.trim();
	const activeStrategy = input.planner.activeStrategy.trim();
	const strategyRevision = input.planner.strategyRevision.trim();
	const phaseAssessment = input.reflection.phaseAssessment.trim();
	const planAssessment = input.reflection.planAssessment.trim();
	const nextHint = input.reflection.nextHint.trim();
	const shouldRecord = input.reflection.phaseStatus === "blocked"
		|| input.reflection.planViability === "invalidated"
		|| /死局|deadlock|重置|restart|不要重复|avoid repeating|错误路线/i.test(nextHint);
	if (!shouldRecord) {
		return "";
	}
	const parts = [
		activeStrategy ? `放弃路线：${activeStrategy}` : "",
		strategyRevision ? `路线修订：${strategyRevision}` : "",
		phaseGoal ? `避免重复阶段：${phaseGoal}` : "",
		phaseReason ? `原策略动机：${phaseReason}` : "",
		phaseAssessment ? `失败原因：${phaseAssessment}` : "",
		planAssessment ? `路线评估：${planAssessment}` : "",
		nextHint ? `修正建议：${nextHint}` : "",
	].filter(Boolean);
	return parts.join(" | ").slice(0, 320);
}

function normalizeStrategyIdentity(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[，。；：、,.!?！？]/g, "")
		.trim();
}

function extractStrategyConcepts(value: string): string[] {
	const normalized = normalizeStrategyIdentity(value);
	if (!normalized) {
		return [];
	}
	const concepts = [
		{ key: "upper-box", pattern: /(upper box|top box|上箱|上面的箱子)/ },
		{ key: "lower-box", pattern: /(lower box|bottom box|下箱|下面的箱子)/ },
		{ key: "left-box", pattern: /(left box|左边的箱子|左箱)/ },
		{ key: "right-box", pattern: /(right box|右边的箱子|右箱)/ },
		{ key: "upper-right-target", pattern: /(upper-right target|right target|右上目标|上方右侧目标)/ },
		{ key: "lower-left-target", pattern: /(lower-left target|left target|左下目标|下方左侧目标)/ },
		{ key: "upper-target", pattern: /(upper target|上目标|上方目标)/ },
		{ key: "lower-target", pattern: /(lower target|下目标|下方目标)/ },
		{ key: "first", pattern: /( first\b|先)/ },
		{ key: "restart", pattern: /(restart|reset|重开|重新开始)/ },
	];
	return concepts.filter((item) => item.pattern.test(normalized)).map((item) => item.key);
}

function pushInvalidatedStrategy(bucket: string[], strategy: string): void {
	const normalized = normalizeStrategyIdentity(strategy);
	if (!normalized) {
		return;
	}
	const exists = bucket.some((item) => normalizeStrategyIdentity(item) === normalized);
	if (!exists) {
		bucket.push(strategy.trim());
	}
}

function detectInvalidatedStrategyReuse(strategy: string, invalidatedStrategies: string[]): string {
	const normalized = normalizeStrategyIdentity(strategy);
	if (!normalized) {
		return "";
	}
	const matched = invalidatedStrategies.find((item) => normalizeStrategyIdentity(item) === normalized);
	if (matched) {
		return pickReplyLanguageText(
			`上一轮已经证明这条高层路线错误：${matched}。请改选另一条候选路线，不能继续沿用同一 activeStrategy。`,
			`This high-level route was already disproven: ${matched}. Choose a different candidate route instead of reusing the same activeStrategy.`,
		);
	}
	const strategyConcepts = extractStrategyConcepts(strategy);
	if (!strategyConcepts.length) {
		return "";
	}
	const fuzzyMatched = invalidatedStrategies.find((item) => {
		const concepts = extractStrategyConcepts(item);
		if (!concepts.length) {
			return false;
		}
		const invalidatedText = normalizeStrategyIdentity(item);
		const hardInvalidated = /deadlock|restart|reset|unrecoverable|死局|重置|重开|无法恢复/.test(invalidatedText);
		if (!hardInvalidated) {
			return false;
		}
		const overlap = strategyConcepts.filter((concept) => concepts.includes(concept));
		return overlap.length >= 3;
	});
	if (!fuzzyMatched) {
		return "";
	}
	return pickReplyLanguageText(
		`这条高层路线与已被否决的方案过于相似：${fuzzyMatched}。请切换到不同的箱子-目标分配或不同的阶段路线。`,
		`This high-level route is too similar to an already invalidated plan: ${fuzzyMatched}. Switch to a different box-target assignment or staged route.`,
	);
}

function shouldInvalidateStrategy(
	planner: OperationsPlannerDecision,
	reflection: ProgressEvaluatorDecision,
	gameContext: DelegatedGameContext | null = null,
): boolean {
	if (!normalizeStrategyIdentity(planner.activeStrategy)) {
		return false;
	}
	const joined = normalizeStateSketchText([
		reflection.phaseAssessment,
		reflection.planAssessment,
		reflection.nextHint,
	].join(" "));
	if (gameContext?.gameId === "sokoban") {
		const hardInvalidation = /死局|deadlock|重置|restart|unrecoverable|无法恢复/.test(joined);
		if (reflection.planViability === "invalidated") {
			return hardInvalidation;
		}
		return hardInvalidation && /错误路线|invalidated|不要重复|avoidrepeating/.test(joined);
	}
	if (reflection.planViability === "invalidated") {
		return true;
	}
	return /死局|deadlock|重置|restart|不要重复|avoidrepeating|错误路线|invalidated/.test(joined);
}

function isRestartAction(action: DelegatedTaskAction): boolean {
	if (action.tool !== "host.send_mouse") {
		return false;
	}
	const argsText = normalizeStateSketchText(JSON.stringify(action.args));
	return /restart|reset|重开|重新开始|紫红|粉红/.test(argsText);
}

function didRestartActionSucceed(
	action: DelegatedTaskAction,
	reflection: ProgressEvaluatorDecision,
): boolean {
	if (!isRestartAction(action)) {
		return false;
	}
	const joined = normalizeStateSketchText([
		reflection.stateDelta,
		reflection.phaseAssessment,
		reflection.planAssessment,
		reflection.nextHint,
		reflection.afterStateSketch,
	].join(" "));
	return /restart|reset|freshsolve|initialstate|restarted|重新开始|重开|初始局面|初始/.test(joined);
}

function pushStrategyLesson(bucket: string[], lesson: string, limit: number): void {
	const normalizedLesson = lesson.trim();
	if (!normalizedLesson) {
		return;
	}
	if (bucket[bucket.length - 1] === normalizedLesson) {
		return;
	}
	bucket.push(normalizedLesson);
	if (bucket.length > limit) {
		bucket.splice(0, bucket.length - limit);
	}
}

function updateRouteStateFromPlanner(
	routeState: DelegationRouteState | null,
	planner: OperationsPlannerDecision,
	observation: BoardObservation,
): DelegationRouteState | null {
	if (!routeState) {
		return null;
	}
	return {
		...routeState,
		currentBoard: observation.boardGrid || (routeState.topologyLocked ? routeState.currentBoard : planner.stateSketch || routeState.currentBoard),
		committedRoute: planner.committedRoute || planner.activeStrategy || routeState.committedRoute,
		currentRouteStep: planner.currentRouteStep || planner.currentPhaseGoal || routeState.currentRouteStep,
		routeRisks: planner.routeRisks?.length ? planner.routeRisks : routeState.routeRisks,
	};
}

function updateRouteStateFromEvaluator(
	routeState: DelegationRouteState | null,
	reflection: ProgressEvaluatorDecision,
	afterObservation: BoardObservation,
	rawAfterObservation: BoardObservation,
	action: DelegatedTaskAction,
): DelegationRouteState | null {
	if (!routeState) {
		return null;
	}
	const nextLessons = [...routeState.invalidatedRouteLessons];
	if (reflection.planViability === "invalidated") {
		pushStrategyLesson(nextLessons, reflection.routeStateUpdate || reflection.planAssessment || reflection.latestDiagnosis || "", 8);
	}
	const resetSucceeded = didRestartActionSucceed(action, reflection);
	return {
		...routeState,
		currentBoard: afterObservation.boardGrid
			|| (resetSucceeded ? routeState.canonicalInitialBoard || "" : "")
			|| (routeState.topologyLocked ? routeState.currentBoard : reflection.afterStateSketch || routeState.currentBoard),
		committedRoute: resetSucceeded || reflection.planViability === "invalidated" ? "" : routeState.committedRoute,
		currentRouteStep: resetSucceeded || reflection.phaseStatus === "completed" || reflection.planViability === "invalidated"
			? ""
			: routeState.currentRouteStep,
		latestRawBoard: rawAfterObservation.boardGrid || routeState.latestRawBoard,
		boardObservationWarnings: afterObservation.ambiguities,
		invalidatedRouteLessons: nextLessons,
		latestDiagnosis: reflection.latestDiagnosis || reflection.routeStateUpdate || reflection.nextHint || routeState.latestDiagnosis,
	};
}

function formatRouteStateForPrompt(routeState: DelegationRouteState): string {
	return [
		`currentBoard=${routeState.currentBoard || "(none)"}`,
		`topologyLocked=${routeState.topologyLocked ? "yes" : "no"}`,
		`canonicalTopology=${routeState.canonicalTopology || "(none)"}`,
		`latestRawBoard=${routeState.latestRawBoard || "(none)"}`,
		`boardObservationWarnings=${routeState.boardObservationWarnings?.join(" || ") || "(none)"}`,
		`routeHypotheses=${routeState.routeHypotheses.join(" || ") || "(none)"}`,
		`committedRoute=${routeState.committedRoute || "(none)"}`,
		`currentRouteStep=${routeState.currentRouteStep || "(none)"}`,
		`routeRisks=${routeState.routeRisks.join(" || ") || "(none)"}`,
		`invalidatedRouteLessons=${routeState.invalidatedRouteLessons.join(" || ") || "(none)"}`,
		`latestDiagnosis=${routeState.latestDiagnosis || "(none)"}`,
	].join("\n");
}

async function persistRouteState(
	scratchpad: DelegationScratchpadRuntime | null | undefined,
	routeState: DelegationRouteState | null,
): Promise<void> {
	if (!routeState) {
		return;
	}
	await persistScratchpadText(
		scratchpad,
		"shared/route-state.json",
		`${JSON.stringify(routeState, null, 2)}\n`,
		{ append: false },
	);
}

function buildSharedScratchpadContext(input: {
	taskText: string;
	mission: MissionAnalysisDecision;
	memoryRecallSummary: string;
	latestHint: string;
	latestExpectedOutcome: string;
	latestExpectedMet: boolean | null;
	latestPhaseGoal: string;
	latestPhaseReason: string;
	latestPhaseAbortCondition: string;
	latestPhaseStatus: string;
	latestPhaseAssessment: string;
	latestActiveStrategy: string;
	latestStrategyRevision: string;
	latestPlanViability: string;
	latestPlanAssessment: string;
	invalidatedStrategies: string[];
	strategyLessons: string[];
	routeState: DelegationRouteState | null;
	history: string[];
	plannerNotes: string[];
	evaluatorNotes: string[];
}): string {
	const plannerTail = input.plannerNotes.slice(-2);
	const evaluatorTail = input.evaluatorNotes.slice(-2);
	const historyTail = input.history.slice(-3);
	return [
		"### task",
		input.taskText,
		"### mission",
		`goal=${input.mission.missionGoal}`,
		`initialState=${input.mission.initialStateSummary || "(none)"}`,
		`initialStateSketch=${input.mission.initialStateSketch || "(none)"}`,
		`constraints=${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		`subtaskChain=${input.mission.subtaskChain.join(" -> ") || "(none)"}`,
		`completionSignals=${input.mission.completionSignals.join(" | ") || "(none)"}`,
		`candidateStrategies=${input.mission.candidateStrategies.join(" || ") || "(none)"}`,
		`strategyWarnings=${input.mission.strategyWarnings.join(" || ") || "(none)"}`,
		`invalidatedStrategies=${input.invalidatedStrategies.join(" || ") || "(none)"}`,
		"### memoryRecall",
		input.memoryRecallSummary || "(none)",
		"### latestHint",
		input.latestHint || "(none)",
		"### latestExpectation",
		`expectedOutcome=${input.latestExpectedOutcome || "(none)"}`,
		`expectedMet=${input.latestExpectedMet === null ? "unknown" : input.latestExpectedMet ? "yes" : "no"}`,
		"### latestPhase",
		`phaseGoal=${input.latestPhaseGoal || "(none)"}`,
		`phaseReason=${input.latestPhaseReason || "(none)"}`,
		`phaseAbortCondition=${input.latestPhaseAbortCondition || "(none)"}`,
		`phaseStatus=${input.latestPhaseStatus || "(none)"}`,
		`phaseAssessment=${input.latestPhaseAssessment || "(none)"}`,
		"### activeStrategy",
		`activeStrategy=${input.latestActiveStrategy || "(none)"}`,
		`strategyRevision=${input.latestStrategyRevision || "(none)"}`,
		`planViability=${input.latestPlanViability || "(none)"}`,
		`planAssessment=${input.latestPlanAssessment || "(none)"}`,
		"### routeState",
		input.routeState ? formatRouteStateForPrompt(input.routeState) : "(none)",
		"### strategyLessons",
		input.strategyLessons.length ? input.strategyLessons.join("\n") : "(none)",
		"### plannerRecent",
		plannerTail.length ? plannerTail.join("\n") : "(none)",
		"### evaluatorRecent",
		evaluatorTail.length ? evaluatorTail.join("\n") : "(none)",
		"### executionHistoryRecent",
		historyTail.length ? historyTail.join("\n") : "(none)",
	].join("\n");
}

function buildMemoryRecallQuery(taskText: string, mission: MissionAnalysisDecision): string {
	const parts = [
		taskText,
		mission.missionGoal,
		mission.subtaskChain.join(" "),
		mission.completionSignals.join(" "),
	].map((item) => item.trim()).filter(Boolean);
	return parts.join(" | ");
}

async function recallWithTimeout(
	recallFn: (query: string) => Promise<MemoryCandidate[]>,
	query: string,
	timeoutMs: number,
): Promise<MemoryCandidate[]> {
	const timeoutPromise = new Promise<MemoryCandidate[]>((resolve) => {
		setTimeout(() => resolve([]), timeoutMs);
	});
	return Promise.race([
		recallFn(query),
		timeoutPromise,
	]);
}

function formatMemoryRecallSummary(candidates: MemoryCandidate[]): string {
	return candidates.map((candidate, index) => {
		const entry = candidate.entry;
		const time = new Date(entry.time_start).toLocaleString();
		const entities = entry.entities.length ? entry.entities.join(",") : "无";
		return [
			`[记忆 ${index + 1}] 时间=${time}`,
			`场景=${entry.scene_or_task}`,
			`实体=${entities}`,
			`结果=${entry.event_result}`,
			`摘要=${entry.summary}`,
			`相关度=${candidate.relevanceScore.toFixed(2)}`,
		].join(" | ");
	}).join("\n");
}

async function persistScratchpadText(
	scratchpad: DelegationScratchpadRuntime | null | undefined,
	relativePath: string,
	text: string,
	options?: { append?: boolean },
): Promise<void> {
	if (!scratchpad) {
		return;
	}
	try {
		await scratchpad.append(relativePath, text, options);
	} catch (error) {
		log.warn("delegation scratchpad write failed", {
			relativePath,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function detectPlannerPolicyIssue(input: {
	goalReached: boolean;
	expectedOutcome: string;
	actions: DelegatedTaskAction[];
	latestHint: string;
	recentActionOutcomes: ActionOutcomeRecord[];
}): string {
	if (!input.goalReached && !input.expectedOutcome.trim()) {
		return "你漏掉了 expectedOutcome。请明确本轮动作执行后应观察到的可验证状态变化。";
	}
	if (!input.actions.length) {
		return "你上一版返回了空 actions。现在必须给出至少 1 个单步可执行动作。";
	}
	const firstAction = input.actions[0];
	const firstSignature = buildActionSignature(firstAction);
	const consecutiveSameFailures = countRecentConsecutiveFailures(input.recentActionOutcomes, firstSignature);
	if (consecutiveSameFailures >= 2) {
		return `动作 ${firstSignature} 已连续失败 ${consecutiveSameFailures} 轮。必须更换动作策略，禁止再次输出同签名动作。`;
	}
	const latestHintNormalized = input.latestHint.toLowerCase();
	const firstKey = normalizeActionSignatureValue(firstAction.args.key);
	if (
		firstAction.tool === "host.send_key"
		&& firstKey === "ctrl+l"
		&& /输入.*google|https:\/\/www\.google\.com|paste_text|地址栏输入并回车/.test(latestHintNormalized)
	) {
		const hasPasteText = input.actions.some((action) => action.tool === "host.paste_text");
		if (!hasPasteText) {
			return "你只输出了 Ctrl+L，但 nextHint 明确要求“地址栏输入 URL 并回车”。请输出完整可执行链路（至少包含 host.paste_text，必要时再 host.send_key Enter）。";
		}
	}
	return "";
}

function buildActionSignature(action: DelegatedTaskAction): string {
	const key = normalizeActionSignatureValue(action.args.key);
	const text = normalizeActionSignatureValue(action.args.text);
	const x = normalizeActionSignatureValue(action.args.x);
	const y = normalizeActionSignatureValue(action.args.y);
	const actionId = normalizeActionSignatureValue(action.args.actionId);
	return [
		action.tool,
		key ? `key=${key}` : "",
		text ? `text=${text.slice(0, 48)}` : "",
		actionId ? `actionId=${actionId}` : "",
		x && y ? `xy=${x},${y}` : "",
	]
		.filter(Boolean)
		.join("|");
}

function normalizeActionSignatureValue(value: unknown): string {
	return typeof value === "string"
		? value.trim().toLowerCase()
		: typeof value === "number"
			? String(value)
			: "";
}

function pushActionOutcome(bucket: ActionOutcomeRecord[], outcome: ActionOutcomeRecord): void {
	bucket.push(outcome);
	if (bucket.length > 8) {
		bucket.splice(0, bucket.length - 8);
	}
}

function countRecentConsecutiveFailures(
	outcomes: readonly ActionOutcomeRecord[],
	signature: string,
): number {
	let count = 0;
	for (let i = outcomes.length - 1; i >= 0; i -= 1) {
		const item = outcomes[i];
		if (!item || item.signature !== signature || item.actionSucceeded) {
			break;
		}
		count += 1;
	}
	return count;
}

function buildRepeatedFailureHint(outcomes: readonly ActionOutcomeRecord[]): string {
	if (outcomes.length < 2) {
		return "";
	}
	const last = outcomes[outcomes.length - 1];
	const previous = outcomes[outcomes.length - 2];
	if (!last || !previous) {
		return "";
	}
	if (last.signature !== previous.signature) {
		return "";
	}
	if (last.actionSucceeded || previous.actionSucceeded) {
		return "";
	}
	return pickReplyLanguageText(
		`相同动作“${last.signature}”连续失败。下一轮必须换策略，不得重复同动作；优先改为可直接推进目标状态的动作链。`,
		`Same action “${last.signature}” failed repeatedly. Switch strategy next round; do not repeat the same action. Prioritize action chains that directly advance the target state.`,
	);
}

function buildBoardStagnationHint(
	gameContext: DelegatedGameContext | null,
	outcomes: readonly ActionOutcomeRecord[],
): string {
	if (!gameContext) {
		return "";
	}
	const stagnationRounds = countRecentStagnation(outcomes);
	if (stagnationRounds < 2) {
		return "";
	}
	if (gameContext.gameId === "sokoban") {
		return pickReplyLanguageText(
			`连续 ${stagnationRounds} 轮没有确认棋盘变化。下一轮必须先重建文本棋盘，重新确认 P/B/T 的相对位置，并换一个局面目标；不要继续重复原来的方向套路。`,
			`No confirmed board change for ${stagnationRounds} rounds. Next round must rebuild the text board, re-confirm P/B/T positions, and pick a different board target instead of repeating the same move patterns.`,
		);
	}
	return pickReplyLanguageText(
		`连续 ${stagnationRounds} 轮没有确认棋盘变化。下一轮必须先重建 4x4 文本棋盘，再换一个合并目标或保留方向；不要继续重复原来的操作路线。`,
		`No confirmed board change for ${stagnationRounds} rounds. Next round must rebuild the 4x4 text board and switch merge targets or keep direction without repeating the same move patterns.`,
	);
}

function countRecentStagnation(outcomes: readonly ActionOutcomeRecord[]): number {
	let count = 0;
	for (let i = outcomes.length - 1; i >= 0; i -= 1) {
		const item = outcomes[i];
		if (!item) {
			break;
		}
		const isPositive = item.madeProgress
			|| (item.actionSucceeded
				&& item.wasActionCorrect
				&& (item.goalAlignment === "closer" || item.goalAlignment === "achieved")
				&& (item.goalProgress === "partial" || item.goalProgress === "done"));
		if (isPositive) {
			break;
		}
		count += 1;
	}
	return count;
}

function buildDelegationFailureSummary(input: {
	maxRounds: number;
	latestHint: string;
	recentActionOutcomes: readonly ActionOutcomeRecord[];
}): string {
	const stagnationRounds = countRecentStagnation(input.recentActionOutcomes);
	const hint = input.latestHint.trim();
	if (stagnationRounds >= 3) {
		return pickReplyLanguageText(
			`达到最大轮次 ${input.maxRounds}，任务未完成。最近连续 ${stagnationRounds} 轮没有有效推进。建议：${hint || "先校准定位后再继续。"}`,
			`Reached max rounds ${input.maxRounds}, task incomplete. Last ${stagnationRounds} rounds showed no effective progress. Suggestion: ${hint || "recalibrate positioning first."}`,
		);
	}
	return pickReplyLanguageText(
		`达到最大轮次 ${input.maxRounds}，任务未完成。原因：未满足目标完成信号。建议：${hint || "先检查当前页面状态与目标约束。"}`,
		`Reached max rounds ${input.maxRounds}, task incomplete. Reason: completion signal not met. Suggestion: ${hint || "check current page state and target constraints first."}`,
	);
}

function combineHints(primaryHint: string, extraHint: string): string {
	const primary = primaryHint.trim();
	const extra = extraHint.trim();
	if (!primary) {
		return extra;
	}
	if (!extra) {
		return primary;
	}
	return `${primary} ${extra}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** @internal Test-only exports */
export const __test = {
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
	normalizeStateSketchText,
	buildStrategyLesson,
	resolveOperationsNarration,
	buildInitialCanonicalBoard,
	canLockInitialBoardTopology,
	scoreInitialBoardObservation,
	reconcileBoardObservationWithRouteState,
	reconcileSokobanDynamicBoard,
	parseSokobanBoardState,
	inferDelegationReplyLanguageMode,
	buildOperationsPlannerUserPrompt,
	buildOperationsPlannerSystemPrompt,
	countRawPlannerActions,
	extractRawPlannerActionIds,
	detectLongSequencePlannerIssue,
	classifySnapshotChangeScore,
	detectLongSequenceRecoveryReason,
	resetRouteStateAfterLongSequenceRecovery,
} as const;
