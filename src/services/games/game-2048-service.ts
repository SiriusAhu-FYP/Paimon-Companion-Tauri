import type { EventBus } from "@/services/event-bus";
import type { OrchestratorService } from "@/services/orchestrator";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import { requestOpenAICompatibleVision, resolveActiveOpenAICompatibleVisionClient } from "@/services/vlm";
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
	private state: Game2048State = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		orchestrator: OrchestratorService;
	}) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
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

		let target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			target = await this.detectTargetWindow();
		}
		if (!target) {
			throw new Error("no target window selected and no 2048 window could be detected");
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
			const analysis = await this.buildAnalysis(target, baselineSnapshot);
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

	private async buildAnalysis(target: FunctionalTarget, snapshot: PerceptionSnapshot): Promise<Game2048Analysis> {
		const previousMove = this.state.lastRun?.boardChanged ? this.state.lastRun.selectedMove : null;
		const recentDecisionSummary = buildRecentDecisionSummary(this.state.decisionHistory);
		const repeatedFailureHint = buildRepeatedFailureHint(this.state.decisionHistory[0]);

		try {
			const visionAnalysis = await this.requestVisionAnalysis(target, snapshot, previousMove, recentDecisionSummary, repeatedFailureHint);
			return visionAnalysis;
		} catch (err) {
			log.warn("2048 vision analysis unavailable, falling back to heuristic", err);
			return buildHeuristicAnalysis(previousMove, recentDecisionSummary, this.state.decisionHistory[0] ?? null);
		}
	}

	private async requestVisionAnalysis(
		target: FunctionalTarget,
		snapshot: PerceptionSnapshot,
		previousMove: Game2048Move | null,
		recentDecisionSummary: string[],
		repeatedFailureHint: string | null,
	): Promise<Game2048Analysis> {
		// The functional loop is latency-bound, so game actions bypass the
		// general chat/retrieval stack and call the configured model directly.
		const client = resolveActiveOpenAICompatibleVisionClient();
		if (!client) {
			throw new Error("vision analysis requires an openai-compatible LLM profile");
		}

		const content = await requestOpenAICompatibleVision({
			client,
			userPrompt: buildVisionPrompt(target.title, previousMove, recentDecisionSummary, repeatedFailureHint),
			imageDataUrl: snapshot.dataUrl,
			maxTokens: 250,
			temperature: 0.1,
			jsonResponse: true,
			timeoutMs: 30000,
		});
		const parsed = parseVisionResponse(content);

		return {
			source: "vision-llm",
			reflection: parsed.reflection,
			strategy: parsed.strategy,
			reasoning: parsed.reasoning,
			preferredMoves: parsed.preferredMoves,
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
		source: "heuristic",
		reflection: "Preparing the next 2048 step.",
		strategy: "capture the board, choose a semantic move ordering, then verify the result",
		reasoning: "The runtime is still capturing the baseline snapshot and analysis context.",
		preferredMoves: [...DEFAULT_MOVE_ORDER],
	};
}

function buildHeuristicAnalysis(
	previousMove: Game2048Move | null,
	recentDecisionSummary: string[],
	lastDecision: Game2048DecisionHistoryEntry | null,
): Game2048Analysis {
	const baseOrder = previousMove
		? uniqueMoves([previousMove, ...DEFAULT_MOVE_ORDER])
		: [...DEFAULT_MOVE_ORDER];
	const preferredMoves = lastDecision && !lastDecision.boardChanged
		? rotateOrderAwayFromFailure(baseOrder, lastDecision.planSignature)
		: baseOrder;
	const historyHint = recentDecisionSummary.length
		? "Recent history exists, so avoid repeating the same failed ordering without a new reason."
		: "No prior decision history is available yet.";
	const previousMoveLabel = previousMove ? formatGame2048Action(previousMove) : null;

	return {
		source: "heuristic",
		reflection: previousMoveLabel
			? `The last verified move was ${previousMoveLabel}. ${historyHint}`
			: `No verified prior move exists yet. ${historyHint}`,
		strategy: previousMoveLabel
			? `reuse last verified move ${previousMoveLabel} first, then bias toward upper-left stability`
			: "prefer keeping the board stable toward the upper-left corner: Up -> Left -> Right -> Down",
		reasoning: previousMoveLabel
			? `The last verified move was ${previousMoveLabel}, so test it first before falling back to the stable corner strategy.`
			: "Without image reasoning, default to a conservative upper-left stacking strategy.",
		preferredMoves,
	};
}

function buildVisionPrompt(
	targetTitle: string,
	previousMove: Game2048Move | null,
	recentDecisionSummary: string[],
	repeatedFailureHint: string | null,
): string {
	const promptBody = buildSharedGamePrompt({
		gameName: "2048",
		taskName: "single-step board improvement",
		targetWindow: targetTitle,
		actionList: listGame2048ActionDescriptions(),
		gameRules: [
			"Merge equal tiles and avoid scattering high-value tiles.",
			"Prefer keeping the highest tile anchored in one corner.",
			"Treat this as a one-step decision with verification after execution.",
		],
		stateCues: [
			previousMove
				? `Last verified successful move: ${formatGame2048Action(previousMove)}. Reuse it only if the current board still supports it.`
				: "No verified successful move is available from the previous turn.",
			"Look for board stability, merge opportunities, and whether one side is becoming fragmented.",
			"Avoid recommending a move ordering that merely repeats a failed pattern without a new reason.",
			repeatedFailureHint ?? "If the last exact move ordering already failed, choose a materially different ordering unless the board is clearly different now.",
		],
		recentDecisions: recentDecisionSummary,
		goal: "Choose the best next move ordering for one verified 2048 step.",
	});

	return [
		promptBody,
		"Analyze the current screenshot and decide the next single-step priority order.",
		"Return strict JSON with keys: reflection, strategy, reasoning, preferredMoves.",
		"reflection should briefly explain what you learned from the recent decision history before acting again.",
		`preferredMoves must be an array containing each of these action IDs exactly once, in priority order: ${DEFAULT_MOVE_ORDER.join(", ")}.`,
	].join("\n\n");
}

function parseVisionResponse(content: string): {
	reflection: string;
	strategy: string;
	reasoning: string;
	preferredMoves: Game2048Move[];
} {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		reflection?: unknown;
		strategy?: unknown;
		reasoning?: unknown;
		preferredMoves?: unknown;
	};

	const preferredMoves = normalizeMoves(parsed.preferredMoves);
	if (preferredMoves.length !== 4) {
		throw new Error("vision analysis did not return a full move ordering");
	}

	return {
		reflection: typeof parsed.reflection === "string"
			? parsed.reflection
			: "No explicit reflection was returned. Use the current screenshot and recent history conservatively.",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy : "vision-guided 2048 move selection",
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "The model selected an action based on the screenshot.",
		preferredMoves,
	};
}

function normalizeMoves(value: unknown): Game2048Move[] {
	if (!Array.isArray(value)) {
		throw new Error("preferredMoves is not an array");
	}

	const normalized = value
		.map((entry) => String(entry))
		.filter((entry): entry is Game2048Move => DEFAULT_MOVE_ORDER.includes(entry as Game2048Move));

	return uniqueMoves(normalized);
}

function uniqueMoves(moves: Game2048Move[]): Game2048Move[] {
	const seen = new Set<Game2048Move>();
	return moves.filter((move) => {
		if (seen.has(move)) return false;
		seen.add(move);
		return true;
	});
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

function rotateOrderAwayFromFailure(moves: Game2048Move[], failedSignature: string): Game2048Move[] {
	for (let offset = 1; offset < moves.length; offset += 1) {
		const rotated = moves.slice(offset).concat(moves.slice(0, offset));
		if (buildPlanSignature(rotated) !== failedSignature) {
			return rotated;
		}
	}
	return moves;
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

function buildRunSummary(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		const successAttempt = run.attempts.find((attempt) => attempt.move === run.selectedMove);
		return `2048 step verified with ${formatGame2048Action(run.selectedMove)} (${formatPercent(successAttempt?.changeRatio ?? 0)}) via ${run.analysis.source}`;
	}

	return `2048 step found no board-changing move after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		return `我先根据${run.analysis.source === "vision-llm" ? "截图分析" : "保守启发式"}判断应该尝试 ${formatGame2048Action(run.selectedMove)}，然后我已经确认棋盘真的变化了。`;
	}

	return "我已经试过这轮候选方向，但截图前后没有看到足够明显的棋盘变化。可能当前画面不是 2048 对局，或者游戏窗口还没真正获得焦点。";
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
