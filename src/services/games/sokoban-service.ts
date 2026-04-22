import type { EventBus } from "@/services/event-bus";
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
import { requestActiveVisionDecision } from "./cloud-decision";
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
	private state: SokobanState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		orchestrator: OrchestratorService;
	}) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
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

			const analysis = await this.buildAnalysis(target, baselineSnapshot);
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

	private async buildAnalysis(target: FunctionalTarget, referenceSnapshot: PerceptionSnapshot): Promise<SokobanAnalysis> {
		const recentDecisionSummary = buildRecentDecisionSummary(this.state.decisionHistory);
		const lastDecision = this.state.decisionHistory[0] ?? null;
		const repeatedFailureHint = buildRepeatedFailureHint(lastDecision);
		const discouragedOpeningMoves = collectRecentFailedOpeningMoves(this.state.decisionHistory);
		return this.requestObservationDrivenAnalysis(
			target,
			referenceSnapshot,
			recentDecisionSummary,
			repeatedFailureHint,
			discouragedOpeningMoves,
			lastDecision && !lastDecision.boardChanged ? lastDecision.planSignature : null,
		);
	}

	private async requestObservationDrivenAnalysis(
		target: FunctionalTarget,
		referenceSnapshot: PerceptionSnapshot,
		recentDecisionSummary: string[],
		repeatedFailureHint: string | null,
		discouragedOpeningMoves: SokobanActionId[] = [],
		discouragedPlanSignature: string | null = null,
	): Promise<SokobanAnalysis> {
		log.info("sokoban decision input prepared", {
			target: target.title,
			decisionInput: "screenshot-cloud-vision",
			imageCount: 1,
			recentDecisionCount: recentDecisionSummary.length,
			discouragedOpeningMoves,
			blockedPlanSignature: discouragedPlanSignature,
			observationFocus: [...(SOKOBAN_PLUGIN.observationFocus ?? [])],
		});
		const basePrompt = buildObservationDecisionPrompt(
			target.title,
			recentDecisionSummary,
			repeatedFailureHint,
			discouragedOpeningMoves,
			discouragedPlanSignature,
		);
		const content = await requestActiveVisionDecision({
			systemPrompt: [
				"You plan short Sokoban action sequences from screenshot evidence.",
				"You will receive the current board screenshot as the only source of truth.",
				"Do not invent exact tile certainty when the screenshot is ambiguous.",
				"Return strict JSON only.",
			].join("\n"),
			userPrompt: basePrompt,
			imageDataUrls: [referenceSnapshot.dataUrl],
			maxTokens: 360,
			temperature: 0.1,
			timeoutMs: 30_000,
			jsonResponse: true,
		});
		let parsed = parseObservationDecisionResponse(content);
		const discouragedOpeningMoveSet = new Set(discouragedOpeningMoves);
		const openingMove = parsed.plannedMoves[0];
		if (openingMove && discouragedOpeningMoveSet.has(openingMove)) {
			const retryPrompt = [
				basePrompt,
				"Planner contract check (must follow):",
				`- Your previous proposal starts with ${formatSokobanAction(openingMove)}, but this opening move is in the discouraged set: ${discouragedOpeningMoves.map((move) => formatSokobanAction(move)).join(", ")}.`,
				"- Re-plan with a materially different opening move.",
				"- You may keep the same opening move only when you can explicitly cite a concrete board change that made the previous failed opening valid again.",
				"Return strict JSON with the same keys only.",
			].join("\n\n");
			const retriedContent = await requestActiveVisionDecision({
				systemPrompt: [
					"You revise Sokoban short plans to satisfy anti-repeat planning constraints.",
					"Treat the provided screenshot as the only source of truth.",
					"Return strict JSON only.",
				].join("\n"),
				userPrompt: retryPrompt,
				imageDataUrls: [referenceSnapshot.dataUrl],
				maxTokens: 360,
				temperature: 0.05,
				timeoutMs: 30_000,
				jsonResponse: true,
			});
			const retriedParsed = parseObservationDecisionResponse(retriedContent);
			const retriedOpeningMove = retriedParsed.plannedMoves[0];
			if (retriedOpeningMove && !discouragedOpeningMoveSet.has(retriedOpeningMove)) {
				parsed = retriedParsed;
			} else {
				log.warn("sokoban planner repeated discouraged opening move after retry", {
					target: target.title,
					discouragedOpeningMoves,
					originalOpeningMove: openingMove,
					retriedOpeningMove: retriedOpeningMove ?? null,
				});
			}
		}

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
		let cloudChanged: boolean | null = null;
		try {
			const content = await requestActiveVisionDecision({
				systemPrompt: [
					"You compare two consecutive Sokoban screenshots.",
					"Image #1 is before the move, image #2 is after the move.",
					"Decide whether the board state has visibly changed.",
					"Ignore tiny rendering noise and browser UI flicker.",
					"Return strict JSON: {\"changed\": boolean, \"reason\": string}.",
				].join("\n"),
				userPrompt: `Executed move: ${formatSokobanAction(move)}. Determine whether the board changed.`,
				imageDataUrls: [beforeSnapshot.dataUrl, afterSnapshot.dataUrl],
				maxTokens: 140,
				temperature: 0,
				timeoutMs: 30_000,
				jsonResponse: true,
			});
			cloudChanged = parseVisionChangedFlag(content);
		} catch (err) {
			log.warn("sokoban cloud vision verification failed, fallback to pixel threshold", {
				move,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		log.info("sokoban verification verdict", {
			move,
			verificationInput: "before-after-screenshots",
			cloudChanged,
			changeRatio,
			threshold: 0.003,
			fallbackUsed: cloudChanged === null,
		});
		return {
			move,
			changed: cloudChanged ?? changeRatio >= 0.003,
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
		reflection: "Preparing the next Sokoban validation round from screenshot evidence.",
		strategy: "capture the current board screenshot, ask the cloud vision model for a short grounded move sequence, then verify per-step changes",
		reasoning: "The runtime is still preparing screenshot evidence for the next sequence.",
		plannedMoves: DEFAULT_MOVE_ORDER.slice(0, 2),
	};
}

function buildObservationDecisionPrompt(
	targetTitle: string,
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
			"Identify the player, boxes, walls, and targets only from the provided screenshot.",
			"When the board is static and legible enough, prefer a bounded short plan of 2-4 moves; only fall back to a single move if the screenshot is genuinely too ambiguous.",
			"Prefer moves that either reposition the player productively or make visible progress toward a target.",
			"Explain progress in concrete puzzle terms: player position, the box just approached or pushed, and whether target alignment or access improved.",
			"Describe the player's location relative to the nearest wall, corridor, or box cluster so the next step sounds grounded in the current board.",
			"Before choosing a short plan, identify the nearest actionable box and explain whether the first move is for repositioning, opening a route, or pushing.",
			"If the first move only repositions the player, say that explicitly and explain what box, corridor, or target setup it improves.",
			"Do not call a move 'progress' just because the player sprite moved; distinguish between useful repositioning, a real push, better target alignment, and completely hitting a wall.",
			"Avoid repeating the same failed probe pattern without a new justification.",
			discouragedOpeningMoves.length
				? `Recent failed opening moves: ${discouragedOpeningMoves.map((move) => formatSokobanAction(move)).join(", ")}. The first move of your new plannedMoves must be different unless you can point to a concrete new board change that makes reusing the failed opening move valid.`
				: "No discouraged opening move is currently recorded.",
			discouragedPlanSignature
				? `Do not repeat this exact failed short plan signature unless the local observation is clearly different: ${discouragedPlanSignature}.`
				: "No exact failed plan signature is currently blocked.",
			repeatedFailureHint ?? "If the last exact sequence already failed, choose a materially different short plan unless the board is clearly different now.",
		],
		recentDecisions: recentDecisionSummary,
		goal: "Choose a short Sokoban move sequence that is most likely to produce visible progress without obvious deadlock risk, using only the provided screenshot.",
	});

	return [
		promptBody,
		"You will receive one screenshot image showing the current Sokoban board.",
		"Return strict JSON with keys: reflection, strategy, reasoning, decisionSummary, plannedMoves.",
		`plannedMoves must be an ordered array containing only these ids: move_up, move_left, move_right, move_down, and must contain between 1 and ${MAX_PLANNED_MOVES} moves.`,
		"Use a bounded short plan, not an open-ended full walkthrough, and do not include markdown fences or extra keys.",
	].join("\n\n");
}

function parseVisionChangedFlag(content: string): boolean {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		changed?: unknown;
		boardChanged?: unknown;
		hasChange?: unknown;
	};
	const candidate = parsed.changed ?? parsed.boardChanged ?? parsed.hasChange;
	const normalized = normalizeVisionBoolean(candidate);
	if (normalized === null) {
		throw new Error("vision verification response missing boolean changed flag");
	}
	return normalized;
}

function normalizeVisionBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	if (
		normalized === "true"
		|| normalized === "yes"
		|| normalized === "1"
		|| normalized.includes("有变化")
		|| normalized.includes("发生变化")
		|| normalized.includes("changed")
	) {
		return true;
	}
	if (
		normalized === "false"
		|| normalized === "no"
		|| normalized === "0"
		|| normalized.includes("无变化")
		|| normalized.includes("没有变化")
		|| normalized.includes("unchanged")
	) {
		return false;
	}
	return null;
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
		const openingMove = entry.plannedMoves[0] ?? null;
		const openingOutcome = openingMove && entry.failedMoves.includes(openingMove)
			? "opening-failed"
			: "opening-not-failed";
		const outcome = entry.boardChanged ? "board changed during the sequence" : "no verified board change";
		const repeatedFailureNote = entry.repeatedFailureCount > 0 ? ` repeatedFailureCount=${entry.repeatedFailureCount};` : "";
		return `Turn ${index + 1}: planned=${planned}; executed=${executed}; failed=${failed}; openingOutcome=${openingOutcome}; outcome=${outcome};${repeatedFailureNote} reflection=${entry.reflection}`;
	});
}

function collectRecentFailedOpeningMoves(history: SokobanDecisionHistoryEntry[]): SokobanActionId[] {
	const moves: SokobanActionId[] = [];
	for (const entry of history) {
		const openingMove = entry.plannedMoves[0];
		if (!openingMove) {
			continue;
		}
		const openingFailed = entry.failedMoves.includes(openingMove);
		if (!openingFailed) {
			continue;
		}
		if (!moves.includes(openingMove)) {
			moves.push(openingMove);
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
			? "截图对照加云端视觉决策"
			: "保守启发式";
		return `我先按 ${sourceLabel} 规划了一小段推箱子动作，并确认至少有一步真的让棋盘状态发生了变化。`;
	}

	return "这轮推箱子动作没有观察到足够明显的画面变化。可能当前画面不是关卡主视图，或者计划动作全都撞墙了。";
}
