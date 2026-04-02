import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getServices } from "@/services";
import type {
	EventHistoryEntry,
} from "@/services/event-bus/event-bus";
import type { EventMap, EventName } from "@/types";

export interface EventLogEntry {
	event: EventName;
	timestamp: number;
	timestampLabel: string;
	category: string;
	color: string;
	summary: string;
	payloadText: string;
}

export const EVENT_CATEGORIES: Record<string, { events: EventName[]; color: string }> = {
	"系统": {
		events: [
			"runtime:mode-change",
			"system:error",
			"system:emergency-stop",
			"system:manual-takeover",
			"system:resume",
		],
		color: "#e57373",
	},
	"功能": {
		events: [
			"functional:target-change",
			"perception:snapshot",
			"orchestrator:state-change",
			"orchestrator:task-start",
			"orchestrator:task-complete",
			"orchestrator:task-log",
			"safety:decision",
			"game2048:target-detected",
			"game2048:run-start",
			"game2048:attempt",
			"game2048:run-complete",
			"game2048:state-change",
			"stardew:target-detected",
			"stardew:run-start",
			"stardew:attempt",
			"stardew:run-complete",
			"stardew:state-change",
			"evaluation:case-start",
			"evaluation:case-complete",
			"evaluation:state-change",
		],
		color: "#ffb74d",
	},
	"角色": {
		events: ["character:expression", "character:motion", "character:state-change", "character:switch"],
		color: "#81c784",
	},
	"语音": {
		events: ["audio:asr-result", "audio:tts-start", "audio:tts-end"],
		color: "#64b5f6",
	},
	"LLM": {
		events: ["llm:request-start", "llm:tool-call", "llm:response-end", "llm:error"],
		color: "#ba68c8",
	},
};

const TRACKED_EVENTS = Array.from(new Set(Object.values(EVENT_CATEGORIES).flatMap((group) => group.events)));
const DEFAULT_LIMIT = 100;
const PAYLOAD_PREVIEW_LIMIT = 240;

function getCategoryForEvent(event: EventName): { name: string; color: string } {
	for (const [name, { events, color }] of Object.entries(EVENT_CATEGORIES)) {
		if (events.includes(event)) return { name, color };
	}
	return { name: "其他", color: "#90a4ae" };
}

function truncate(text: string, limit = PAYLOAD_PREVIEW_LIMIT): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function serializePayload(payload: unknown): string {
	if (payload == null) return "—";
	if (typeof payload === "string") return truncate(payload);
	if (typeof payload === "number" || typeof payload === "boolean") return String(payload);

	try {
		return truncate(JSON.stringify(payload));
	} catch {
		return "[unserializable payload]";
	}
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function formatSummary(event: EventName, payload: unknown): string {
	switch (event) {
		case "runtime:mode-change": {
			const data = payload as EventMap["runtime:mode-change"];
			return `${data.previous} -> ${data.mode}`;
		}
		case "system:error": {
			const data = payload as EventMap["system:error"];
			return `${data.module}: ${data.error}`;
		}
		case "system:emergency-stop":
			return "紧急停止";
		case "system:manual-takeover":
			return "手动接管";
		case "system:resume":
			return "恢复执行";
		case "audio:asr-result": {
			const data = payload as EventMap["audio:asr-result"];
			return `${data.source}: ${truncate(data.text, 80)}`;
		}
		case "audio:tts-start": {
			const data = payload as EventMap["audio:tts-start"];
			return `TTS: ${truncate(data.text, 80)}`;
		}
		case "audio:tts-end":
			return "TTS 完成";
		case "llm:request-start": {
			const data = payload as EventMap["llm:request-start"];
			return `请求: ${truncate(data.userText, 80)}`;
		}
		case "llm:tool-call": {
			const data = payload as EventMap["llm:tool-call"];
			return `工具调用: ${data.name}`;
		}
		case "llm:response-end": {
			const data = payload as EventMap["llm:response-end"];
			return `响应: ${truncate(data.fullText, 80)}`;
		}
		case "llm:error": {
			const data = payload as EventMap["llm:error"];
			return `LLM 错误: ${data.error}`;
		}
		case "character:expression": {
			const data = payload as EventMap["character:expression"];
			return `${data.emotion} / ${data.expressionName}`;
		}
		case "character:motion": {
			const data = payload as EventMap["character:motion"];
			return `${data.motionGroup} #${data.index}`;
		}
		case "character:state-change": {
			const data = payload as EventMap["character:state-change"];
			return `${data.characterId}: ${data.emotion}${data.isSpeaking ? " / speaking" : ""}`;
		}
		case "character:switch": {
			const data = payload as EventMap["character:switch"];
			return `切换角色: ${data.characterId}`;
		}
		case "functional:target-change": {
			const data = payload as EventMap["functional:target-change"];
			return data.title ? `目标: ${data.title}` : "目标已清空";
		}
		case "perception:snapshot": {
			const data = payload as EventMap["perception:snapshot"];
			return `${data.targetTitle} ${data.width}x${data.height}`;
		}
		case "orchestrator:state-change": {
			const data = payload as EventMap["orchestrator:state-change"];
			return `active=${data.state.activeTaskId ?? "none"}, 历史=${data.state.taskHistory.length}`;
		}
		case "orchestrator:task-start": {
			const data = payload as EventMap["orchestrator:task-start"];
			return `${data.name} @ ${data.targetTitle}`;
		}
		case "orchestrator:task-complete": {
			const data = payload as EventMap["orchestrator:task-complete"];
			return `${data.success ? "完成" : "失败"}: ${data.summary}`;
		}
		case "orchestrator:task-log": {
			const data = payload as EventMap["orchestrator:task-log"];
			return `[${data.level}] ${data.message}`;
		}
		case "safety:decision": {
			const data = payload as EventMap["safety:decision"];
			return `${data.operation}: ${data.allowed ? "allow" : "block"}${data.reason ? ` (${data.reason})` : ""}`;
		}
		case "game2048:target-detected": {
			const data = payload as EventMap["game2048:target-detected"];
			return data.summary;
		}
		case "game2048:run-start": {
			const data = payload as EventMap["game2048:run-start"];
			return `${data.targetTitle}: ${data.preferredMoves.join(" -> ")}`;
		}
		case "game2048:attempt": {
			const data = payload as EventMap["game2048:attempt"];
			return `${data.move}: ${data.changed ? "changed" : "no change"} (${formatPercent(data.changeRatio)})`;
		}
		case "game2048:run-complete": {
			const data = payload as EventMap["game2048:run-complete"];
			return data.summary;
		}
		case "game2048:state-change": {
			const data = payload as EventMap["game2048:state-change"];
			const latest = data.state.lastRun;
			return latest ? `最新运行: ${latest.status}` : "状态刷新";
		}
		case "stardew:target-detected": {
			const data = payload as EventMap["stardew:target-detected"];
			return data.summary;
		}
		case "stardew:run-start": {
			const data = payload as EventMap["stardew:run-start"];
			return `${data.taskId}: ${data.preferredActions.join(" -> ")}`;
		}
		case "stardew:attempt": {
			const data = payload as EventMap["stardew:attempt"];
			return `${data.action}: ${data.changed ? "changed" : "no change"} (${formatPercent(data.changeRatio)})`;
		}
		case "stardew:run-complete": {
			const data = payload as EventMap["stardew:run-complete"];
			return data.summary;
		}
		case "stardew:state-change": {
			const data = payload as EventMap["stardew:state-change"];
			const latest = data.state.lastRun;
			return latest ? `最新运行: ${latest.status}` : "状态刷新";
		}
		case "evaluation:case-start": {
			const data = payload as EventMap["evaluation:case-start"];
			return `${data.game}/${data.caseId} x${data.iterations}`;
		}
		case "evaluation:case-complete": {
			const data = payload as EventMap["evaluation:case-complete"];
			return `${data.result.caseId}: ${formatPercent(data.result.metrics.successRate)} success`;
		}
		case "evaluation:state-change": {
			const data = payload as EventMap["evaluation:state-change"];
			return `active=${data.state.activeCaseId ?? "none"}, 历史=${data.state.history.length}`;
		}
		default:
			return serializePayload(payload);
	}
}

function toEntry(entry: EventHistoryEntry): EventLogEntry | null {
	if (!TRACKED_EVENTS.includes(entry.event)) return null;

	const category = getCategoryForEvent(entry.event);
	return {
		event: entry.event,
		timestamp: entry.timestamp,
		timestampLabel: new Date(entry.timestamp).toLocaleTimeString(),
		category: category.name,
		color: category.color,
		summary: formatSummary(entry.event, entry.payload),
		payloadText: serializePayload(entry.payload),
	};
}

export function useEventLog(limit = DEFAULT_LIMIT) {
	const { bus } = getServices();
	const history = useSyncExternalStore(
		(onStoreChange) => bus.subscribeHistory(onStoreChange),
		() => bus.getHistory(),
		() => [],
	);

	const entries = useMemo(() => {
		const next: EventLogEntry[] = [];
		for (let index = history.length - 1; index >= 0; index -= 1) {
			const normalized = toEntry(history[index]);
			if (normalized) {
				next.push(normalized);
			}
			if (next.length >= limit) {
				break;
			}
		}
		return {
			entries: next,
			totalTrackedEntries: history.reduce((count, item) => count + (TRACKED_EVENTS.includes(item.event) ? 1 : 0), 0),
		};
	}, [history, limit]);

	const clear = useCallback(() => {
		bus.clearHistory();
	}, [bus]);

	return {
		entries: entries.entries,
		clear,
		latestEntry: entries.entries[0] ?? null,
		totalTrackedEntries: entries.totalTrackedEntries,
	};
}
