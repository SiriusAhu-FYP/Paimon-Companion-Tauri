export interface SessionDigestRecord {
	id: string;
	createdAt: number;
	windowStart: number;
	windowEnd: number;
	summaryCount: number;
	digest: string;
	salientEvents: string[];
	emotionArc: string;
}

export type SalientEventType = "danger" | "achievement" | "discovery" | "error" | "turning-point";
export type SalientEventSource = "vision" | "delegation" | "user" | "system";

export interface SalientEvent {
	timestamp: number;
	type: SalientEventType;
	description: string;
	severity: number;
	source: SalientEventSource;
}

export interface PersistentSessionSummary {
	sessionId: string;
	startedAt: number;
	endedAt: number;
	targetTitle: string;
	totalDigests: number;
	finalDigest: string;
	salientEvents: SalientEvent[];
	tags: string[];
}

export interface CrossSessionIndexEntry {
	sessionId: string;
	startedAt: number;
	endedAt: number;
	targetTitle: string;
	tags: string[];
	digestPreview: string;
}

export interface CrossSessionIndex {
	version: number;
	entries: CrossSessionIndexEntry[];
}

export interface SessionDigestState {
	digestHistory: SessionDigestRecord[];
	pendingSummaryCount: number;
	salientEvents: SalientEvent[];
}

export interface MemoryDigestCompletePayload {
	digest: SessionDigestRecord;
}

export interface MemorySalientEventPayload {
	event: SalientEvent;
}

export interface MemorySessionPersistedPayload {
	sessionId: string;
	filePath: string;
}
