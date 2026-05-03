export type UnifiedRunPhase = "idle" | "listening" | "thinking" | "acting" | "speaking" | "failed";
export type UnifiedRunTrigger = "manual" | "voice";
export type UnifiedRunStatus = "running" | "completed" | "failed" | "stopped";

export interface UnifiedRunTimings {
	actionMs: number;
	runtimeRefreshMs: number;
	llmReplyMs: number;
	speechMs: number;
	totalMs: number;
	totalBlockingMs: number;
	totalNonBlockingMs: number;
}

export interface DelegationRoundEntry {
	round: number;
	timestamp: number;
	plannerReasoning: string;
	plannerExpectedOutcome: string;
	plannerGoalReached: boolean;
	committedRoute?: string;
	currentRouteStep?: string;
	routeDiagnosis?: string;
	boardGrid?: string;
	actionTool: string;
	actionSummary: string;
	evaluatorSucceeded: boolean;
	evaluatorCorrect: boolean;
	evaluatorExpectedMet: boolean;
	evaluatorAlignment: string;
	evaluatorProgress: string;
	evaluatorReply: string;
	evaluatorHint: string;
	snapshotBeforeUrl?: string;
	snapshotAfterUrl?: string;
}

export interface DelegationTimeline {
	taskText: string;
	missionGoal: string;
	rounds: DelegationRoundEntry[];
}

export interface UnifiedRunRecord {
	id: string;
	gameId: string | null;
	trigger: UnifiedRunTrigger;
	requestText: string | null;
	startedAt: number;
	endedAt: number | null;
	status: UnifiedRunStatus;
	phase: UnifiedRunPhase;
	summary: string;
	companionText: string;
	companionTextSource: "none" | "llm" | "fallback";
	emotion: string;
	selectedAction: string | null;
	spoke: boolean;
	error: string | null;
	timings: UnifiedRunTimings;
	delegationTimeline?: DelegationTimeline | null;
}

export interface UnifiedRuntimeState {
	speechEnabled: boolean;
	voiceInputEnabled: boolean;
	activeRunId: string | null;
	loopActive: boolean;
	phase: UnifiedRunPhase;
	lastVoiceInput: string | null;
	lastCommand: string | null;
	lastCompanionText: string | null;
	lastRun: UnifiedRunRecord | null;
	history: UnifiedRunRecord[];
}
