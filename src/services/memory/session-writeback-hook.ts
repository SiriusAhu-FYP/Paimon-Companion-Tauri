import type { EventBus } from "@/services/event-bus";
import type { ILLMService, ChatMessage } from "@/services/llm/types";
import type { LongTermMemoryService } from "./long-term-memory-service";
import type { MemoryLogService, MemoryLogEntry } from "./memory-log-service";
import type { CompanionSummaryRecord } from "@/types/companion-runtime";
import type { LongTermMemoryEntry, LongTermMemoryEventResult } from "@/types/memory";
import { consumeLLMStream } from "./llm-stream-helper";
import { createLogger } from "@/services/logger";

const log = createLogger("session-writeback");

const SESSION_COMPRESS_PROMPT = `你是一个会话记忆压缩助手。你会收到一段会话的摘要序列和关键片段。
请将其压缩为一条结构化的长期记忆条目。

以 JSON 格式回复：
{
  "scene_or_task": "本次会话的主要场景或任务（20字以内）",
  "entities": ["涉及的关键实体，如角色名、地名、物品名"],
  "event_result": "success|failure|interrupted|unknown",
  "summary": "本次会话的核心内容总结（100字以内）",
  "tags": ["用于检索的标签，3-5个"]
}
仅返回 JSON，不要附加说明。`;

interface SessionCompressResponse {
	scene_or_task: string;
	entities: string[];
	event_result: string;
	summary: string;
	tags: string[];
}

interface PromotionTarget {
	logIds: string[];
	memoryId: string;
	source: "companion" | "delegation";
	rawContext?: string;
	preCompressed?: LongTermMemoryEntry;
	timeStart: number;
	timeEnd: number;
}

export interface SessionWritebackHookDeps {
	bus: EventBus;
	llmProvider: ILLMService;
	ltmService: LongTermMemoryService;
	memoryLog: MemoryLogService;
}

/**
 * Companion summaries are written to the intermediate log during runtime.
 * Clean stop triggers a best-effort promotion pass, but promotion does not
 * depend on stop: startup replay still promotes any surviving pending logs.
 */
export function installSessionWritebackHook(deps: SessionWritebackHookDeps): () => void {
	const { bus, llmProvider, ltmService, memoryLog } = deps;
	let currentSessionId: string | null = null;
	let currentSessionStartedAt = 0;

	const ensureSession = (fallbackStartedAt: number) => {
		if (!currentSessionId) {
			currentSessionStartedAt = fallbackStartedAt;
			currentSessionId = `session-${fallbackStartedAt}`;
		}
		return {
			sessionId: currentSessionId,
			sessionStartedAt: currentSessionStartedAt || fallbackStartedAt,
		};
	};

	const unsubState = bus.on("companion-runtime:state-change", (payload) => {
		if (payload.running) {
			if (!currentSessionId) {
				currentSessionStartedAt = Date.now();
				currentSessionId = `session-${currentSessionStartedAt}`;
			}
			return;
		}

		if (!currentSessionId) {
			return;
		}

		currentSessionId = null;
		currentSessionStartedAt = 0;
		promotePendingLogs(memoryLog, ltmService, llmProvider).catch((err) => {
			log.error("best-effort promotion on companion stop failed", err);
		});
	});

	const unsubSummary = bus.on("companion-runtime:summary-complete", (payload) => {
		const { sessionId, sessionStartedAt } = ensureSession(payload.record.windowStartedAt);
		appendCompanionSummaryLog(memoryLog, payload.record, sessionId, sessionStartedAt).catch((err) => {
			log.error("failed to append companion summary log", err);
		});
	});

	return () => {
		unsubState();
		unsubSummary();
	};
}

async function appendCompanionSummaryLog(
	memoryLog: MemoryLogService,
	record: CompanionSummaryRecord,
	sessionId: string,
	sessionStartedAt: number,
): Promise<void> {
	const logEntry: MemoryLogEntry = {
		id: `companion-summary-${record.id}`,
		source: "companion",
		kind: "companion-summary",
		sessionId,
		createdAt: record.createdAt,
		timeStart: Math.min(sessionStartedAt, record.windowStartedAt),
		timeEnd: record.windowEndedAt,
		rawContext: record.summary,
		promoted: false,
	};

	await memoryLog.append(logEntry);
}

export async function promotePendingLogs(
	memoryLog: MemoryLogService,
	ltmService: LongTermMemoryService,
	llmProvider: ILLMService,
): Promise<number> {
	const pending = await memoryLog.listPending();
	if (pending.length === 0) return 0;

	const targets = buildPromotionTargets(pending);
	if (targets.length === 0) return 0;

	log.info("promoting pending memory logs", {
		logCount: pending.length,
		targetCount: targets.length,
	});

	let promoted = 0;
	for (const target of targets) {
		try {
			const entry = target.preCompressed
				? target.preCompressed
				: await compressLogToEntry(target, llmProvider);

			await ltmService.commit(entry);
			for (const logId of target.logIds) {
				await memoryLog.markPromoted(logId);
			}
			promoted += 1;
			log.info("promoted logs to LTM", {
				logIds: target.logIds,
				memoryId: entry.memory_id,
			});
		} catch (err) {
			log.error("failed to promote pending logs", {
				logIds: target.logIds,
				err,
			});
		}
	}

	await memoryLog.cleanupPromoted();
	log.info("promotion complete", { promoted, totalTargets: targets.length });
	return promoted;
}

function buildPromotionTargets(pending: MemoryLogEntry[]): PromotionTarget[] {
	const targets: PromotionTarget[] = [];
	const companionGroups = new Map<string, MemoryLogEntry[]>();

	for (const entry of pending) {
		if (entry.preCompressed) {
			targets.push({
				logIds: [entry.id],
				memoryId: entry.preCompressed.memory_id,
				source: entry.source,
				preCompressed: entry.preCompressed,
				timeStart: entry.preCompressed.time_start,
				timeEnd: entry.preCompressed.time_end,
			});
			continue;
		}

		if (entry.source !== "companion") {
			targets.push({
				logIds: [entry.id],
				memoryId: entry.id,
				source: entry.source,
				rawContext: entry.rawContext,
				timeStart: entry.timeStart ?? entry.createdAt,
				timeEnd: entry.timeEnd ?? entry.createdAt,
			});
			continue;
		}

		const groupKey = entry.sessionId || entry.id;
		const group = companionGroups.get(groupKey) ?? [];
		group.push(entry);
		companionGroups.set(groupKey, group);
	}

	for (const [groupKey, entries] of companionGroups.entries()) {
		entries.sort((a, b) => (a.timeStart ?? a.createdAt) - (b.timeStart ?? b.createdAt));
		const first = entries[0];
		const last = entries[entries.length - 1];
		if (!first || !last) {
			continue;
		}

		const timeline = entries.map((entry, index) => {
			const startedAt = new Date(entry.timeStart ?? entry.createdAt).toISOString();
			const endedAt = new Date(entry.timeEnd ?? entry.createdAt).toISOString();
			return `${index + 1}. [${startedAt} ~ ${endedAt}] ${entry.rawContext}`;
		}).join("\n");

		targets.push({
			logIds: entries.map((entry) => entry.id),
			memoryId: `companion-${groupKey}`,
			source: "companion",
			rawContext: `陪伴会话摘要序列：\n${timeline}`,
			timeStart: first.timeStart ?? first.createdAt,
			timeEnd: last.timeEnd ?? last.createdAt,
		});
	}

	targets.sort((a, b) => a.timeStart - b.timeStart);
	return targets;
}

async function compressLogToEntry(
	target: PromotionTarget,
	llmProvider: ILLMService,
): Promise<LongTermMemoryEntry> {
	const messages: ChatMessage[] = [
		{ role: "system", content: SESSION_COMPRESS_PROMPT },
		{ role: "user", content: target.rawContext ?? "" },
	];

	const responseText = await consumeLLMStream(llmProvider, messages);
	const parsed = parseCompressResponse(responseText);

	return {
		memory_id: target.memoryId,
		source: target.source,
		time_start: target.timeStart,
		time_end: target.timeEnd,
		scene_or_task: parsed.scene_or_task,
		entities: parsed.entities,
		event_result: validateEventResult(parsed.event_result),
		summary: parsed.summary,
		tags: parsed.tags,
		committed_at: 0,
	};
}

export function parseCompressResponse(text: string): SessionCompressResponse {
	try {
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) throw new Error("no JSON found");
		return JSON.parse(jsonMatch[0]) as SessionCompressResponse;
	} catch {
		log.warn("failed to parse compress response, using defaults");
		return {
			scene_or_task: "未知场景",
			entities: [],
			event_result: "unknown",
			summary: text.slice(0, 100),
			tags: [],
		};
	}
}

function validateEventResult(result: string): LongTermMemoryEventResult {
	const valid: LongTermMemoryEventResult[] = ["success", "failure", "interrupted", "unknown"];
	return valid.includes(result as LongTermMemoryEventResult)
		? (result as LongTermMemoryEventResult)
		: "unknown";
}
