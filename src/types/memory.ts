// P6 记忆系统类型定义
// 遵循 04-P6-记忆实施细则.md 规范

// --- Salient Events (retained for proactive companion) ---

export type SalientEventType = "danger" | "achievement" | "discovery" | "error" | "turning-point";
export type SalientEventSource = "vision" | "delegation" | "user" | "system";

export interface SalientEvent {
	timestamp: number;
	type: SalientEventType;
	description: string;
	severity: number;
	source: SalientEventSource;
}

// --- L2 Rolling Context ---

export interface L2RollingContext {
	lastUpdatedAt: number;
	compressedSummary: string;
	windowSummaryIds: string[];
}

// --- L3 Long-Term Memory ---

export type LongTermMemorySource = "companion" | "delegation";
export type LongTermMemoryEventResult = "success" | "failure" | "interrupted" | "unknown";
export type WritebackState = "pending" | "processing" | "committed";

export interface LongTermMemoryEntry {
	memory_id: string;
	source: LongTermMemorySource;
	time_start: number;
	time_end: number;
	scene_or_task: string;
	entities: string[];
	event_result: LongTermMemoryEventResult;
	summary: string;
	tags: string[];
	committed_at: number;
}

export interface WritebackTask {
	id: string;
	state: WritebackState;
	entry: LongTermMemoryEntry;
	createdAt: number;
	lastAttemptAt?: number;
}

export interface MemoryCandidate {
	entry: LongTermMemoryEntry;
	relevanceScore: number;
}

export interface LongTermMemoryIndexEntry {
	memory_id: string;
	source: LongTermMemorySource;
	time_start: number;
	scene_or_task: string;
	tags: string[];
	summaryPreview: string;
}

export interface LongTermMemoryIndex {
	version: number;
	entries: LongTermMemoryIndexEntry[];
}

// --- Event Payloads ---

export interface MemoryL2UpdatedPayload {
	context: L2RollingContext;
}

export interface MemorySalientEventPayload {
	event: SalientEvent;
}

export interface MemoryCommittedPayload {
	entry: LongTermMemoryEntry;
}

export interface MemoryRecallCompletePayload {
	query: string;
	candidates: MemoryCandidate[];
}
