import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";
import type {
	CompanionRuntimeBenchmarkDefinition,
	CompanionRuntimeBenchmarkMetrics,
	CompanionRuntimeBenchmarkResult,
	CompanionRuntimeBenchmarkState,
	FunctionalTarget,
} from "@/types";
import type { CompanionRuntimeService } from "./companion-runtime-service";

const log = createLogger("companion-runtime-benchmark");
const MAX_HISTORY = 10;

const BENCHMARKS: CompanionRuntimeBenchmarkDefinition[] = [
	{
		id: "companion-runtime-observation-smoke",
		name: "Companion Observation Smoke",
		description: "Observe the selected target for 20 seconds and capture lightweight throughput metrics.",
		durationMs: 20_000,
	},
	{
		id: "companion-runtime-observation-stability",
		name: "Companion Observation Stability",
		description: "Observe the selected target for 35 seconds and measure summary cadence and unchanged-frame ratio.",
		durationMs: 35_000,
	},
];

function emptyMetrics(durationMs: number): CompanionRuntimeBenchmarkMetrics {
	return {
		durationMs,
		captureTicks: 0,
		visionFrames: 0,
		unchangedFrames: 0,
		unchangedRatio: 0,
		summariesGenerated: 0,
		framesPerMinute: 0,
		summariesPerMinute: 0,
		averageFrameLatencyMs: 0,
		averageSummaryLatencyMs: 0,
	};
}

function cloneResult(result: CompanionRuntimeBenchmarkResult): CompanionRuntimeBenchmarkResult {
	return {
		...result,
		metrics: { ...result.metrics },
	};
}

function makeInitialState(): CompanionRuntimeBenchmarkState {
	return {
		activeBenchmarkId: null,
		availableBenchmarks: BENCHMARKS.map((benchmark) => ({ ...benchmark })),
		latestResult: null,
		history: [],
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function buildMetrics(durationMs: number, runtimeState: ReturnType<CompanionRuntimeService["getState"]>): CompanionRuntimeBenchmarkMetrics {
	const minutes = durationMs > 0 ? durationMs / 60_000 : 0;
	const captureTicks = runtimeState.metrics.captureTicks;
	const summariesGenerated = runtimeState.metrics.summariesGenerated;
	return {
		durationMs,
		captureTicks,
		visionFrames: runtimeState.metrics.visionFrames,
		unchangedFrames: runtimeState.metrics.unchangedFrames,
		unchangedRatio: captureTicks > 0 ? runtimeState.metrics.unchangedFrames / captureTicks : 0,
		summariesGenerated,
		framesPerMinute: minutes > 0 ? captureTicks / minutes : 0,
		summariesPerMinute: minutes > 0 ? summariesGenerated / minutes : 0,
		averageFrameLatencyMs: runtimeState.metrics.averageFrameLatencyMs,
		averageSummaryLatencyMs: runtimeState.metrics.averageSummaryLatencyMs,
	};
}

export class CompanionRuntimeBenchmarkService {
	private bus: EventBus;
	private companionRuntime: CompanionRuntimeService;
	private state: CompanionRuntimeBenchmarkState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		companionRuntime: CompanionRuntimeService;
	}) {
		this.bus = deps.bus;
		this.companionRuntime = deps.companionRuntime;
	}

	getState(): Readonly<CompanionRuntimeBenchmarkState> {
		return {
			...this.state,
			availableBenchmarks: this.state.availableBenchmarks.map((benchmark) => ({ ...benchmark })),
			latestResult: this.state.latestResult ? cloneResult(this.state.latestResult) : null,
			history: this.state.history.map(cloneResult),
		};
	}

	async runBenchmark(benchmarkId: string, target: FunctionalTarget): Promise<CompanionRuntimeBenchmarkResult> {
		const definition = this.state.availableBenchmarks.find((candidate) => candidate.id === benchmarkId);
		if (!definition) {
			throw new Error(`unknown companion runtime benchmark: ${benchmarkId}`);
		}
		if (!target) {
			throw new Error("companion runtime benchmark requires a selected target");
		}
		if (this.state.activeBenchmarkId) {
			throw new Error(`companion runtime benchmark already running: ${this.state.activeBenchmarkId}`);
		}
		if (this.companionRuntime.getState().running) {
			throw new Error("stop the current companion runtime session before running a benchmark");
		}

		const result: CompanionRuntimeBenchmarkResult = {
			benchmarkId: definition.id,
			benchmarkName: definition.name,
			status: "running",
			startedAt: Date.now(),
			endedAt: null,
			targetTitle: target.title,
			metrics: emptyMetrics(definition.durationMs),
			latestSummary: null,
			latestSummarySource: null,
			error: null,
		};

		this.state.activeBenchmarkId = definition.id;
		this.state.latestResult = cloneResult(result);
		this.bus.emit("companion-runtime:benchmark-start", {
			benchmarkId: definition.id,
			name: definition.name,
			durationMs: definition.durationMs,
			targetTitle: target.title,
		});
		this.emitState();

		try {
			this.companionRuntime.clearHistory();
			await this.companionRuntime.start(target);
			await delay(definition.durationMs);
			await this.companionRuntime.runSummaryNow();

			const runtimeState = this.companionRuntime.getState();
			const endedAt = Date.now();
			result.status = "completed";
			result.endedAt = endedAt;
			result.metrics = buildMetrics(endedAt - result.startedAt, runtimeState);
			result.latestSummary = runtimeState.lastSummary?.summary ?? null;
			result.latestSummarySource = runtimeState.lastSummary?.source ?? null;
			log.info("companion runtime benchmark completed", {
				benchmarkId: result.benchmarkId,
				target: result.targetTitle,
				metrics: result.metrics,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.status = "failed";
			result.endedAt = Date.now();
			result.error = message;
			result.metrics = buildMetrics(result.endedAt - result.startedAt, this.companionRuntime.getState());
			log.error("companion runtime benchmark failed", err);
		} finally {
			this.companionRuntime.stop();
		}

		this.state.activeBenchmarkId = null;
		this.state.latestResult = cloneResult(result);
		this.state.history = [cloneResult(result), ...this.state.history].slice(0, MAX_HISTORY);
		this.bus.emit("companion-runtime:benchmark-complete", { result: cloneResult(result) });
		this.emitState();
		return cloneResult(result);
	}

	private emitState() {
		this.bus.emit("companion-runtime:benchmark-state-change", { state: this.getState() });
	}
}
