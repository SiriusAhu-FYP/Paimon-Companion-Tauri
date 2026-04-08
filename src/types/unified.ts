export type UnifiedRunPhase = "idle" | "listening" | "acting" | "speaking" | "failed";
export type UnifiedRunTrigger = "manual" | "voice";
export type UnifiedRunStatus = "running" | "completed" | "failed";

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
	emotion: string;
	selectedAction: string | null;
	spoke: boolean;
	error: string | null;
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
