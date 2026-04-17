import type { CompanionInteractionMode } from "./companion-mode";

export type ProactiveTriggerSource =
	| "runtime-summary"
	| "game2048-result"
	| "sokoban-result"
	| "system-error";

export type ProactiveDecision =
	| "idle"
	| "candidate-created"
	| "queued"
	| "replaced"
	| "dropped"
	| "skipped"
	| "emitting"
	| "emitted";

export interface ProactiveState {
	mode: CompanionInteractionMode;
	isBusy: boolean;
	pendingSource: ProactiveTriggerSource | null;
	pendingPriority: number | null;
	pendingPreview: string | null;
	lastCandidateSource: ProactiveTriggerSource | null;
	lastDecision: ProactiveDecision;
	lastSkipReason: string | null;
	lastEmittedAt: number | null;
	lastEmittedSource: ProactiveTriggerSource | null;
}

