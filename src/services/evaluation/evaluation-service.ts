import type { CharacterService } from "@/services/character";
import type { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { Game2048Service } from "@/services/games";
import type { OrchestratorService } from "@/services/orchestrator";
import type { UnifiedRuntimeService } from "@/services/unified";
import type {
	EvaluationCaseDefinition,
	EvaluationCaseMetrics,
	EvaluationCaseResult,
	EvaluationRunEntry,
	EvaluationState,
} from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("evaluation");
const MAX_HISTORY = 10;

const EVALUATION_CASES: EvaluationCaseDefinition[] = [
	{
		id: "2048-auto-detect-smoke",
		game: "2048",
		name: "2048 Auto-Detect Smoke",
		description: "Auto-detect a 2048 window and attempt one validated move per iteration.",
		targetMode: "auto-detect",
		iterations: 3,
	},
	{
		id: "2048-selected-target-repeat",
		game: "2048",
		name: "2048 Selected Target Repeat",
		description: "Reuse the currently selected target and measure repeated single-step execution stability.",
		targetMode: "selected-target",
		iterations: 5,
	},
	{
		id: "fusion-selected-target-round",
		game: "fusion",
		name: "Fusion Selected Target Round",
		description: "Use the current target with companion runtime context and run one unified game round with speech/expression follow-up.",
		targetMode: "selected-target",
		iterations: 3,
	},
];

function makeInitialState(): EvaluationState {
	return {
		activeCaseId: null,
		availableCases: EVALUATION_CASES.map((definition) => ({ ...definition })),
		latestResult: null,
		history: [],
	};
}

export class EvaluationService {
	private bus: EventBus;
	private character: CharacterService;
	private game2048: Game2048Service;
	private orchestrator: OrchestratorService;
	private unified: UnifiedRuntimeService;
	private companionRuntime: CompanionRuntimeService;
	private state: EvaluationState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		character: CharacterService;
		game2048: Game2048Service;
		orchestrator: OrchestratorService;
		unified: UnifiedRuntimeService;
		companionRuntime: CompanionRuntimeService;
	}) {
		this.bus = deps.bus;
		this.character = deps.character;
		this.game2048 = deps.game2048;
		this.orchestrator = deps.orchestrator;
		this.unified = deps.unified;
		this.companionRuntime = deps.companionRuntime;
	}

	getState(): Readonly<EvaluationState> {
		return {
			...this.state,
			availableCases: this.state.availableCases.map((definition) => ({ ...definition })),
			latestResult: this.state.latestResult ? cloneResult(this.state.latestResult) : null,
			history: this.state.history.map(cloneResult),
		};
	}

	getCases(): EvaluationCaseDefinition[] {
		return this.state.availableCases.map((definition) => ({ ...definition }));
	}

	async runCase(caseId: string): Promise<EvaluationCaseResult> {
		const definition = this.state.availableCases.find((candidate) => candidate.id === caseId);
		if (!definition) {
			throw new Error(`unknown evaluation case: ${caseId}`);
		}
		if (this.state.activeCaseId) {
			throw new Error(`evaluation already running: ${this.state.activeCaseId}`);
		}

		const result: EvaluationCaseResult = {
			caseId: definition.id,
			caseName: definition.name,
			status: "running",
			startedAt: Date.now(),
			endedAt: null,
			metrics: emptyMetrics(definition.iterations),
			runs: [],
			summary: "",
		};

		this.state.activeCaseId = definition.id;
		this.state.latestResult = cloneResult(result);
		this.bus.emit("evaluation:case-start", {
			caseId: definition.id,
			game: definition.game,
			name: definition.name,
			iterations: definition.iterations,
		});
		this.emitState();

		for (let index = 0; index < definition.iterations; index += 1) {
			const runStartedAt = Date.now();

			try {
				const gameRun = await this.runGameCase(definition);

				const latencyMs = Date.now() - runStartedAt;
				const actionValid = Boolean(
					gameRun.boardChanged
					&& gameRun.selectedAction
					&& gameRun.preferredActions.includes(gameRun.selectedAction),
				);

				result.runs.push({
					index: index + 1,
					status: "completed",
					latencyMs,
					boardChanged: gameRun.boardChanged,
					actionValid,
					selectedAction: gameRun.selectedAction,
					analysisSource: gameRun.analysis.source,
					runtimeContextUsed: gameRun.runtimeContextUsed,
					llmReplyUsed: gameRun.llmReplyUsed,
					spoke: gameRun.spoke,
					emotionApplied: gameRun.emotionApplied,
					summary: gameRun.summary,
					error: null,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				result.runs.push({
					index: index + 1,
					status: "failed",
					latencyMs: Date.now() - runStartedAt,
					boardChanged: false,
					actionValid: false,
					selectedAction: null,
					analysisSource: null,
					runtimeContextUsed: false,
					llmReplyUsed: false,
					spoke: false,
					emotionApplied: false,
					summary: message,
					error: message,
				});
			}

			result.metrics = computeMetrics(result.runs, definition.iterations);
			result.summary = buildSummary(definition, result.metrics);
			this.state.latestResult = cloneResult(result);
			this.emitState();
		}

		result.status = result.metrics.successfulRuns > 0 ? "completed" : "failed";
		result.endedAt = Date.now();
		result.summary = buildSummary(definition, result.metrics);

		this.state.activeCaseId = null;
		this.state.latestResult = cloneResult(result);
		this.state.history = [cloneResult(result), ...this.state.history].slice(0, MAX_HISTORY);
		this.bus.emit("evaluation:case-complete", { result: cloneResult(result) });
		this.emitState();

		log.info("evaluation case completed", {
			caseId: result.caseId,
			status: result.status,
			metrics: result.metrics,
		});

		return cloneResult(result);
	}

	private emitState() {
		this.bus.emit("evaluation:state-change", { state: this.getState() });
	}

	private async runGameCase(definition: EvaluationCaseDefinition): Promise<{
		boardChanged: boolean;
		selectedAction: string | null;
		preferredActions: string[];
		analysis: { source: string };
		runtimeContextUsed: boolean;
		llmReplyUsed: boolean;
		spoke: boolean;
		emotionApplied: boolean;
		summary: string;
	}> {
		if (definition.game === "2048") {
			if (definition.targetMode === "auto-detect") {
				await this.game2048.detectTargetWindow();
				const run = await this.game2048.runSingleStep();
				return {
					boardChanged: run.boardChanged,
					selectedAction: run.selectedMove,
					preferredActions: run.analysis.preferredMoves,
					analysis: { source: run.analysis.source },
					runtimeContextUsed: false,
					llmReplyUsed: false,
					spoke: false,
					emotionApplied: false,
					summary: run.summary,
				};
			}

			const selectedTarget = this.orchestrator.getState().selectedTarget;
			if (!selectedTarget) {
				throw new Error("selected-target evaluation requires a manually selected target");
			}
			const run = await this.game2048.runSingleStep(selectedTarget);
			return {
				boardChanged: run.boardChanged,
				selectedAction: run.selectedMove,
				preferredActions: run.analysis.preferredMoves,
				analysis: { source: run.analysis.source },
				runtimeContextUsed: false,
				llmReplyUsed: false,
				spoke: false,
				emotionApplied: false,
				summary: run.summary,
			};
		}
		if (definition.game === "fusion") {
			const selectedTarget = this.orchestrator.getState().selectedTarget;
			if (!selectedTarget) {
				throw new Error("fusion evaluation requires a manually selected target");
			}

			const runtimeState = this.companionRuntime.getState();
			if (!runtimeState.running || runtimeState.target?.handle !== selectedTarget.handle) {
				await this.companionRuntime.start(selectedTarget);
			}
			if (!this.companionRuntime.getState().lastSummary) {
				await this.companionRuntime.runSummaryNow();
			}

			const promptContext = this.companionRuntime.getPromptContext();
			const run = await this.unified.runUnifiedGameStep("manual", "evaluation fusion round");
			const characterState = this.character.getState();
			return {
				boardChanged: run.status === "completed",
				selectedAction: run.selectedAction,
				preferredActions: run.selectedAction ? [run.selectedAction] : [],
				analysis: { source: run.companionTextSource },
				runtimeContextUsed: promptContext.length > 0,
				llmReplyUsed: run.companionTextSource === "llm",
				spoke: run.spoke,
				emotionApplied: characterState.emotion === run.emotion,
				summary: run.summary,
			};
		}
		throw new Error(`unsupported evaluation game: ${definition.game}`);
	}
}

function emptyMetrics(totalRuns: number): EvaluationCaseMetrics {
	return {
		totalRuns,
		successfulRuns: 0,
		validActions: 0,
		successRate: 0,
		actionValidityRate: 0,
		runtimeContextRate: 0,
		llmReplyRate: 0,
		speechRate: 0,
		emotionRate: 0,
		averageLatencyMs: 0,
		medianLatencyMs: 0,
	};
}

function computeMetrics(runs: EvaluationRunEntry[], totalRuns: number): EvaluationCaseMetrics {
	const latencies = runs.map((run) => run.latencyMs).sort((left, right) => left - right);
	const successfulRuns = runs.filter((run) => run.boardChanged).length;
	const validActions = runs.filter((run) => run.actionValid).length;
	const runtimeContextRuns = runs.filter((run) => run.runtimeContextUsed).length;
	const llmReplyRuns = runs.filter((run) => run.llmReplyUsed).length;
	const spokenRuns = runs.filter((run) => run.spoke).length;
	const emotionRuns = runs.filter((run) => run.emotionApplied).length;

	return {
		totalRuns,
		successfulRuns,
		validActions,
		successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
		actionValidityRate: totalRuns > 0 ? validActions / totalRuns : 0,
		runtimeContextRate: totalRuns > 0 ? runtimeContextRuns / totalRuns : 0,
		llmReplyRate: totalRuns > 0 ? llmReplyRuns / totalRuns : 0,
		speechRate: totalRuns > 0 ? spokenRuns / totalRuns : 0,
		emotionRate: totalRuns > 0 ? emotionRuns / totalRuns : 0,
		averageLatencyMs: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
		medianLatencyMs: computeMedian(latencies),
	};
}

function computeMedian(values: number[]): number {
	if (values.length === 0) return 0;
	const midpoint = Math.floor(values.length / 2);
	if (values.length % 2 === 1) return values[midpoint];
	return (values[midpoint - 1] + values[midpoint]) / 2;
}

function buildSummary(definition: EvaluationCaseDefinition, metrics: EvaluationCaseMetrics): string {
	if (definition.game === "fusion") {
		return `${definition.name}: success ${formatPercent(metrics.successRate)}, runtime ${formatPercent(metrics.runtimeContextRate)}, llm ${formatPercent(metrics.llmReplyRate)}, speech ${formatPercent(metrics.speechRate)}, emotion ${formatPercent(metrics.emotionRate)}, avg latency ${metrics.averageLatencyMs.toFixed(0)}ms`;
	}
	return `${definition.name}: success ${formatPercent(metrics.successRate)}, valid ${formatPercent(metrics.actionValidityRate)}, avg latency ${metrics.averageLatencyMs.toFixed(0)}ms`;
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(0)}%`;
}

function cloneResult(result: EvaluationCaseResult): EvaluationCaseResult {
	return {
		...result,
		metrics: { ...result.metrics },
		runs: result.runs.map((run) => ({ ...run })),
	};
}
