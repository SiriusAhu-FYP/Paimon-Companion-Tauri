import type { EventBus } from "@/services/event-bus";
import type { OrchestratorService } from "@/services/orchestrator";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import { requestOpenAICompatibleVision, resolveActiveOpenAICompatibleVisionClient } from "@/services/vlm";
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
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";
import type { SemanticActionExecutionResult } from "@/types";

const log = createLogger("sokoban");
const MAX_RUN_HISTORY = 10;
const MAX_DECISION_HISTORY = 8;
const MAX_PLANNED_MOVES = 4;
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

		let target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			target = await this.detectTargetWindow();
		}
		if (!target) {
			throw new Error("no target window selected and no sokoban window could be detected");
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

	private async buildAnalysis(target: FunctionalTarget, snapshot: PerceptionSnapshot): Promise<SokobanAnalysis> {
		const recentDecisionSummary = buildRecentDecisionSummary(this.state.decisionHistory);
		const repeatedFailureHint = buildRepeatedFailureHint(this.state.decisionHistory[0]);

		try {
			return await this.requestVisionAnalysis(target, snapshot, recentDecisionSummary, repeatedFailureHint);
		} catch (err) {
			log.warn("sokoban vision analysis unavailable, falling back to heuristic", err);
			return buildHeuristicAnalysis(recentDecisionSummary, this.state.decisionHistory[0] ?? null);
		}
	}

	private async requestVisionAnalysis(
		target: FunctionalTarget,
		snapshot: PerceptionSnapshot,
		recentDecisionSummary: string[],
		repeatedFailureHint: string | null,
	): Promise<SokobanAnalysis> {
		const client = resolveActiveOpenAICompatibleVisionClient();
		if (!client) {
			throw new Error("vision analysis requires an openai-compatible LLM profile");
		}

		const content = await requestOpenAICompatibleVision({
			client,
			userPrompt: buildVisionPrompt(target.title, recentDecisionSummary, repeatedFailureHint),
			imageDataUrl: snapshot.dataUrl,
			maxTokens: 320,
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
			plannedMoves: parsed.plannedMoves,
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
			changed: changeRatio >= 0.01,
			changeRatio,
		};
	}

	private emitState() {
		this.bus.emit("sokoban:state-change", { state: this.getState() });
	}
}

function buildPendingAnalysis(): SokobanAnalysis {
	return {
		source: "heuristic",
		reflection: "Preparing the next Sokoban validation round.",
		strategy: "capture the board, propose a short semantic move sequence, then verify per-step changes",
		reasoning: "The runtime is still capturing the baseline snapshot and analysis context.",
		plannedMoves: DEFAULT_MOVE_ORDER.slice(0, 2),
	};
}

function buildHeuristicAnalysis(
	recentDecisionSummary: string[],
	lastDecision: SokobanDecisionHistoryEntry | null,
): SokobanAnalysis {
	const historyHint = recentDecisionSummary.length
		? "Recent history exists, so avoid repeating the exact same dead move pattern without a new reason."
		: "No prior Sokoban history is available yet.";
	const fallbackCandidates: SokobanActionId[][] = [
		["move_up", "move_left"],
		["move_right", "move_up"],
		["move_left", "move_down"],
		["move_up", "move_right"],
	];
	const plannedMoves = selectFallbackSequence(fallbackCandidates, lastDecision?.planSignature ?? null);

	return {
		source: "heuristic",
		reflection: `Fallback to a short exploratory Sokoban sequence. ${historyHint}`,
		strategy: "probe short movement sequences instead of committing to a long push chain without visual confidence",
		reasoning: "Without image reasoning, prefer a short conservative sequence that can still prove the runtime loop works.",
		plannedMoves,
	};
}

function buildVisionPrompt(
	targetTitle: string,
	recentDecisionSummary: string[],
	repeatedFailureHint: string | null,
): string {
	const promptBody = buildSharedGamePrompt({
		gameName: SOKOBAN_PLUGIN.displayName,
		taskName: "short push-planning validation round",
		targetWindow: targetTitle,
		actionList: SOKOBAN_PLUGIN.actions.map((action) => `${action.id}: ${action.description}`),
		gameRules: [
			"You can push boxes but never pull them.",
			"Avoid pushing a box into a non-target corner whenever possible.",
			"Return only a short move sequence for the next validation round, not a full solution transcript.",
		],
		stateCues: [
			"Identify the player, boxes, walls, and targets before proposing a sequence.",
			"Prefer moves that either reposition the player productively or make visible progress toward a target.",
			"Avoid repeating the same failed probe pattern without a new justification.",
			repeatedFailureHint ?? "If the last exact sequence already failed, choose a materially different short plan unless the board is clearly different now.",
		],
		recentDecisions: recentDecisionSummary,
		goal: "Choose a short Sokoban move sequence that is most likely to produce visible progress without obvious deadlock risk.",
	});

	return [
		promptBody,
		"Analyze the screenshot and plan the next short Sokoban sequence.",
		"Return strict JSON with keys: reflection, strategy, reasoning, plannedMoves.",
		"plannedMoves must be an array of 1 to 4 action IDs chosen from: move_up, move_left, move_right, move_down.",
		"plannedMoves may repeat directions if needed, but keep the sequence short and purposeful.",
	].join("\n\n");
}

function parseVisionResponse(content: string): {
	reflection: string;
	strategy: string;
	reasoning: string;
	plannedMoves: SokobanActionId[];
} {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		reflection?: unknown;
		strategy?: unknown;
		reasoning?: unknown;
		plannedMoves?: unknown;
	};

	const plannedMoves = normalizeMoves(parsed.plannedMoves);
	if (!plannedMoves.length) {
		throw new Error("vision analysis did not return a valid Sokoban move sequence");
	}

	return {
		reflection: typeof parsed.reflection === "string"
			? parsed.reflection
			: "No explicit reflection was returned. Use the current screenshot and recent history conservatively.",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy : "vision-guided Sokoban sequence selection",
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "The model selected a short sequence based on the screenshot.",
		plannedMoves,
	};
}

function normalizeMoves(value: unknown): SokobanActionId[] {
	if (!Array.isArray(value)) {
		throw new Error("plannedMoves is not an array");
	}

	return value
		.map((entry) => String(entry))
		.filter((entry): entry is SokobanActionId => DEFAULT_MOVE_ORDER.includes(entry as SokobanActionId))
		.slice(0, MAX_PLANNED_MOVES);
}

function selectFallbackSequence(candidates: SokobanActionId[][], failedSignature: string | null): SokobanActionId[] {
	if (!failedSignature) {
		return candidates[0];
	}

	for (const candidate of candidates) {
		if (buildPlanSignature(candidate) !== failedSignature) {
			return candidate;
		}
	}

	return candidates[0];
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

function buildRunSummary(run: SokobanRunRecord): string {
	if (run.boardChanged) {
		return `sokoban validation verified ${run.executedMoves.length} board-changing move(s) via ${run.analysis.source}`;
	}

	return `sokoban validation found no verified board change after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: SokobanRunRecord): string {
	if (run.boardChanged) {
		return `我先按 ${run.analysis.source === "vision-llm" ? "截图分析" : "保守启发式"} 规划了一小段推箱子动作，并确认至少有一步真的让棋盘状态发生了变化。`;
	}

	return "这轮推箱子动作没有观察到足够明显的画面变化。可能当前画面不是关卡主视图，或者计划动作全都撞墙了。";
}
