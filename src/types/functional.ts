export interface FunctionalTarget {
	handle: string;
	title: string;
}

export interface PerceptionSnapshot {
	targetHandle: string;
	targetTitle: string;
	width: number;
	height: number;
	dataUrl: string;
	capturedAt: number;
}

export type FunctionalTaskStatus = "running" | "completed" | "failed";
export type FunctionalActionKind = "capture" | "focus" | "send-key" | "send-mouse";
export type FunctionalLogLevel = "info" | "warn" | "error";

export interface FunctionalTaskLogEntry {
	timestamp: number;
	level: FunctionalLogLevel;
	message: string;
}

export interface FunctionalTaskRecord {
	id: string;
	name: string;
	actionKind: FunctionalActionKind;
	targetHandle: string;
	targetTitle: string;
	status: FunctionalTaskStatus;
	startedAt: number;
	endedAt: number | null;
	summary: string;
	error: string | null;
	logs: FunctionalTaskLogEntry[];
	beforeSnapshot: PerceptionSnapshot | null;
	afterSnapshot: PerceptionSnapshot | null;
}

export interface FunctionalRuntimeState {
	selectedTarget: FunctionalTarget | null;
	latestSnapshot: PerceptionSnapshot | null;
	latestTask: FunctionalTaskRecord | null;
	taskHistory: FunctionalTaskRecord[];
	activeTaskId: string | null;
	safetyBlockedReason: string | null;
}
