import type { CompanionInteractionMode } from "./companion-mode";
import type { UnifiedRunTrigger } from "./unified";

export interface DelegatedExecutionVerificationResult {
	success: boolean;
	boardChanged: boolean;
	error: string | null;
}

export interface DelegatedExecutionRecord {
	id: string;
	createdAt: number;
	mode: CompanionInteractionMode;
	sourceGame: string | null;
	trigger: UnifiedRunTrigger;
	requestText: string | null;
	analysisSource: string | null;
	decisionSummary: string | null;
	plannedActions: string[];
	attemptedActions: string[];
	selectedAction: string | null;
	executionSummary: string;
	verificationResult: DelegatedExecutionVerificationResult;
	postActionObservationStatus?: "fresh-changed" | "fresh-ambiguous" | "timeout";
	postActionObservationSummary?: string | null;
	followUpSummary: string;
	emotion: string;
	nextStepHint: string | null;
	traceId: string | null;
}

export interface DelegationMemoryState {
	latestRecord: DelegatedExecutionRecord | null;
	recentRecords: DelegatedExecutionRecord[];
}
