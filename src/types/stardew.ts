import type { FunctionalTarget } from "./functional";

export type StardewTaskId = "reposition" | "open-inventory" | "close-menu";
export type StardewActionKey = "W" | "A" | "S" | "D" | "E" | "Escape";
export type StardewAnalysisSource = "vision-llm" | "heuristic";
export type StardewRunStatus = "running" | "completed" | "failed";

export interface StardewTaskDefinition {
	id: StardewTaskId;
	name: string;
	description: string;
}

export interface StardewAnalysis {
	source: StardewAnalysisSource;
	strategy: string;
	reasoning: string;
	preferredActions: StardewActionKey[];
}

export interface StardewAttemptRecord {
	action: StardewActionKey;
	changed: boolean;
	changeRatio: number;
}

export interface StardewRunRecord {
	id: string;
	taskId: StardewTaskId;
	status: StardewRunStatus;
	target: FunctionalTarget;
	startedAt: number;
	endedAt: number | null;
	analysis: StardewAnalysis;
	attempts: StardewAttemptRecord[];
	selectedAction: StardewActionKey | null;
	boardChanged: boolean;
	summary: string;
	companionText: string;
	error: string | null;
}

export interface StardewState {
	activeRunId: string | null;
	availableTasks: StardewTaskDefinition[];
	lastRun: StardewRunRecord | null;
	history: StardewRunRecord[];
	detectedTarget: FunctionalTarget | null;
	detectionSummary: string | null;
	selectedTaskId: StardewTaskId;
}
