import type { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { OrchestratorService } from "@/services/orchestrator";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import type {
	FunctionalTarget,
	Game2048Analysis,
	Game2048DecisionHistoryEntry,
	Game2048Move,
	Game2048MoveAttempt,
	Game2048RunRecord,
	Game2048State,
	PerceptionSnapshot,
} from "@/types";
import {
	formatGame2048Action,
	GAME_2048_DEFAULT_ACTION_ORDER,
	listGame2048ActionDescriptions,
} from "./game-2048-plugin";
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

const log = createLogger("game-2048");
const MAX_RUN_HISTORY = 10;
const MAX_DECISION_HISTORY = 8;
const DEFAULT_MOVE_ORDER: Game2048Move[] = [...GAME_2048_DEFAULT_ACTION_ORDER];
const TARGET_KEYWORDS = ["2048", "play 2048", "gabriele cirulli", "threes"];

function makeInitialState(): Game2048State {
	return {
		activeRunId: null,
		lastRun: null,
		history: [],
		decisionHistory: [],
		detectedTarget: null,
		detectionSummary: null,
	};
}

export class Game2048Service {
	private bus: EventBus;
	private orchestrator: OrchestratorService;
	private companionRuntime: CompanionRuntimeService;
	private state: Game2048State = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		orchestrator: OrchestratorService;
		companionRuntime: CompanionRuntimeService;
	}) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
		this.companionRuntime = deps.companionRuntime;
	}

	getState(): Readonly<Game2048State> {
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
			processKeywords: ["msedge", "chrome", "firefox"],
		});
		const summary = candidate
			? `detected 2048 candidate: ${candidate.title}`
			: "no 2048-like window title found";

		this.state.detectedTarget = candidate ? { handle: candidate.handle, title: candidate.title } : null;
		this.state.detectionSummary = summary;

		if (candidate) {
			this.orchestrator.setTarget(this.state.detectedTarget);
		}

		this.bus.emit("game2048:target-detected", {
			handle: candidate?.handle ?? null,
			title: candidate?.title ?? null,
			summary,
		});
		this.emitState();

		return this.state.detectedTarget ? { ...this.state.detectedTarget } : null;
	}

	async runSingleStep(
		targetOverride?: FunctionalTarget,
		options?: { traceId?: string },
	): Promise<Game2048RunRecord> {
		if (this.state.activeRunId) {
			throw new Error(`2048 run already in progress: ${this.state.activeRunId}`);
		}

		const target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			throw new Error("no functional target selected; choose the 2048 window before running validation");
		}

		const runId = `2048-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let run: Game2048RunRecord = {
			id: runId,
			status: "running",
			target: { ...target },
			startedAt: Date.now(),
			endedAt: null,
			analysis: buildPendingAnalysis(),
			attempts: [],
			selectedMove: null,
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
				"unable to capture baseline snapshot",
			);
			if (isSnapshotLowConfidence(baselineSnapshot)) {
				throw new Error(
					`2048 baseline capture looks invalid (${describeSnapshotQuality(baselineSnapshot)}). Check browser/game capture first.`,
				);
			}
			const analysis = await this.buildAnalysis(target, observationContext);
			run = {
				...run,
				analysis,
			};
			this.state.lastRun = cloneRun(run);
			this.emitState();

			this.bus.emit("game2048:run-start", {
				runId: run.id,
				targetHandle: target.handle,
				targetTitle: target.title,
				preferredMoves: [...analysis.preferredMoves],
				traceId: options?.traceId ?? run.id,
			});
			await this.orchestrator.runFocusTask(target);

			let referenceSnapshot = baselineSnapshot;

			for (const move of analysis.preferredMoves) {
				await callLocalMcpToolJson<SemanticActionExecutionResult<Game2048Move>>("game.perform_action", {
					gameId: "2048",
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
				this.bus.emit("game2048:attempt", {
					runId: run.id,
					move: attempt.move,
					changed: attempt.changed,
					changeRatio: attempt.changeRatio,
					traceId: options?.traceId ?? run.id,
				});

				if (attempt.changed) {
					run.selectedMove = move;
					run.boardChanged = true;
					referenceSnapshot = afterSnapshot;
					break;
				}

				referenceSnapshot = afterSnapshot;
			}

			run.status = "completed";
			run.endedAt = Date.now();
			run.summary = buildRunSummary(run);
			run.companionText = buildCompanionText(run);
			log.info(run.summary, {
				target: run.target.title,
				analysisSource: run.analysis.source,
				selectedMove: run.selectedMove,
				attempts: run.attempts,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.endedAt = Date.now();
			run.error = message;
			run.summary = `2048 step failed: ${message}`;
			run.companionText = "这一步没跑通，先别继续自动化。请检查目标窗口、截图稳定性，或者确认当前画面确实是 2048 对局。";
			log.error("2048 step failed", err);
		}

		this.state.activeRunId = null;
		this.state.lastRun = cloneRun(run);
		this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_RUN_HISTORY);
		this.state.decisionHistory = [toDecisionHistoryEntry(run, this.state.decisionHistory), ...this.state.decisionHistory].slice(0, MAX_DECISION_HISTORY);
		this.bus.emit("game2048:run-complete", {
			runId: run.id,
			success: run.status === "completed" && run.boardChanged,
			selectedMove: run.selectedMove,
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
		await this.companionRuntime.refreshNow({ summarize: true });
		return this.companionRuntime.requireObservationContext(target).promptContext;
	}

	private async buildAnalysis(target: FunctionalTarget, observationContext: string): Promise<Game2048Analysis> {
		const previousMove = this.state.lastRun?.boardChanged ? this.state.lastRun.selectedMove : null;
		const recentDecisionSummary = buildRecentDecisionSummary(this.state.decisionHistory);
		const lastDecision = this.state.decisionHistory[0] ?? null;
		const repeatedFailureHint = buildRepeatedFailureHint(lastDecision);
		const discouragedOpeningMoves = collectRecentFailedOpeningMoves(this.state.decisionHistory);
		return this.requestObservationDrivenAnalysis(
			target,
			observationContext,
			previousMove,
			recentDecisionSummary,
			repeatedFailureHint,
			discouragedOpeningMoves,
		);
	}

	private async requestObservationDrivenAnalysis(
		target: FunctionalTarget,
		observationContext: string,
		previousMove: Game2048Move | null,
		recentDecisionSummary: string[],
		repeatedFailureHint: string | null,
		discouragedOpeningMoves: Game2048Move[] = [],
	): Promise<Game2048Analysis> {
		const content = await requestActiveTextDecision({
			systemPrompt: [
				"You make one-step 2048 decisions from local observation summaries.",
				"Treat the provided observation context as the only source of truth.",
				"Do not assume access to the raw screenshot and do not claim to see exact tiles unless the local observation already described them.",
				"Return strict JSON only.",
			].join("\n"),
			userPrompt: buildObservationDecisionPrompt(
				target.title,
				observationContext,
				previousMove,
				recentDecisionSummary,
				repeatedFailureHint,
				discouragedOpeningMoves,
			),
			maxTokens: 260,
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
			preferredMoves: parsed.preferredMoves,
			decisionSummary: parsed.decisionSummary,
		};
	}

	private async evaluateAttempt(
		move: Game2048Move,
		beforeSnapshot: PerceptionSnapshot,
		afterSnapshot: PerceptionSnapshot,
	): Promise<Game2048MoveAttempt> {
		if (isSnapshotLowConfidence(beforeSnapshot) || isSnapshotLowConfidence(afterSnapshot)) {
			throw new Error(
				`capture invalid during ${move}: before=${describeSnapshotQuality(beforeSnapshot)}, after=${describeSnapshotQuality(afterSnapshot)}`,
			);
		}
		const changeRatio = await estimateSnapshotChange(beforeSnapshot, afterSnapshot, { cropScale: 0.7 });
		return {
			move,
			changed: changeRatio >= 0.012,
			changeRatio,
		};
	}

	private emitState() {
		this.bus.emit("game2048:state-change", { state: this.getState() });
	}
}

function buildPendingAnalysis(): Game2048Analysis {
	return {
		source: "cloud-decision",
		reflection: "Preparing the next 2048 step from local observation context.",
		strategy: "refresh local observation, ask the cloud model for one grounded move ordering, then verify the result",
		reasoning: "The runtime is still refreshing the shared local observation context.",
		preferredMoves: [...DEFAULT_MOVE_ORDER],
	};
}

function buildObservationDecisionPrompt(
	targetTitle: string,
	observationContext: string,
	previousMove: Game2048Move | null,
	recentDecisionSummary: string[],
	repeatedFailureHint: string | null,
	discouragedOpeningMoves: Game2048Move[],
): string {
	const promptBody = buildSharedGamePrompt({
		gameName: "2048",
		taskName: "single-step board improvement from local observation context",
		targetWindow: targetTitle,
		actionList: listGame2048ActionDescriptions(),
		gameRules: [
			"Merge equal tiles and avoid scattering high-value tiles.",
			"Prefer keeping the highest tile anchored in one corner when the observation supports that interpretation.",
			"Treat this as a one-step decision with verification after execution.",
		],
		stateCues: [
			previousMove
				? `Last verified successful move: ${formatGame2048Action(previousMove)}. Reuse it only if the current board still supports it.`
				: "No verified successful move is available from the previous turn.",
			"Use the local observation summary to infer board stability, merge opportunities, and whether one side is becoming fragmented.",
			"Avoid recommending a move ordering that merely repeats a failed pattern without a new reason.",
			discouragedOpeningMoves.length
				? `Recent failed opening moves to avoid unless the observation is clearly different: ${discouragedOpeningMoves.map((move) => formatGame2048Action(move)).join(", ")}.`
				: "No discouraged opening move is currently recorded.",
			repeatedFailureHint ?? "If the last exact move ordering already failed, choose a materially different ordering unless the board is clearly different now.",
		],
		recentDecisions: recentDecisionSummary,
		goal: "Choose the best next move ordering for one verified 2048 step from the provided local observation context.",
	});

	return [
		promptBody,
		"Observation context from the local vision runtime:",
		observationContext,
		"Return strict JSON with keys: reflection, strategy, reasoning, decisionSummary, preferredMoves.",
		"preferredMoves must be an ordered array containing only these ids: move_up, move_left, move_right, move_down.",
		"Return at least one move and do not include markdown fences or extra keys.",
	].join("\n\n");
}

function parseObservationDecisionResponse(content: string): {
	reflection: string;
	strategy: string;
	reasoning: string;
	decisionSummary: string;
	preferredMoves: Game2048Move[];
} {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		reflection?: unknown;
		strategy?: unknown;
		reasoning?: unknown;
		decisionSummary?: unknown;
		preferredMoves?: unknown;
	};
	const preferredMoves = normalizePreferredMoves(parsed.preferredMoves);

	return {
		reflection: typeof parsed.reflection === "string"
			? parsed.reflection.trim()
			: "Use the latest local observation conservatively and avoid repeating failed patterns without a new reason.",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy.trim() : "observation-driven cloud decision for one verified 2048 step",
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "The decision is based on the shared local observation context.",
		decisionSummary: typeof parsed.decisionSummary === "string" ? parsed.decisionSummary.trim() : "cloud chose the next move ordering from local observation context",
		preferredMoves,
	};
}

function normalizePreferredMoves(value: unknown): Game2048Move[] {
	if (!Array.isArray(value)) {
		throw new Error("preferredMoves must be an array");
	}

	const allowed = new Set<Game2048Move>(DEFAULT_MOVE_ORDER);
	const seen = new Set<Game2048Move>();
	const moves = value.flatMap((entry) => {
		const move = String(entry) as Game2048Move;
		if (!allowed.has(move) || seen.has(move)) return [];
		seen.add(move);
		return [move];
	});
	if (!moves.length) {
		throw new Error("preferredMoves must contain at least one valid move");
	}
	return moves;
}

function cloneRun(run: Game2048RunRecord): Game2048RunRecord {
	return {
		...run,
		target: { ...run.target },
		analysis: {
			...run.analysis,
			preferredMoves: [...run.analysis.preferredMoves],
		},
		attempts: run.attempts.map((attempt) => ({ ...attempt })),
	};
}

function cloneDecisionHistoryEntry(entry: Game2048DecisionHistoryEntry): Game2048DecisionHistoryEntry {
	return {
		...entry,
		preferredMoves: [...entry.preferredMoves],
		attemptedMoves: [...entry.attemptedMoves],
		successfulMoves: [...entry.successfulMoves],
	};
}

function toDecisionHistoryEntry(
	run: Game2048RunRecord,
	existingHistory: Game2048DecisionHistoryEntry[],
): Game2048DecisionHistoryEntry {
	const attemptedMoves = run.attempts.map((attempt) => attempt.move);
	const successfulMoves = run.attempts.filter((attempt) => attempt.changed).map((attempt) => attempt.move);
	const planSignature = buildPlanSignature(run.analysis.preferredMoves);
	const repeatedFailureCount = run.boardChanged ? 0 : countRepeatedFailures(existingHistory, planSignature) + 1;

	return {
		runId: run.id,
		recordedAt: run.endedAt ?? run.startedAt,
		status: run.status,
		reflection: run.analysis.reflection,
		strategy: run.analysis.strategy,
		reasoning: run.analysis.reasoning,
		planSignature,
		preferredMoves: [...run.analysis.preferredMoves],
		attemptedMoves,
		successfulMoves,
		selectedMove: run.selectedMove,
		boardChanged: run.boardChanged,
		repeatedFailureCount,
		summary: run.summary,
	};
}

function buildRecentDecisionSummary(history: Game2048DecisionHistoryEntry[]): string[] {
	if (!history.length) {
		return ["No recent decisions are available yet."];
	}

	return history.slice(0, 5).map((entry, index) => {
		const plannedMoves = entry.preferredMoves.map((move) => formatGame2048Action(move)).join(" -> ");
		const attemptedMoves = entry.attemptedMoves.map((move) => formatGame2048Action(move)).join(" -> ") || "none";
		const successfulMoves = entry.successfulMoves.map((move) => formatGame2048Action(move)).join(" -> ") || "none";
		const selectedMove = entry.selectedMove ? formatGame2048Action(entry.selectedMove) : "none";
		const outcome = entry.boardChanged ? "board changed as expected" : "no verified board change";
		const repeatedFailureNote = entry.repeatedFailureCount > 0 ? ` repeatedFailureCount=${entry.repeatedFailureCount};` : "";
		return `Turn ${index + 1}: planned=${plannedMoves}; attempted=${attemptedMoves}; success=${successfulMoves}; selectedMove=${selectedMove}; outcome=${outcome};${repeatedFailureNote} reflection=${entry.reflection}`;
	});
}

function collectRecentFailedOpeningMoves(history: Game2048DecisionHistoryEntry[]): Game2048Move[] {
	const moves: Game2048Move[] = [];
	for (const entry of history) {
		if (entry.boardChanged) {
			continue;
		}
		const move = entry.preferredMoves[0];
		if (move && !moves.includes(move)) {
			moves.push(move);
		}
		if (moves.length >= 3) {
			break;
		}
	}
	return moves;
}

function buildRunSummary(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		const successAttempt = run.attempts.find((attempt) => attempt.move === run.selectedMove);
		return `2048 step verified with ${formatGame2048Action(run.selectedMove)} (${formatPercent(successAttempt?.changeRatio ?? 0)}) via ${run.analysis.source}`;
	}

	return `2048 step found no board-changing move after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		const sourceLabel = run.analysis.source === "cloud-decision" ? "本地观察加云端决策" : "保守启发式";
		return `我先根据${sourceLabel}判断应该尝试 ${formatGame2048Action(run.selectedMove)}，然后我已经确认棋盘真的变化了。`;
	}

	return "我已经试过这轮候选方向，但截图前后没有看到足够明显的棋盘变化。可能当前画面不是 2048 对局，或者游戏窗口还没真正获得焦点。";
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
