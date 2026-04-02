import type { Game2048AnalysisSource, Game2048Move } from "./game-2048";

export type EvaluationCaseTargetMode = "auto-detect" | "selected-target";
export type EvaluationCaseStatus = "running" | "completed" | "failed";

export interface EvaluationCaseDefinition {
	id: string;
	name: string;
	description: string;
	targetMode: EvaluationCaseTargetMode;
	iterations: number;
}

export interface EvaluationRunEntry {
	index: number;
	status: "completed" | "failed";
	latencyMs: number;
	boardChanged: boolean;
	actionValid: boolean;
	selectedMove: Game2048Move | null;
	analysisSource: Game2048AnalysisSource | null;
	summary: string;
	error: string | null;
}

export interface EvaluationCaseMetrics {
	totalRuns: number;
	successfulRuns: number;
	validActions: number;
	successRate: number;
	actionValidityRate: number;
	averageLatencyMs: number;
	medianLatencyMs: number;
}

export interface EvaluationCaseResult {
	caseId: string;
	caseName: string;
	status: EvaluationCaseStatus;
	startedAt: number;
	endedAt: number | null;
	metrics: EvaluationCaseMetrics;
	runs: EvaluationRunEntry[];
	summary: string;
}

export interface EvaluationState {
	activeCaseId: string | null;
	availableCases: EvaluationCaseDefinition[];
	latestResult: EvaluationCaseResult | null;
	history: EvaluationCaseResult[];
}
