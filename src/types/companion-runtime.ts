import type { FunctionalTarget } from "./functional";

export type CompanionRuntimePhase = "idle" | "capturing" | "describing" | "summarizing" | "error";

export interface CompanionFrameDescriptionRecord {
	id: string;
	targetTitle: string;
	capturedAt: number;
	description: string;
	source: "vision" | "unchanged";
	captureMethod: string;
	qualityScore: number;
	changeRatio: number | null;
}

export interface CompanionSummaryRecord {
	id: string;
	createdAt: number;
	windowStartedAt: number;
	windowEndedAt: number;
	frameCount: number;
	summary: string;
	source: "cloud" | "fallback";
}

export interface CompanionRuntimeState {
	running: boolean;
	phase: CompanionRuntimePhase;
	target: FunctionalTarget | null;
	localVisionBaseUrl: string;
	localVisionModel: string;
	captureIntervalMs: number;
	summaryWindowMs: number;
	historyRetentionMs: number;
	lastFrame: CompanionFrameDescriptionRecord | null;
	lastSummary: CompanionSummaryRecord | null;
	frameQueue: CompanionFrameDescriptionRecord[];
	summaryHistory: CompanionSummaryRecord[];
	lastError: string | null;
}
