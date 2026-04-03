export type EvaluationGame = "2048" | "stardew";
export type EvaluationCaseTargetMode = "auto-detect" | "selected-target";
export type EvaluationCaseStatus = "running" | "completed" | "failed";

export interface EvaluationCaseDefinition {
	id: string;
	game: EvaluationGame;
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
	selectedAction: string | null;
	analysisSource: string | null;
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
