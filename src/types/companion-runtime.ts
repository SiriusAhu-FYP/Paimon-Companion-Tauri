import type { FunctionalTarget } from "./functional";

export type CompanionRuntimePhase = "idle" | "connecting" | "capturing" | "describing" | "summarizing" | "error";
export type CompanionRuntimeDiagnosticCode =
	| "runtime-not-running"
	| "runtime-auto-starting"
	| "observation-not-ready"
	| "local-vision-unavailable"
	| "target-mismatch"
	| "post-action-timeout"
	| "below-threshold-change";

export interface CompanionFrameDescriptionRecord {
	id: string;
	targetTitle: string;
	capturedAt: number;
	description: string;
	source: "vision" | "unchanged";
	captureMethod: string;
	qualityScore: number;
	changeRatio: number | null;
}

export interface CompanionSummaryRecord {
	id: string;
	createdAt: number;
	windowStartedAt: number;
	windowEndedAt: number;
	frameCount: number;
	summary: string;
	source: "cloud" | "fallback";
}

export interface CompanionRuntimeMetrics {
	sessionStartedAt: number | null;
	lastCaptureAt: number | null;
	captureTicks: number;
	visionFrames: number;
	unchangedFrames: number;
	summariesGenerated: number;
	averageFrameLatencyMs: number;
	averageSummaryLatencyMs: number;
	lastFrameLatencyMs: number | null;
	lastSummaryLatencyMs: number | null;
}

export interface CompanionRuntimeBenchmarkDefinition {
	id: string;
	name: string;
	description: string;
	durationMs: number;
}

export interface CompanionRuntimeBenchmarkMetrics {
	durationMs: number;
	captureTicks: number;
	visionFrames: number;
	unchangedFrames: number;
	unchangedRatio: number;
	summariesGenerated: number;
	framesPerMinute: number;
	summariesPerMinute: number;
	averageFrameLatencyMs: number;
	averageSummaryLatencyMs: number;
}

export interface CompanionRuntimeBenchmarkResult {
	benchmarkId: string;
	benchmarkName: string;
	status: "running" | "completed" | "failed";
	startedAt: number;
	endedAt: number | null;
	targetTitle: string;
	metrics: CompanionRuntimeBenchmarkMetrics;
	latestSummary: string | null;
	latestSummarySource: CompanionSummaryRecord["source"] | null;
	error: string | null;
}

export interface CompanionRuntimeBenchmarkState {
	activeBenchmarkId: string | null;
	availableBenchmarks: CompanionRuntimeBenchmarkDefinition[];
	latestResult: CompanionRuntimeBenchmarkResult | null;
	history: CompanionRuntimeBenchmarkResult[];
}

export interface CompanionRuntimeState {
	running: boolean;
	phase: CompanionRuntimePhase;
	target: FunctionalTarget | null;
	localVisionBaseUrl: string;
	localVisionModel: string;
	captureIntervalMs: number;
	summaryWindowMs: number;
	historyRetentionMs: number;
	lastFrame: CompanionFrameDescriptionRecord | null;
	lastSummary: CompanionSummaryRecord | null;
	frameQueue: CompanionFrameDescriptionRecord[];
	summaryHistory: CompanionSummaryRecord[];
	metrics: CompanionRuntimeMetrics;
	observationReady: boolean;
	lastObservationAt: number | null;
	diagnosticCode: CompanionRuntimeDiagnosticCode | null;
	diagnosticMessage: string | null;
	lastError: string | null;
}
