export type UnifiedRunPhase = "idle" | "listening" | "thinking" | "acting" | "speaking" | "failed";
export type UnifiedRunTrigger = "manual" | "voice";
export type UnifiedRunStatus = "running" | "completed" | "failed";

export interface UnifiedRunTimings {
	actionMs: number;
	runtimeRefreshMs: number;
	llmReplyMs: number;
	speechMs: number;
	totalMs: number;
	totalBlockingMs: number;
	totalNonBlockingMs: number;
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
}

export interface UnifiedRuntimeState {
	speechEnabled: boolean;
	voiceInputEnabled: boolean;
	activeRunId: string | null;
	phase: UnifiedRunPhase;
	lastVoiceInput: string | null;
	lastCommand: string | null;
	lastCompanionText: string | null;
	lastRun: UnifiedRunRecord | null;
	history: UnifiedRunRecord[];
}
