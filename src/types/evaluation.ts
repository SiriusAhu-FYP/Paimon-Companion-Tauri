import type { UnifiedRunTimings } from "./unified";

export type EvaluationGame = "2048" | "fusion";
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
	traceId: string;
	status: "completed" | "failed";
	latencyMs: number;
	boardChanged: boolean;
	actionValid: boolean;
	selectedAction: string | null;
	analysisSource: string | null;
	runtimeContextUsed: boolean;
	llmReplyUsed: boolean;
	spoke: boolean;
	emotionApplied: boolean;
	mcpCompanionUsed: boolean;
	mcpGameUsed: boolean;
	summary: string;
	error: string | null;
	timings?: UnifiedRunTimings | null;
	uiStallCount?: number;
	uiStallMaxMs?: number;
}

export interface EvaluationCaseMetrics {
	totalRuns: number;
	successfulRuns: number;
	validActions: number;
	successRate: number;
	actionValidityRate: number;
	runtimeContextRate: number;
	llmReplyRate: number;
	speechRate: number;
	emotionRate: number;
	mcpCompanionRate: number;
	mcpGameRate: number;
	averageLatencyMs: number;
	medianLatencyMs: number;
	averageActionMs: number;
	averageRuntimeRefreshMs: number;
	averageLlmReplyMs: number;
	averageSpeechMs: number;
	averageTotalBlockingMs: number;
	averageTotalNonBlockingMs: number;
	averageUiStallCount: number;
	maxUiStallMs: number;
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
