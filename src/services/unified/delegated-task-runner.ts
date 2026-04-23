import { getConfig } from "@/services/config";
import { requestActiveVisionDecision } from "@/services/games/cloud-decision";
import { findSemanticGameByTargetTitle, getSemanticGameManifest } from "@/services/games/semantic-game-registry";
import { createLogger } from "@/services/logger";
import { callLocalMcpTool, callLocalMcpToolJson, listLocalMcpTools } from "@/services/mcp/local-mcp-client";
import type { OrchestratorService } from "@/services/orchestrator";
import { requestOpenAICompatibleVision } from "@/services/vlm";
import type { FunctionalTarget } from "@/types";
import type { MemoryCandidate } from "@/types/memory";
import { getDelegatedTaskConfig, type DelegatedTaskProfileConfig } from "./delegated-task-config";

const log = createLogger("delegated-task-runner");

interface DelegatedTaskAction {
	tool: string;
	args: Record<string, unknown>;
}

interface CapturedTargetSnapshot {
	dataUrl: string;
	width: number;
	height: number;
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
	const config = getDelegatedTaskConfig(input.profileId);
	const history: string[] = [];
	const plannerNotes: string[] = [];
	const evaluatorNotes: string[] = [];
	const recentActionOutcomes: ActionOutcomeRecord[] = [];
	const timelineRounds: import("@/types/unified").DelegationRoundEntry[] = [];
	let latestHint = "";
	let latestExpectedOutcome = "";
	let latestExpectedMet: boolean | null = null;
	let noActionStreak = 0;
	let hasExecutionEvidence = false;
	const candidateGameContext = resolveGameContext(input.target.title);
	const runtimeToolNames = await resolveRuntimeToolNames(input.traceId);
	const missionProbeTools = buildAllowedTools(config.allowedTools, candidateGameContext, runtimeToolNames);
	const missionSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
	const missionRaw = await requestActiveVisionDecision({
		systemPrompt: buildMissionAnalystSystemPrompt(config.missionAnalystRules),
		userPrompt: buildMissionAnalystUserPrompt({
			taskText: input.taskText,
			target: input.target,
			allowedTools: missionProbeTools,
			candidateGameContext,
		}),
		imageDataUrls: [missionSnapshot.dataUrl],
		temperature: config.missionAnalystTemperature,
		thinkingMode: config.missionAnalystThinkingMode,
		maxTokens: 900,
		jsonResponse: true,
		timeoutMs: 35_000,
	});
	const mission = normalizeMissionAnalysisDecision(missionRaw, input.taskText, input.target);
	const gameContext = resolveOperationalGameContext(candidateGameContext, mission.taskMode, input.taskText);
	const allowedTools = buildAllowedTools(config.allowedTools, gameContext, runtimeToolNames);

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
		allowedTools,
	});
	const missionAckReply = resolveMissionAckReply(mission, input.taskText);
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
		}, null, 2)}\n`,
		{ append: false },
	);

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

	for (let round = 1; round <= config.maxRounds; round += 1) {
		if (input.shouldStop()) {
			return {
				status: "stopped",
				rounds: round - 1,
				summary: "任务被手动停止。",
				timeline: buildTimeline(),
			};
		}

		const currentSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
		const sharedScratchpadContext = buildSharedScratchpadContext({
			taskText: input.taskText,
			mission,
			memoryRecallSummary,
			latestHint,
			latestExpectedOutcome,
			latestExpectedMet,
			history,
			plannerNotes,
			evaluatorNotes,
		});
		const plannerSystemPrompt = buildOperationsPlannerSystemPrompt({
			allowedTools,
			maxActionsPerRound: config.maxActionsPerRound,
			rules: config.operationsPlannerRules,
			gameContext,
			mission,
		});
		let plannerPolicyReminder = "";
		let plannerRetryCount = 0;
		let planner = {
			goalReached: false,
			reasoning: "",
			reply: "",
			expectedOutcome: "",
			stateSketch: "",
			actions: [] as DelegatedTaskAction[],
		};
		while (plannerRetryCount <= 1) {
			const plannerRaw = await requestActiveVisionDecision({
				systemPrompt: plannerSystemPrompt,
				userPrompt: buildOperationsPlannerUserPrompt({
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
				}),
				imageDataUrls: [currentSnapshot.dataUrl],
				temperature: config.operationsPlannerTemperature,
				maxTokens: 700,
				jsonResponse: true,
				timeoutMs: 30_000,
			});
			const nextPlanner = normalizeOperationsPlannerDecision(
				plannerRaw,
				allowedTools,
				config.maxActionsPerRound,
				input.target,
				gameContext,
			);
			const policyIssue = detectPlannerPolicyIssue({
				goalReached: nextPlanner.goalReached,
				expectedOutcome: nextPlanner.expectedOutcome,
				actions: nextPlanner.actions,
				latestHint,
				recentActionOutcomes,
			});
			planner = nextPlanner;
			if (!policyIssue || plannerRetryCount >= 1) {
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
		await persistScratchpadText(input.scratchpad, "roles/planner.md", `${plannerNote}\n`);
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
		const shouldEmitPlannerReply = planner.goalReached || !effectivePlannerActions.length;
		if (plannerReply && shouldEmitPlannerReply) {
			await input.onAssistantReply?.(plannerReply, "planner");
		}
		if (canPlannerFinish) {
			return {
				status: "completed",
				rounds: round,
				summary: planner.reasoning || "规划器判定任务已完成。",
				timeline: buildTimeline(),
			};
		}
		if (!effectivePlannerActions.length) {
			history.push(`round ${round}: no action generated`);
			if (history.length > 6) {
				history.splice(0, history.length - 6);
			}
			latestHint = plannerPolicyReminder || "上一轮没有产出可执行动作。下一轮必须给出一个单步工具动作。";
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
					history,
					plannerNotes,
					evaluatorNotes,
				})}\n`,
				{ append: false },
			);
			continue;
		}

		for (const action of effectivePlannerActions) {
			if (input.shouldStop()) {
				return {
					status: "stopped",
					rounds: round,
					summary: "任务在动作执行前被停止。",
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
			const afterSnapshot = await capturePostActionSnapshot({
				orchestrator: input.orchestrator,
				target: input.target,
				beforeSnapshot,
				baseWaitMs: config.afterActionWaitMs,
			});

			const reflectionRaw = await requestActiveVisionDecision({
				systemPrompt: buildProgressEvaluatorSystemPrompt(config.progressEvaluatorRules, mission),
				userPrompt: buildProgressEvaluatorUserPrompt({
					taskText: input.taskText,
					round,
					target: input.target,
					action: executionPlan.actionForEvaluation,
					mission,
					history,
					expectedOutcome: planner.expectedOutcome,
					executionError: actionExecutionError,
					scratchpadContext: buildSharedScratchpadContext({
						taskText: input.taskText,
						mission,
						memoryRecallSummary,
						latestHint,
						latestExpectedOutcome,
						latestExpectedMet,
						history,
						plannerNotes,
						evaluatorNotes,
					}),
				}),
				imageDataUrls: [beforeSnapshot.dataUrl, afterSnapshot.dataUrl],
				temperature: config.progressEvaluatorTemperature,
				maxTokens: 500,
				jsonResponse: true,
				timeoutMs: 30_000,
			});
			let reflection = normalizeProgressEvaluatorDecision(reflectionRaw);
			if (actionExecutionError) {
				reflection = {
					...reflection,
					actionSucceeded: false,
					wasActionCorrect: false,
					expectedMet: false,
					goalAlignment: reflection.goalAlignment === "achieved" ? "deviated" : reflection.goalAlignment,
					goalProgress: reflection.goalProgress === "done" ? "none" : reflection.goalProgress,
					beforeStateSketch: reflection.beforeStateSketch || "",
					afterStateSketch: reflection.afterStateSketch || "",
					stateDelta: reflection.stateDelta || "",
					nextHint: combineHints(
						reflection.nextHint,
						`动作执行报错：${actionExecutionError}。下一轮先修正动作参数或先做聚焦/定位校准。`,
					),
				};
			}
			log.info("delegated progress evaluator", {
				round,
				tool: resolvedAction.tool,
				actionSucceeded: reflection.actionSucceeded,
				wasActionCorrect: reflection.wasActionCorrect,
				expectedMet: reflection.expectedMet,
				goalAlignment: reflection.goalAlignment,
				goalProgress: reflection.goalProgress,
				legacyChanged: reflection.actionSucceeded,
			});
			const reflectionReply = normalizeDelegatedCompanionReply(reflection.reply, "reflection");
			if (reflectionReply) {
				await input.onAssistantReply?.(reflectionReply, "reflection");
			}

			const actionSignature = buildActionSignature(executionPlan.actionForEvaluation);
			pushActionOutcome(recentActionOutcomes, {
				signature: actionSignature,
				actionSucceeded: reflection.actionSucceeded,
				wasActionCorrect: reflection.wasActionCorrect,
				goalAlignment: reflection.goalAlignment,
			});
			const repeatedFailureHint = buildRepeatedFailureHint(recentActionOutcomes);
			if (repeatedFailureHint) {
				reflection = {
					...reflection,
					wasActionCorrect: false,
					expectedMet: false,
					goalAlignment: "deviated",
					beforeStateSketch: reflection.beforeStateSketch || "",
					afterStateSketch: reflection.afterStateSketch || "",
					stateDelta: reflection.stateDelta || "",
				};
				const lastOutcome = recentActionOutcomes[recentActionOutcomes.length - 1];
				if (lastOutcome) {
					lastOutcome.wasActionCorrect = false;
					lastOutcome.goalAlignment = "deviated";
				}
			}
			latestHint = combineHints(reflection.nextHint, repeatedFailureHint);
			latestExpectedOutcome = planner.expectedOutcome;
			latestExpectedMet = reflection.expectedMet;
			hasExecutionEvidence = true;
			const evaluatorNote = formatEvaluatorScratchpadNote({
				round,
				action: executionPlan.actionForEvaluation,
				expectedOutcome: planner.expectedOutcome,
				reflection,
			});
			pushScratchpadNote(evaluatorNotes, evaluatorNote, 6);
			await persistScratchpadText(input.scratchpad, "roles/evaluator.md", `${evaluatorNote}\n`);
			history.push(
				`round ${round} ${executionPlan.actionForEvaluation.tool}: expected=${planner.expectedOutcome || "(none)"} expectedMet=${reflection.expectedMet} success=${reflection.actionSucceeded} correct=${reflection.wasActionCorrect} alignment=${reflection.goalAlignment} progress=${reflection.goalProgress} hint=${latestHint}`,
			);
			timelineRounds.push({
				round,
				timestamp: Date.now(),
				plannerReasoning: planner.reasoning,
				plannerExpectedOutcome: planner.expectedOutcome,
				plannerGoalReached: planner.goalReached,
				actionTool: executionPlan.actionForEvaluation.tool,
				actionSummary: JSON.stringify(executionPlan.actionForEvaluation.args),
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
					history,
					plannerNotes,
					evaluatorNotes,
				})}\n`,
				{ append: false },
			);

			if (reflection.goalProgress === "done" || reflection.goalAlignment === "achieved") {
				return {
					status: "completed",
					rounds: round,
					summary: reflection.nextHint || "Progress Evaluator 判定任务完成。",
					timeline: buildTimeline(),
				};
			}
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
		if (!isSnapshotLikelyUnchanged(input.beforeSnapshot, afterSnapshot)) {
			return afterSnapshot;
		}
		await sleep(320);
		afterSnapshot = await captureTargetSnapshot(input.orchestrator, input.target);
	}
	return afterSnapshot;
}

function isSnapshotLikelyUnchanged(beforeSnapshot: CapturedTargetSnapshot, afterSnapshot: CapturedTargetSnapshot): boolean {
	if (beforeSnapshot.width !== afterSnapshot.width || beforeSnapshot.height !== afterSnapshot.height) {
		return false;
	}
	return beforeSnapshot.dataUrl === afterSnapshot.dataUrl;
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
		"禁止输出代码块、禁止附加解释文本，只输出 JSON。",
	];
	return [...baseRules, ...rules].join("\n");
}

function buildMissionAnalystUserPrompt(input: {
	taskText: string;
	target: FunctionalTarget;
	allowedTools: string[];
	candidateGameContext: DelegatedGameContext | null;
}): string {
	const gameContextText = input.candidateGameContext
		? `${input.candidateGameContext.displayName} (${input.candidateGameContext.gameId}) actions=${input.candidateGameContext.actionIds.join(", ")}`
		: "none";
	return [
		`task: ${input.taskText}`,
		`observedCurrentWindow: ${input.target.title} (${input.target.handle})`,
		"注意：observedCurrentWindow 只是当前观察到的初始状态，不是用户约束；不要把它直接抄进 hardConstraints。",
		`candidateGameContext: ${gameContextText}`,
		`allowedTools: ${input.allowedTools.join(", ")}`,
		"",
		"输出 JSON：",
		"{",
		'  "taskMode": "browser|game|generic",',
		'  "missionGoal": "string",',
		'  "initialStateSummary": "string",',
		'  "hardConstraints": ["string"],',
		'  "subtaskChain": ["string"],',
		'  "completionSignals": ["string"],',
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
	rules: string[];
	gameContext: DelegatedGameContext | null;
	mission: MissionAnalysisDecision;
}): string {
	const baseRules = [
		"你是 Operations Planner。你只负责下一步动作决策。",
		`missionGoal: ${input.mission.missionGoal}`,
		`hardConstraints: ${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		`completionSignals: ${input.mission.completionSignals.join(" | ") || "(none)"}`,
		`allowedTools: ${input.allowedTools.join(", ")}`,
		`每轮最多输出 ${input.maxActionsPerRound} 个动作，动作粒度越小越好。`,
		"每轮都要先复盘上一轮“预期结果”与“实际达成”，再决定本轮动作；若上一轮未达成，优先给出纠偏动作链。",
		"当 goalReached=false 时，reply 只能描述“下一步要做什么”，禁止直接回答任务问题本身。",
		"当 goalReached=false 时，必须输出 expectedOutcome（本轮动作执行后应看到的可验证状态变化）。",
		"当 goalReached=false 时，actions 必须至少包含 1 个可执行动作；禁止输出空数组。",
		"每个 action 必须是“单步可执行”，不要把多个动作混在一个 action 里。",
		"若 history / latestHint 表示同一动作连续失败，下一轮必须更换策略，不得重复同签名动作。",
		"若 latestHint 要求“Ctrl+L 后输入 URL 并回车”，actions 不能只给 Ctrl+L，必须给完整动作链。",
		"点击类动作遵循定位阶梯：本地轻量视觉模型（主路径）-> 规则化低成本策略 -> 云端图像坐标（可选）。",
		"当你需要点击但无法直接给出像素坐标时，使用 host.send_mouse 并提供 locatorHint。",
		"根据 Mission 的 subtaskChain 分阶段推进，每轮只推进一个最小可验证状态变化。",
		"reply 必须简短（建议不超过 24 个中文字符），不包含窗口句柄、十六进制 ID 或长解释。",
		"若需要“输入并回车”，请拆成两步动作：先 host.paste_text 输入纯文本，再 host.send_key(\"Enter\")；不要把 {ENTER} 混进 text。",
		"禁止输出代码块、禁止附加解释文本，只输出 JSON。",
	];
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
}): string {
	const historyText = input.history.length ? input.history.map((item) => `- ${item}`).join("\n") : "- (empty)";
	const gameContextText = input.gameContext
		? [
			`gameContext: ${input.gameContext.displayName} (${input.gameContext.gameId})`,
			`gameActionIds: ${input.gameContext.actionIds.join(", ")}`,
			"若你选择 game.perform_action，必须给出合法 actionId。",
		].join("\n")
		: "gameContext: none";
	return [
		`task: ${input.taskText}`,
		`round: ${input.round}/${input.maxRounds}`,
		`target: ${input.target.title} (${input.target.handle})`,
		`missionGoal: ${input.mission.missionGoal}`,
		`missionSubtaskChain: ${input.mission.subtaskChain.join(" -> ") || "(none)"}`,
		`missionHardConstraints: ${input.mission.hardConstraints.join(" | ") || "(none)"}`,
		gameContextText,
		`latestHint: ${input.latestHint || "(none)"}`,
		`previousExpectedOutcome: ${input.previousExpectedOutcome || "(none)"}`,
		`previousExpectedMet: ${input.previousExpectedMet === null ? "unknown" : input.previousExpectedMet ? "yes" : "no"}`,
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
		'  "actions": [',
		`    { "tool": "${input.allowedTools.join("|")}", "args": { "x": 123, "y": 456, "xNorm": 0.42, "yNorm": 0.31, "locatorHint": "点击搜索框" } }`,
		"  ]",
		"}",
	].join("\n");
}

function buildProgressEvaluatorSystemPrompt(rules: string[], mission: MissionAnalysisDecision): string {
	const baseRules = [
		"你是 Progress Evaluator。你会收到 before/after 两张图。",
		"你不仅要判断是否有变化，还要判断动作是否做对、是否朝 mission 目标推进。",
		"你必须检查 preExpectedOutcome 是否达成，并输出 expectedMet（布尔）与 expectationReview（一句话）。",
		"若 preExpectedOutcome 未达成，nextHint 必须明确给出修正动作链，不能只给抽象建议。",
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
}): string {
	const historyText = input.history.length ? input.history.map((item) => `- ${item}`).join("\n") : "- (empty)";
	return [
		`task: ${input.taskText}`,
		`round: ${input.round}`,
		`target: ${input.target.title} (${input.target.handle})`,
		`missionGoal: ${input.mission.missionGoal}`,
		`missionInitialState: ${input.mission.initialStateSummary || "(none)"}`,
		`executedAction: ${input.action.tool}`,
		`actionArgs: ${JSON.stringify(input.action.args)}`,
		`preExpectedOutcome: ${input.expectedOutcome || "(none)"}`,
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
		'  "stateDelta": "string（可选；说明这一步到底哪里变了；若几乎没变应明确写无变化）"',
		"}",
	].join("\n");
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
		actions,
	};
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
	return {
		actionSucceeded,
		wasActionCorrect: correctedWasActionCorrect,
		expectedMet,
		expectationReview: toText(parsed.expectationReview),
		goalAlignment: goalProgress === "done" ? "achieved" : goalAlignment,
		goalProgress,
		reply: toText(parsed.reply),
		nextHint: toText(parsed.nextHint),
		beforeStateSketch: toText(parsed.beforeStateSketch),
		afterStateSketch: toText(parsed.afterStateSketch),
		stateDelta: toText(parsed.stateDelta),
	};
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
	const x = toFiniteNumber(args.x);
	const y = toFiniteNumber(args.y);
	if (x !== null && y !== null) {
		args.x = Math.round(x);
		args.y = Math.round(y);
		return { tool: input.action.tool, args };
	}

	const xNorm = toUnitNumber(args.xNorm);
	const yNorm = toUnitNumber(args.yNorm);
	if (xNorm !== null && yNorm !== null) {
		args.x = denormalizeCoordinate(xNorm, input.beforeSnapshot.width);
		args.y = denormalizeCoordinate(yNorm, input.beforeSnapshot.height);
		return { tool: input.action.tool, args };
	}

	const locatorHint = toText(args.locatorHint);
	if (!locatorHint) {
		return input.action;
	}

	const decision = await resolveLocatorCoordinatesWithLadder({
		config: input.config,
		target: input.target,
		mission: input.mission,
		beforeSnapshot: input.beforeSnapshot,
		locatorHint,
		allowLocalFallback: args.allowLocalVisionFallback !== false,
	});
	if (!decision) {
		log.warn("locator ladder produced no coordinate", {
			round: input.round,
			target: input.target.title,
			locatorHint,
		});
		return input.action;
	}

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

function resolveOperationsNarration(planner: OperationsPlannerDecision, canPlannerFinish: boolean): string {
	if (planner.goalReached && canPlannerFinish) {
		return normalizeDelegatedCompanionReply(planner.reply || "派蒙这边确认任务目标已经达成啦。", "planner");
	}
	if (!planner.actions.length) {
		return normalizeDelegatedCompanionReply(planner.reply || "派蒙先再确认一轮当前页面状态。", "planner");
	}
	const firstTool = planner.actions[0].tool;
	switch (firstTool) {
		case "host.focus_window":
			return "派蒙先把目标窗口聚焦好。";
		case "host.capture_window":
			return "派蒙先截一张当前画面再继续。";
		case "host.resolve_locator_consensus":
			return "派蒙先多次定位并校正点击坐标。";
		case "host.send_key":
			return "派蒙先做一个按键操作。";
		case "host.send_mouse":
			return "派蒙先做一个鼠标操作。";
		case "host.paste_text":
			return "派蒙先把内容输入进去。";
		case "host.list_windows":
			return "派蒙先确认一下目标窗口。";
		case "game.perform_action":
			return "派蒙先执行一轮游戏动作。";
		default:
			return "派蒙先执行下一步操作。";
	}
}

function resolveMissionAckReply(mission: MissionAnalysisDecision, taskText: string): string {
	const fallback = `派蒙知道啦！你要我帮忙“${truncateTaskForAck(taskText)}”，派蒙这就去做。`;
	const raw = mission.ackReply || fallback;
	if (!raw) {
		return "";
	}
	const normalized = normalizeDelegatedCompanionReply(raw, "planner");
	return normalized || fallback;
}

function normalizeDelegatedCompanionReply(reply: string, source: "planner" | "reflection"): string {
	let text = reply.trim();
	if (!text) {
		return "";
	}
	text = text
		.replace(/（0x[0-9a-f]+）/gi, "")
		.replace(/\(0x[0-9a-f]+\)/gi, "")
		.replace(/你已经/g, "派蒙已经")
		.replace(/你可以/g, "派蒙可以")
		.replace(/你刚刚/g, "派蒙刚刚")
		.replace(/你现在/g, "派蒙现在")
		.replace(/请你/g, "派蒙来");
	if (/^我/.test(text)) {
		text = text.replace(/^我/, "派蒙");
	}
	if (!text.startsWith("派蒙") && !/^[搞好嗯哎呀太]/.test(text)) {
		text = source === "reflection" ? `派蒙${text}` : `派蒙这就来，${text}`;
	}
	text = text.replace(/\s+/g, " ").trim();
	return text;
}

function truncateTaskForAck(taskText: string): string {
	const compact = taskText.trim().replace(/\s+/g, " ");
	if (!compact) {
		return "这个委托";
	}
	return compact.length > 22 ? compact.slice(0, 22) : compact;
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

function buildSharedScratchpadContext(input: {
	taskText: string;
	mission: MissionAnalysisDecision;
	memoryRecallSummary: string;
	latestHint: string;
	latestExpectedOutcome: string;
	latestExpectedMet: boolean | null;
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
		"### memoryRecall",
		input.memoryRecallSummary || "(none)",
		"### latestHint",
		input.latestHint || "(none)",
		"### latestExpectation",
		`expectedOutcome=${input.latestExpectedOutcome || "(none)"}`,
		`expectedMet=${input.latestExpectedMet === null ? "unknown" : input.latestExpectedMet ? "yes" : "no"}`,
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
	return `相同动作“${last.signature}”连续失败。下一轮必须换策略，不得重复同动作；优先改为可直接推进目标状态的动作链。`;
}

function countRecentStagnation(outcomes: readonly ActionOutcomeRecord[]): number {
	let count = 0;
	for (let i = outcomes.length - 1; i >= 0; i -= 1) {
		const item = outcomes[i];
		if (!item) {
			break;
		}
		const isPositive = item.actionSucceeded && item.wasActionCorrect && (item.goalAlignment === "closer" || item.goalAlignment === "achieved");
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
		return `达到最大轮次 ${input.maxRounds}，任务未完成。最近连续 ${stagnationRounds} 轮没有有效推进。建议：${hint || "先校准定位后再继续。"}`;
	}
	return `达到最大轮次 ${input.maxRounds}，任务未完成。原因：未满足目标完成信号。建议：${hint || "先检查当前页面状态与目标约束。"}`;
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
