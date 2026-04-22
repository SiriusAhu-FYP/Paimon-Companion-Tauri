import type { EventBus } from "@/services/event-bus";
import type { ILLMService, ChatMessage } from "@/services/llm/types";
import type { L2RollingContextService } from "./l2-rolling-context-service";
import type { LongTermMemoryService } from "./long-term-memory-service";
import type { LongTermMemoryEntry, LongTermMemoryEventResult } from "@/types/memory";
import { consumeLLMStream } from "./llm-stream-helper";
import { createLogger } from "@/services/logger";

const log = createLogger("session-writeback");

const SESSION_COMPRESS_PROMPT = `你是一个会话记忆压缩助手。你会收到一段会话的滚动上下文摘要和关键事件列表。
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

export interface SessionWritebackHookDeps {
	bus: EventBus;
	llmProvider: ILLMService;
	l2Service: L2RollingContextService;
	ltmService: LongTermMemoryService;
}

/**
 * Hooks into companion-runtime stop to compress L2 context into a L3 LongTermMemoryEntry.
 * Returns a dispose function to unsubscribe.
 */
export function installSessionWritebackHook(deps: SessionWritebackHookDeps): () => void {
	const { bus, llmProvider, l2Service, ltmService } = deps;
	let sessionStartedAt = 0;

	const unsubStart = bus.on("companion-runtime:state-change", (payload) => {
		if (payload.running) {
			sessionStartedAt = Date.now();
		}
	});

	const unsubStop = bus.on("companion-runtime:state-change", (payload) => {
		if (!payload.running && sessionStartedAt > 0) {
			const startedAt = sessionStartedAt;
			sessionStartedAt = 0;
			performWriteback(startedAt, llmProvider, l2Service, ltmService).catch((err) => {
				log.error("session writeback failed", err);
			});
		}
	});

	return () => {
		unsubStart();
		unsubStop();
	};
}

async function performWriteback(
	sessionStartedAt: number,
	llmProvider: ILLMService,
	l2Service: L2RollingContextService,
	ltmService: LongTermMemoryService,
): Promise<void> {
	await l2Service.flush();

	const rollingContext = l2Service.getRollingContext();
	if (!rollingContext) {
		log.info("no L2 context to write back, skipping");
		return;
	}

	const salientEvents = l2Service.getSalientEvents();
	const eventsText = salientEvents.length > 0
		? `\n关键事件：\n${salientEvents.map((e) => `- [${e.type}] ${e.description} (严重度: ${e.severity})`).join("\n")}`
		: "";

	const userContent = `会话滚动上下文：\n${rollingContext}${eventsText}`;

	try {
		const messages: ChatMessage[] = [
			{ role: "system", content: SESSION_COMPRESS_PROMPT },
			{ role: "user", content: userContent },
		];

		const responseText = await consumeLLMStream(llmProvider, messages);
		const parsed = parseCompressResponse(responseText);

		const entry: LongTermMemoryEntry = {
			memory_id: `companion-${sessionStartedAt}-${Date.now()}`,
			source: "companion",
			time_start: sessionStartedAt,
			time_end: Date.now(),
			scene_or_task: parsed.scene_or_task,
			entities: parsed.entities,
			event_result: validateEventResult(parsed.event_result),
			summary: parsed.summary,
			tags: parsed.tags,
			committed_at: 0,
		};

		await ltmService.commit(entry);
		log.info("session writeback completed", { id: entry.memory_id });
	} catch (err) {
		log.error("session writeback LLM call failed", err);
	}
}

function parseCompressResponse(text: string): SessionCompressResponse {
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
