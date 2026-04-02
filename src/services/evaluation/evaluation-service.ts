import type { EventBus } from "@/services/event-bus";
import type { Game2048Service } from "@/services/games";
import type { OrchestratorService } from "@/services/orchestrator";
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
		name: "2048 Auto-Detect Smoke",
		description: "Auto-detect a 2048 window and attempt one validated move per iteration.",
		targetMode: "auto-detect",
		iterations: 3,
	},
	{
		id: "2048-selected-target-repeat",
		name: "2048 Selected Target Repeat",
		description: "Reuse the currently selected target and measure repeated single-step execution stability.",
		targetMode: "selected-target",
		iterations: 5,
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
	private game2048: Game2048Service;
	private orchestrator: OrchestratorService;
	private state: EvaluationState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		game2048: Game2048Service;
		orchestrator: OrchestratorService;
	}) {
		this.bus = deps.bus;
		this.game2048 = deps.game2048;
		this.orchestrator = deps.orchestrator;
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
			name: definition.name,
			iterations: definition.iterations,
		});
		this.emitState();

		for (let index = 0; index < definition.iterations; index += 1) {
			const runStartedAt = Date.now();

			try {
				let gameRun;
				if (definition.targetMode === "auto-detect") {
					await this.game2048.detectTargetWindow();
					gameRun = await this.game2048.runSingleStep();
				} else {
					const selectedTarget = this.orchestrator.getState().selectedTarget;
					if (!selectedTarget) {
						throw new Error("selected-target evaluation requires a manually selected target");
					}
					gameRun = await this.game2048.runSingleStep(selectedTarget);
				}

				const latencyMs = Date.now() - runStartedAt;
				const actionValid = Boolean(
					gameRun.boardChanged
					&& gameRun.selectedMove
					&& gameRun.analysis.preferredMoves.includes(gameRun.selectedMove),
				);

				result.runs.push({
					index: index + 1,
					status: "completed",
					latencyMs,
					boardChanged: gameRun.boardChanged,
					actionValid,
					selectedMove: gameRun.selectedMove,
					analysisSource: gameRun.analysis.source,
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
					selectedMove: null,
					analysisSource: null,
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
}

function emptyMetrics(totalRuns: number): EvaluationCaseMetrics {
	return {
		totalRuns,
		successfulRuns: 0,
		validActions: 0,
		successRate: 0,
		actionValidityRate: 0,
		averageLatencyMs: 0,
		medianLatencyMs: 0,
	};
}

function computeMetrics(runs: EvaluationRunEntry[], totalRuns: number): EvaluationCaseMetrics {
	const latencies = runs.map((run) => run.latencyMs).sort((left, right) => left - right);
	const successfulRuns = runs.filter((run) => run.boardChanged).length;
	const validActions = runs.filter((run) => run.actionValid).length;

	return {
		totalRuns,
		successfulRuns,
		validActions,
		successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
		actionValidityRate: totalRuns > 0 ? validActions / totalRuns : 0,
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
