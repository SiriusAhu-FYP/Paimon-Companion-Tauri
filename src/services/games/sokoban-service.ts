import type { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { OrchestratorService } from "@/services/orchestrator";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import type {
	FunctionalTarget,
	PerceptionSnapshot,
	SokobanActionId,
	SokobanAnalysis,
	SokobanDecisionHistoryEntry,
	SokobanMoveAttempt,
	SokobanRunRecord,
	SokobanState,
} from "@/types";
import {
	formatSokobanAction,
	SOKOBAN_DEFAULT_ACTION_ORDER,
	SOKOBAN_PLUGIN,
} from "./sokoban-plugin";
import {
	chooseWindowByKeywords,
	describeSnapshotQuality,
	ensureReferenceSnapshot,
	estimateSnapshotChange,
	extractJsonObject,
	isSnapshotLowConfidence,
} from "./game-utils";
import {
	buildPlanSignature,
	buildRepeatedFailureHint,
	countRepeatedFailures,
} from "./decision-history";
import { buildSharedGamePrompt } from "./game-prompt-template";
import { requestActiveTextDecision } from "./cloud-decision";
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";
import type { SemanticActionExecutionResult } from "@/types";

const log = createLogger("sokoban");
const MAX_RUN_HISTORY = 10;
const MAX_DECISION_HISTORY = 8;
const MAX_PLANNED_MOVES = 8;
const DEFAULT_MOVE_ORDER: SokobanActionId[] = [...SOKOBAN_DEFAULT_ACTION_ORDER];
const TARGET_KEYWORDS = ["sokoban", "push box", "boxoban", "推箱子", "仓库番"];

function makeInitialState(): SokobanState {
	return {
		activeRunId: null,
		lastRun: null,
		history: [],
		decisionHistory: [],
		detectedTarget: null,
		detectionSummary: null,
	};
}

export class SokobanService {
	private bus: EventBus;
	private orchestrator: OrchestratorService;
	private companionRuntime: CompanionRuntimeService;
	private state: SokobanState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		orchestrator: OrchestratorService;
		companionRuntime: CompanionRuntimeService;
	}) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
		this.companionRuntime = deps.companionRuntime;
	}

	getState(): Readonly<SokobanState> {
		return {
			...this.state,
			lastRun: this.state.lastRun ? cloneRun(this.state.lastRun) : null,
			history: this.state.history.map(cloneRun),
			decisionHistory: this.state.decisionHistory.map(cloneDecisionHistoryEntry),
			detectedTarget: this.state.detectedTarget ? { ...this.state.detectedTarget } : null,
		};
	}

	async detectTargetWindow(): Promise<FunctionalTarget | null> {
		const windows = await listWindows();
		const candidate = chooseWindowByKeywords(windows, {
			keywords: TARGET_KEYWORDS,
			processKeywords: ["steam", "browser", "chrome", "firefox", "msedge"],
		});
		const summary = candidate
			? `detected sokoban candidate: ${candidate.title}`
			: "no sokoban-like window title found";

		this.state.detectedTarget = candidate ? { handle: candidate.handle, title: candidate.title } : null;
		this.state.detectionSummary = summary;

		if (candidate) {
			this.orchestrator.setTarget(this.state.detectedTarget);
		}

		this.bus.emit("sokoban:target-detected", {
			handle: candidate?.handle ?? null,
			title: candidate?.title ?? null,
			summary,
		});
		this.emitState();

		return this.state.detectedTarget ? { ...this.state.detectedTarget } : null;
	}

	async runValidationRound(
		targetOverride?: FunctionalTarget,
		options?: { traceId?: string },
	): Promise<SokobanRunRecord> {
		if (this.state.activeRunId) {
			throw new Error(`sokoban run already in progress: ${this.state.activeRunId}`);
		}

		const target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			throw new Error("no functional target selected; choose the Sokoban window before running validation");
		}

		const runId = `sokoban-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let run: SokobanRunRecord = {
			id: runId,
			status: "running",
			target: { ...target },
			startedAt: Date.now(),
			endedAt: null,
			analysis: buildPendingAnalysis(),
			attempts: [],
			executedMoves: [],
			boardChanged: false,
			summary: "",
			companionText: "",
			error: null,
		};

		this.state.activeRunId = run.id;
		this.state.lastRun = cloneRun(run);
		this.emitState();

		try {
			const observationContext = await this.prepareObservationContext(target);
			const baselineSnapshot = await ensureReferenceSnapshot(
				this.orchestrator,
				target,
				"unable to capture baseline Sokoban snapshot",
			);
			if (isSnapshotLowConfidence(baselineSnapshot)) {
				throw new Error(
					`sokoban baseline capture looks invalid (${describeSnapshotQuality(baselineSnapshot)}). Check target selection first.`,
				);
			}

			const analysis = await this.buildAnalysis(target, observationContext);
			run = {
				...run,
				analysis,
			};
			this.state.lastRun = cloneRun(run);
			this.emitState();

			this.bus.emit("sokoban:run-start", {
				runId: run.id,
				targetHandle: target.handle,
				targetTitle: target.title,
				plannedMoves: [...analysis.plannedMoves],
				traceId: options?.traceId ?? run.id,
			});
			await this.orchestrator.runFocusTask(target);

			let referenceSnapshot = baselineSnapshot;

			for (const move of analysis.plannedMoves) {
				await callLocalMcpToolJson<SemanticActionExecutionResult<SokobanActionId>>("game.perform_action", {
					gameId: "sokoban",
					actionId: move,
					targetHandle: target.handle,
					targetTitle: target.title,
				}, {
					traceId: options?.traceId ?? run.id,
					timeoutMs: 60_000,
				});
				const latestTask = this.orchestrator.getState().latestTask;
				const beforeSnapshot = latestTask?.beforeSnapshot ?? referenceSnapshot;
				const afterSnapshot = latestTask?.afterSnapshot;

				if (!afterSnapshot) {
					throw new Error(`missing post-action snapshot for move ${move}`);
				}

				const attempt = await this.evaluateAttempt(move, beforeSnapshot, afterSnapshot);
				run.attempts.push(attempt);
				if (attempt.changed) {
					run.executedMoves.push(move);
					run.boardChanged = true;
				}
				this.bus.emit("sokoban:attempt", {
					runId: run.id,
					move: attempt.move,
					changed: attempt.changed,
					changeRatio: attempt.changeRatio,
					traceId: options?.traceId ?? run.id,
				});

				referenceSnapshot = afterSnapshot;
			}

			run.status = "completed";
			run.endedAt = Date.now();
			run.summary = buildRunSummary(run);
			run.companionText = buildCompanionText(run);
			log.info(run.summary, {
				target: run.target.title,
				analysisSource: run.analysis.source,
				executedMoves: run.executedMoves,
				attempts: run.attempts,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.endedAt = Date.now();
			run.error = message;
			run.summary = `sokoban round failed: ${message}`;
			run.companionText = "这轮推箱子验证没跑通。先检查目标窗口、截图质量，或者确认当前画面确实是推箱子关卡。";
			log.error("sokoban validation failed", err);
		}

		this.state.activeRunId = null;
		this.state.lastRun = cloneRun(run);
		this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_RUN_HISTORY);
		this.state.decisionHistory = [toDecisionHistoryEntry(run, this.state.decisionHistory), ...this.state.decisionHistory].slice(0, MAX_DECISION_HISTORY);
		this.bus.emit("sokoban:run-complete", {
			runId: run.id,
			success: run.status === "completed" && run.boardChanged,
			executedMoves: [...run.executedMoves],
			boardChanged: run.boardChanged,
			summary: run.summary,
			traceId: options?.traceId ?? run.id,
		});
		this.emitState();

		if (run.status === "failed") {
			throw new Error(run.error ?? run.summary);
		}

		return cloneRun(run);
	}

	private async prepareObservationContext(target: FunctionalTarget): Promise<string> {
		const context = await this.companionRuntime.ensureObservationContext(target, {
			autoStart: true,
		});
		return context.promptContext;
	}

	private async buildAnalysis(target: FunctionalTarget, observationContext: string): Promise<SokobanAnalysis> {
		const recentDecisionSummary = buildRecentDecisionSummary(this.state.decisionHistory);
		const lastDecision = this.state.decisionHistory[0] ?? null;
		const repeatedFailureHint = buildRepeatedFailureHint(lastDecision);
		const discouragedOpeningMoves = collectRecentFailedOpeningMoves(this.state.decisionHistory);
		return this.requestObservationDrivenAnalysis(
			target,
			observationContext,
			recentDecisionSummary,
			repeatedFailureHint,
			discouragedOpeningMoves,
			lastDecision && !lastDecision.boardChanged ? lastDecision.planSignature : null,
		);
	}

	private async requestObservationDrivenAnalysis(
		target: FunctionalTarget,
		observationContext: string,
		recentDecisionSummary: string[],
		repeatedFailureHint: string | null,
		discouragedOpeningMoves: SokobanActionId[] = [],
		discouragedPlanSignature: string | null = null,
	): Promise<SokobanAnalysis> {
		const content = await requestActiveTextDecision({
			systemPrompt: [
				"You plan short Sokoban action sequences from local observation summaries.",
				"Treat the provided observation context as the only source of truth.",
				"Do not assume access to the raw screenshot and do not claim exact tile certainty unless the local observation already supports it.",
				"Return strict JSON only.",
			].join("\n"),
			userPrompt: buildObservationDecisionPrompt(
				target.title,
				observationContext,
				recentDecisionSummary,
				repeatedFailureHint,
				discouragedOpeningMoves,
				discouragedPlanSignature,
			),
			maxTokens: 360,
			temperature: 0.1,
			timeoutMs: 30_000,
			jsonResponse: true,
		});
		const parsed = parseObservationDecisionResponse(content);

		return {
			source: "cloud-decision",
			reflection: parsed.reflection,
			strategy: parsed.strategy,
			reasoning: parsed.reasoning,
			plannedMoves: parsed.plannedMoves,
			decisionSummary: parsed.decisionSummary,
		};
	}

	private async evaluateAttempt(
		move: SokobanActionId,
		beforeSnapshot: PerceptionSnapshot,
		afterSnapshot: PerceptionSnapshot,
	): Promise<SokobanMoveAttempt> {
		if (isSnapshotLowConfidence(beforeSnapshot) || isSnapshotLowConfidence(afterSnapshot)) {
			throw new Error(
				`capture invalid during ${move}: before=${describeSnapshotQuality(beforeSnapshot)}, after=${describeSnapshotQuality(afterSnapshot)}`,
			);
		}
		const changeRatio = await estimateSnapshotChange(beforeSnapshot, afterSnapshot, { cropScale: 0.82 });
		return {
			move,
			changed: changeRatio >= 0.003,
			changeRatio,
		};
	}

	private emitState() {
		this.bus.emit("sokoban:state-change", { state: this.getState() });
	}
}

function buildPendingAnalysis(): SokobanAnalysis {
	return {
		source: "cloud-decision",
		reflection: "Preparing the next Sokoban validation round from local observation context.",
		strategy: "refresh local observation, ask the cloud model for a short grounded move sequence, then verify per-step changes",
		reasoning: "The runtime is still refreshing the shared local observation context.",
		plannedMoves: DEFAULT_MOVE_ORDER.slice(0, 2),
	};
}

function buildObservationDecisionPrompt(
	targetTitle: string,
	observationContext: string,
	recentDecisionSummary: string[],
	repeatedFailureHint: string | null,
	discouragedOpeningMoves: SokobanActionId[],
	discouragedPlanSignature: string | null,
): string {
	const promptBody = buildSharedGamePrompt({
		gameName: SOKOBAN_PLUGIN.displayName,
		taskName: "short push-planning validation round from local observation context",
		targetWindow: targetTitle,
		actionList: SOKOBAN_PLUGIN.actions.map((action) => `${action.id}: ${action.description}`),
		gameRules: [
			...(SOKOBAN_PLUGIN.notes ?? []),
			"Return only a short move sequence for the next validation round, not a full solution transcript.",
		],
		stateCues: [
			...(SOKOBAN_PLUGIN.observationFocus ?? []),
			"Identify the player, boxes, walls, and targets only from the provided local observation context.",
			"Prefer moves that either reposition the player productively or make visible progress toward a target.",
			"Avoid repeating the same failed probe pattern without a new justification.",
			discouragedOpeningMoves.length
				? `Recent failed opening moves to avoid unless the local observation clearly changed: ${discouragedOpeningMoves.map((move) => formatSokobanAction(move)).join(", ")}.`
				: "No discouraged opening move is currently recorded.",
			discouragedPlanSignature
				? `Do not repeat this exact failed short plan signature unless the local observation is clearly different: ${discouragedPlanSignature}.`
				: "No exact failed plan signature is currently blocked.",
			repeatedFailureHint ?? "If the last exact sequence already failed, choose a materially different short plan unless the board is clearly different now.",
		],
		recentDecisions: recentDecisionSummary,
		goal: "Choose a short Sokoban move sequence that is most likely to produce visible progress without obvious deadlock risk, using only the provided local observation context.",
	});

	return [
		promptBody,
		"Observation context from the local vision runtime:",
		observationContext,
		"Return strict JSON with keys: reflection, strategy, reasoning, decisionSummary, plannedMoves.",
		`plannedMoves must be an ordered array containing only these ids: move_up, move_left, move_right, move_down, and must contain between 1 and ${MAX_PLANNED_MOVES} moves.`,
		"Use a bounded short plan, not an open-ended full walkthrough, and do not include markdown fences or extra keys.",
	].join("\n\n");
}

function parseObservationDecisionResponse(content: string): {
	reflection: string;
	strategy: string;
	reasoning: string;
	decisionSummary: string;
	plannedMoves: SokobanActionId[];
} {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		reflection?: unknown;
		strategy?: unknown;
		reasoning?: unknown;
		decisionSummary?: unknown;
		plannedMoves?: unknown;
	};
	const plannedMoves = normalizePlannedMoves(parsed.plannedMoves);

	return {
		reflection: typeof parsed.reflection === "string"
			? parsed.reflection.trim()
			: "Use the latest local observation conservatively and avoid repeating failed Sokoban probes without a new reason.",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy.trim() : "observation-driven cloud decision for a short Sokoban sequence",
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "The decision is based on the shared local observation context.",
		decisionSummary: typeof parsed.decisionSummary === "string" ? parsed.decisionSummary.trim() : "cloud chose the next Sokoban sequence from local observation context",
		plannedMoves,
	};
}

function normalizePlannedMoves(value: unknown): SokobanActionId[] {
	if (!Array.isArray(value)) {
		throw new Error("plannedMoves must be an array");
	}
	const allowed = new Set<SokobanActionId>(DEFAULT_MOVE_ORDER);
	const plannedMoves = value.flatMap((entry) => {
		const move = String(entry) as SokobanActionId;
		if (!allowed.has(move)) return [];
		return [move];
	});
	if (!plannedMoves.length) {
		throw new Error("plannedMoves must contain at least one valid move");
	}
	return plannedMoves.slice(0, MAX_PLANNED_MOVES);
}

function cloneRun(run: SokobanRunRecord): SokobanRunRecord {
	return {
		...run,
		target: { ...run.target },
		analysis: {
			...run.analysis,
			plannedMoves: [...run.analysis.plannedMoves],
		},
		attempts: run.attempts.map((attempt) => ({ ...attempt })),
		executedMoves: [...run.executedMoves],
	};
}

function cloneDecisionHistoryEntry(entry: SokobanDecisionHistoryEntry): SokobanDecisionHistoryEntry {
	return {
		...entry,
		plannedMoves: [...entry.plannedMoves],
		executedMoves: [...entry.executedMoves],
		failedMoves: [...entry.failedMoves],
	};
}

function toDecisionHistoryEntry(
	run: SokobanRunRecord,
	existingHistory: SokobanDecisionHistoryEntry[],
): SokobanDecisionHistoryEntry {
	const failedMoves = run.attempts.filter((attempt) => !attempt.changed).map((attempt) => attempt.move);
	const planSignature = buildPlanSignature(run.analysis.plannedMoves);
	const repeatedFailureCount = run.boardChanged ? 0 : countRepeatedFailures(existingHistory, planSignature) + 1;

	return {
		runId: run.id,
		recordedAt: run.endedAt ?? run.startedAt,
		status: run.status,
		reflection: run.analysis.reflection,
		strategy: run.analysis.strategy,
		reasoning: run.analysis.reasoning,
		planSignature,
		plannedMoves: [...run.analysis.plannedMoves],
		executedMoves: [...run.executedMoves],
		failedMoves,
		boardChanged: run.boardChanged,
		repeatedFailureCount,
		summary: run.summary,
	};
}

function buildRecentDecisionSummary(history: SokobanDecisionHistoryEntry[]): string[] {
	if (!history.length) {
		return ["No recent Sokoban decisions are available yet."];
	}

	return history.slice(0, 5).map((entry, index) => {
		const planned = entry.plannedMoves.map((move) => formatSokobanAction(move)).join(" -> ") || "none";
		const executed = entry.executedMoves.map((move) => formatSokobanAction(move)).join(" -> ") || "none";
		const failed = entry.failedMoves.map((move) => formatSokobanAction(move)).join(" -> ") || "none";
		const outcome = entry.boardChanged ? "board changed during the sequence" : "no verified board change";
		const repeatedFailureNote = entry.repeatedFailureCount > 0 ? ` repeatedFailureCount=${entry.repeatedFailureCount};` : "";
		return `Turn ${index + 1}: planned=${planned}; executed=${executed}; failed=${failed}; outcome=${outcome};${repeatedFailureNote} reflection=${entry.reflection}`;
	});
}

function collectRecentFailedOpeningMoves(history: SokobanDecisionHistoryEntry[]): SokobanActionId[] {
	const moves: SokobanActionId[] = [];
	for (const entry of history) {
		if (entry.boardChanged) {
			continue;
		}
		const move = entry.plannedMoves[0];
		if (move && !moves.includes(move)) {
			moves.push(move);
		}
		if (moves.length >= 3) {
			break;
		}
	}
	return moves;
}

function buildRunSummary(run: SokobanRunRecord): string {
	if (run.boardChanged) {
		return `sokoban validation verified ${run.executedMoves.length} board-changing move(s) via ${run.analysis.source}`;
	}

	return `sokoban validation found no verified board change after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: SokobanRunRecord): string {
	if (run.boardChanged) {
		const sourceLabel = run.analysis.source === "cloud-decision"
			? "本地观察加云端决策"
			: "保守启发式";
		return `我先按 ${sourceLabel} 规划了一小段推箱子动作，并确认至少有一步真的让棋盘状态发生了变化。`;
	}

	return "这轮推箱子动作没有观察到足够明显的画面变化。可能当前画面不是关卡主视图，或者计划动作全都撞墙了。";
}
