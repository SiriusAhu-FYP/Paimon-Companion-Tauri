import type { FunctionalTarget } from "./functional";

export type Game2048Move = "Up" | "Down" | "Left" | "Right";
export type Game2048RunStatus = "running" | "completed" | "failed";

export interface Game2048Analysis {
	strategy: string;
	preferredMoves: Game2048Move[];
}

export interface Game2048MoveAttempt {
	move: Game2048Move;
	changed: boolean;
	changeRatio: number;
}

export interface Game2048RunRecord {
	id: string;
	status: Game2048RunStatus;
	target: FunctionalTarget;
	startedAt: number;
	endedAt: number | null;
	analysis: Game2048Analysis;
	attempts: Game2048MoveAttempt[];
	selectedMove: Game2048Move | null;
	boardChanged: boolean;
	summary: string;
	companionText: string;
	error: string | null;
}

export interface Game2048State {
	activeRunId: string | null;
	lastRun: Game2048RunRecord | null;
	history: Game2048RunRecord[];
}
