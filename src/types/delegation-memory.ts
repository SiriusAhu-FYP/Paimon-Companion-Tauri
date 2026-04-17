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
	selectedAction: string | null;
	executionSummary: string;
	verificationResult: DelegatedExecutionVerificationResult;
	followUpSummary: string;
	emotion: string;
	nextStepHint: string | null;
	traceId: string | null;
}

export interface DelegationMemoryState {
	latestRecord: DelegatedExecutionRecord | null;
	recentRecords: DelegatedExecutionRecord[];
}
