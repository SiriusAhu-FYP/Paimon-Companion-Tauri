import type { FunctionalTarget } from "./functional";

export type SokobanActionId = "move_up" | "move_left" | "move_right" | "move_down";
export type SokobanRunStatus = "running" | "completed" | "failed";
export type SokobanAnalysisSource = "cloud-decision" | "solver" | "vision-llm" | "heuristic";

export interface SokobanAnalysis {
	source: SokobanAnalysisSource;
	reflection: string;
	strategy: string;
	reasoning: string;
	plannedMoves: SokobanActionId[];
	decisionSummary?: string;
}

export interface SokobanMoveAttempt {
	move: SokobanActionId;
	changed: boolean;
	changeRatio: number;
}

export interface SokobanRunRecord {
	id: string;
	status: SokobanRunStatus;
	target: FunctionalTarget;
	startedAt: number;
	endedAt: number | null;
	analysis: SokobanAnalysis;
	attempts: SokobanMoveAttempt[];
	executedMoves: SokobanActionId[];
	boardChanged: boolean;
	summary: string;
	companionText: string;
	error: string | null;
}

export interface SokobanDecisionHistoryEntry {
	runId: string;
	recordedAt: number;
	status: SokobanRunStatus;
	reflection: string;
	strategy: string;
	reasoning: string;
	planSignature: string;
	plannedMoves: SokobanActionId[];
	executedMoves: SokobanActionId[];
	failedMoves: SokobanActionId[];
	boardChanged: boolean;
	repeatedFailureCount: number;
	summary: string;
}

export interface SokobanState {
	activeRunId: string | null;
	lastRun: SokobanRunRecord | null;
	history: SokobanRunRecord[];
	decisionHistory: SokobanDecisionHistoryEntry[];
	detectedTarget: FunctionalTarget | null;
	detectionSummary: string | null;
}
