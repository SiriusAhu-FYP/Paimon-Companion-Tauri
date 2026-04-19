import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getServices } from "@/services";
import type {
	EventHistoryEntry,
} from "@/services/event-bus/event-bus";
import type { EventMap, EventName } from "@/types";

export interface EventLogEntry {
	key: string;
	event: EventName;
	timestamp: number;
	timestampLabel: string;
	category: string;
	color: string;
	isDebug: boolean;
	severity: "info" | "warn" | "error";
	summary: string;
	payloadPreviewText: string;
	rawPayload: unknown;
}

export interface UseEventLogOptions {
	showDebug?: boolean;
	mode?: "full" | "latest";
	includeTotalTrackedEntries?: boolean;
}

export const EVENT_CATEGORIES: Record<string, { events: EventName[]; color: string; debug?: boolean }> = {
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
	"性能": {
		events: [
			"system:ui-stall",
		],
		color: "#ffd54f",
	},
	"功能": {
		events: [
			"functional:target-change",
			"orchestrator:task-complete",
			"game2048:target-detected",
			"game2048:run-start",
			"game2048:run-complete",
			"sokoban:target-detected",
			"sokoban:run-start",
			"sokoban:run-complete",
			"evaluation:case-start",
			"evaluation:case-complete",
			"unified:run-start",
			"unified:run-complete",
			"companion-runtime:frame-described",
			"companion-runtime:summary-complete",
			"companion-runtime:benchmark-start",
			"companion-runtime:benchmark-complete",
		],
		color: "#ffb74d",
	},
	"调试": {
		events: [
			"perception:snapshot",
			"orchestrator:state-change",
			"orchestrator:task-start",
			"orchestrator:task-log",
			"safety:decision",
			"game2048:attempt",
			"game2048:state-change",
			"sokoban:attempt",
			"sokoban:state-change",
			"evaluation:state-change",
			"unified:state-change",
			"unified:voice-input",
			"companion-runtime:state-change",
			"companion-runtime:benchmark-state-change",
			"voice:state-change",
			"companion:proactive-state-change",
			"delegation-memory:state-change",
			"delegation-memory:record-added",
			"debug-capture:state-change",
		],
		color: "#90a4ae",
		debug: true,
	},
	"角色": {
		events: ["affect:state-change", "character:expression", "character:motion", "character:state-change", "character:switch", "companion:mode-change"],
		color: "#81c784",
	},
	"语音": {
		events: ["audio:vad-start", "audio:vad-end", "audio:asr-result", "audio:tts-pending", "audio:tts-start", "audio:tts-end"],
		color: "#64b5f6",
	},
	"LLM": {
		events: ["llm:request-start", "llm:tool-call", "llm:response-end", "llm:error"],
		color: "#ba68c8",
	},
	"MCP": {
		events: ["mcp:tool-start", "mcp:tool-complete"],
		color: "#4db6ac",
	},
};

const TRACKED_EVENTS = Array.from(new Set(Object.values(EVENT_CATEGORIES).flatMap((group) => group.events)));
const DEFAULT_LIMIT = 100;
const PAYLOAD_PREVIEW_LIMIT = 240;

function formatTraceTag(traceId?: string): string {
	if (!traceId) return "";
	return ` [${traceId.slice(-8)}]`;
}

function getCategoryForEvent(event: EventName): { name: string; color: string } {
	for (const [name, { events, color }] of Object.entries(EVENT_CATEGORIES)) {
		if (events.includes(event)) return { name, color };
	}
	return { name: "其他", color: "#90a4ae" };
}

function isDebugEvent(event: EventName): boolean {
	for (const { events, debug } of Object.values(EVENT_CATEGORIES)) {
		if (events.includes(event)) return !!debug;
	}
	return false;
}

function truncate(text: string, limit = PAYLOAD_PREVIEW_LIMIT): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function formatShortTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString();
}

function compactReason(reason: string, limit = 40): string {
	return truncate(reason, limit);
}

function serializePayload(payload: unknown, pretty = false): string {
	if (payload == null) return "—";
	if (typeof payload === "string") return pretty ? payload : truncate(payload);
	if (typeof payload === "number" || typeof payload === "boolean") return String(payload);

	try {
		return pretty ? JSON.stringify(payload, null, 2) : truncate(JSON.stringify(payload));
	} catch {
		return "[unserializable payload]";
	}
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function formatPayloadPreview(event: EventName, payload: unknown): string {
	switch (event) {
		case "affect:state-change": {
			const data = payload as EventMap["affect:state-change"];
			const parts = [
				`show=${data.state.presentationEmotion}`,
				`core=${data.state.currentEmotion}@${data.state.intensity.toFixed(2)}`,
				`residual=${data.state.residualEmotion}@${data.state.residualIntensity.toFixed(2)}`,
				`src=${data.source}`,
				`reason=${compactReason(data.reason, 56)}`,
				`at=${formatShortTime(data.state.updatedAt)}`,
			];
			if (data.state.isHeldForSpeech) {
				parts.splice(4, 0, "hold=speech");
			}
			return parts.join(" | ");
		}
		case "character:state-change": {
			const data = payload as EventMap["character:state-change"];
			const parts = [
				`emotion=${data.emotion}`,
				`speaking=${data.isSpeaking ? "yes" : "no"}`,
			];
			if (data.emotionSource) {
				parts.push(`src=${data.emotionSource}`);
			}
			if (data.emotionReason) {
				parts.push(`reason=${compactReason(data.emotionReason, 56)}`);
			}
			return parts.join(" | ");
		}
		case "companion:mode-change": {
			const data = payload as EventMap["companion:mode-change"];
			return `mode=${data.mode} | prev=${data.previous} | pref=${data.preferredMode} | src=${data.source} | reason=${data.reason}`;
		}
		case "companion:proactive-state-change": {
			const data = payload as EventMap["companion:proactive-state-change"];
			return [
				`mode=${data.state.mode}`,
				`busy=${data.state.isBusy ? "yes" : "no"}`,
				`pending=${data.state.pendingSource ?? "none"}`,
				`decision=${data.state.lastDecision}`,
				data.reason ? `reason=${compactReason(data.reason, 56)}` : "",
			].filter(Boolean).join(" | ");
		}
		case "debug-capture:state-change": {
			const data = payload as EventMap["debug-capture:state-change"];
			return [
				`enabled=${data.state.enabled ? "yes" : "no"}`,
				`session=${data.state.sessionId ?? "none"}`,
				`events=${data.state.capturedEventCount}`,
				`images=${data.state.capturedImageCount}`,
				data.state.lastError ? `error=${compactReason(data.state.lastError, 56)}` : "",
			].filter(Boolean).join(" | ");
		}
		case "delegation-memory:state-change": {
			const data = payload as EventMap["delegation-memory:state-change"];
			return [
				`latest=${data.state.latestRecord?.sourceGame ?? "none"}`,
				`records=${data.state.recentRecords.length}`,
				data.state.latestRecord ? `verified=${data.state.latestRecord.verificationResult.success ? "yes" : "no"}` : "",
			].filter(Boolean).join(" | ");
		}
		case "delegation-memory:record-added": {
			const data = payload as EventMap["delegation-memory:record-added"];
			return [
				`game=${data.record.sourceGame ?? "none"}`,
				`mode=${data.record.mode}`,
				data.record.analysisSource ? `analysis=${data.record.analysisSource}` : "",
				`verified=${data.record.verificationResult.success ? "yes" : "no"}`,
				data.record.selectedAction ? `action=${data.record.selectedAction}` : "",
				`summary=${compactReason(data.record.executionSummary, 56)}`,
				data.record.nextStepHint ? `next=${compactReason(data.record.nextStepHint, 48)}` : "",
			].join(" | ");
		}
		default:
			return serializePayload(payload);
	}
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
		case "system:ui-stall": {
			const data = payload as EventMap["system:ui-stall"];
			return `UI stall: ${data.durationMs.toFixed(0)}ms (>${data.thresholdMs}ms)`;
		}
		case "system:emergency-stop":
			return "Emergency stop";
		case "system:manual-takeover":
			return "Manual takeover";
		case "system:resume":
			return "Resume execution";
		case "audio:asr-result": {
			const data = payload as EventMap["audio:asr-result"];
			return `${data.source}: ${truncate(data.text, 80)}`;
		}
		case "audio:tts-pending": {
			const data = payload as EventMap["audio:tts-pending"];
			return `TTS pending: ${truncate(data.text, 80)}`;
		}
		case "audio:vad-start":
			return "VAD recording started";
		case "audio:vad-end": {
			const data = payload as EventMap["audio:vad-end"];
			return `VAD ended (${Math.round(data.audioData.byteLength / 1024)} KB)`;
		}
		case "audio:tts-start": {
			const data = payload as EventMap["audio:tts-start"];
			return `TTS: ${truncate(data.text, 80)}`;
		}
		case "audio:tts-end":
			return "TTS finished";
		case "voice:state-change": {
			const data = payload as EventMap["voice:state-change"];
			return `${data.state.status}${data.state.playbackLocked ? " / playback-lock" : ""}`;
		}
		case "llm:request-start": {
			const data = payload as EventMap["llm:request-start"];
			const sourceLabel = data.source === "companion-reply"
				? "Follow-up"
				: data.source === "proactive-reply"
					? "Proactive"
					: "Request";
			return `${sourceLabel}${formatTraceTag(data.traceId)}: ${truncate(data.userText, 80)}${data.inputSource ? ` / ${data.inputSource}` : ""}${data.companionRuntimeContextUsed ? " / runtime context" : ""}`;
		}
		case "llm:tool-call": {
			const data = payload as EventMap["llm:tool-call"];
			return `Tool call${formatTraceTag(data.traceId)}: ${data.name}`;
		}
		case "llm:response-end": {
			const data = payload as EventMap["llm:response-end"];
			return `Response${formatTraceTag(data.traceId)}: ${truncate(data.fullText, 80)}`;
		}
		case "llm:error": {
			const data = payload as EventMap["llm:error"];
			return `LLM error: ${data.error}`;
		}
		case "mcp:tool-start": {
			const data = payload as EventMap["mcp:tool-start"];
			return `MCP start${formatTraceTag(data.traceId)}: ${data.name}`;
		}
		case "mcp:tool-complete": {
			const data = payload as EventMap["mcp:tool-complete"];
			return `${data.ok ? "MCP complete" : "MCP failed"}${formatTraceTag(data.traceId)}: ${data.name}${data.error ? ` / ${truncate(data.error, 80)}` : ""}`;
		}
		case "character:expression": {
			const data = payload as EventMap["character:expression"];
			return `${data.emotion} / ${data.expressionName}`;
		}
		case "affect:state-change": {
			const data = payload as EventMap["affect:state-change"];
			return `${data.state.presentationEmotion} | p${data.state.priority} | ${data.source} | ${compactReason(data.reason)}${data.state.isHeldForSpeech ? " | hold" : ""}`;
		}
		case "character:motion": {
			const data = payload as EventMap["character:motion"];
			return `${data.motionGroup} #${data.index}`;
		}
		case "character:state-change": {
			const data = payload as EventMap["character:state-change"];
			return `${data.characterId}: ${data.emotion}${data.isSpeaking ? " / speaking" : ""}${data.emotionSource ? ` / ${data.emotionSource}` : ""}${data.emotionReason ? ` / ${truncate(data.emotionReason, 48)}` : ""}`;
		}
		case "character:switch": {
			const data = payload as EventMap["character:switch"];
			return `Switch character: ${data.characterId}`;
		}
		case "companion:mode-change": {
			const data = payload as EventMap["companion:mode-change"];
			return `${data.previous} -> ${data.mode}${data.reason ? ` / ${data.reason}` : ""}${data.source ? ` / ${data.source}` : ""}`;
		}
		case "companion:proactive-state-change": {
			const data = payload as EventMap["companion:proactive-state-change"];
			return `${data.action}${data.source ? ` / ${data.source}` : ""}${data.reason ? ` / ${truncate(data.reason, 48)}` : ""}`;
		}
		case "debug-capture:state-change": {
			const data = payload as EventMap["debug-capture:state-change"];
			return `${data.state.enabled ? "capture-on" : "capture-off"} / ${data.state.sessionId ?? "no-session"} / events ${data.state.capturedEventCount} / images ${data.state.capturedImageCount}`;
		}
		case "delegation-memory:state-change": {
			const data = payload as EventMap["delegation-memory:state-change"];
			return data.state.latestRecord
				? `latest memory: ${data.state.latestRecord.sourceGame ?? "none"} / ${data.state.latestRecord.verificationResult.success ? "success" : "failed"}`
				: "delegation memory updated";
		}
		case "delegation-memory:record-added": {
			const data = payload as EventMap["delegation-memory:record-added"];
			return `record added: ${data.record.sourceGame ?? "none"} / ${data.record.analysisSource ?? "none"} / ${data.record.verificationResult.success ? "success" : "failed"}`;
		}
		case "functional:target-change": {
			const data = payload as EventMap["functional:target-change"];
			return data.title ? `Target: ${data.title}` : "Target cleared";
		}
		case "perception:snapshot": {
			const data = payload as EventMap["perception:snapshot"];
			return `${data.targetTitle} ${data.width}x${data.height} via ${data.captureMethod}${data.lowConfidence ? " low-confidence" : ""}`;
		}
		case "orchestrator:state-change": {
			const data = payload as EventMap["orchestrator:state-change"];
			return `active=${data.state.activeTaskId ?? "none"}, history=${data.state.taskHistory.length}`;
		}
		case "orchestrator:task-start": {
			const data = payload as EventMap["orchestrator:task-start"];
			return `${data.name} @ ${data.targetTitle}`;
		}
		case "orchestrator:task-complete": {
			const data = payload as EventMap["orchestrator:task-complete"];
			return `${data.success ? "Complete" : "Failed"}: ${data.summary}`;
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
			return `${data.targetTitle}${formatTraceTag(data.traceId)}: ${data.preferredMoves.join(" -> ")}`;
		}
		case "game2048:attempt": {
			const data = payload as EventMap["game2048:attempt"];
			return `${data.move}${formatTraceTag(data.traceId)}: ${data.changed ? "changed" : "no change"} (${formatPercent(data.changeRatio)})`;
		}
		case "game2048:run-complete": {
			const data = payload as EventMap["game2048:run-complete"];
			return `${data.summary}${formatTraceTag(data.traceId)}`;
		}
		case "game2048:state-change": {
			const data = payload as EventMap["game2048:state-change"];
			const latest = data.state.lastRun;
			return latest ? `Latest run: ${latest.status}` : "State refreshed";
		}
		case "sokoban:target-detected": {
			const data = payload as EventMap["sokoban:target-detected"];
			return data.summary;
		}
		case "sokoban:run-start": {
			const data = payload as EventMap["sokoban:run-start"];
			return `${data.targetTitle}${formatTraceTag(data.traceId)}: ${data.plannedMoves.join(" -> ")}`;
		}
		case "sokoban:attempt": {
			const data = payload as EventMap["sokoban:attempt"];
			return `${data.move}${formatTraceTag(data.traceId)}: ${data.changed ? "changed" : "no change"} (${formatPercent(data.changeRatio)})`;
		}
		case "sokoban:run-complete": {
			const data = payload as EventMap["sokoban:run-complete"];
			return `${data.summary}${formatTraceTag(data.traceId)}`;
		}
		case "sokoban:state-change": {
			const data = payload as EventMap["sokoban:state-change"];
			const latest = data.state.lastRun;
			return latest ? `Latest run: ${latest.status}` : "State refreshed";
		}
		case "evaluation:case-start": {
			const data = payload as EventMap["evaluation:case-start"];
			return `${data.game}/${data.caseId} x${data.iterations}`;
		}
		case "evaluation:case-complete": {
			const data = payload as EventMap["evaluation:case-complete"];
			return data.result.summary || `${data.result.caseId}: ${formatPercent(data.result.metrics.successRate)} success`;
		}
		case "evaluation:state-change": {
			const data = payload as EventMap["evaluation:state-change"];
			return `active=${data.state.activeCaseId ?? "none"}, history=${data.state.history.length}`;
		}
		case "unified:state-change": {
			const data = payload as EventMap["unified:state-change"];
			return `phase=${data.state.phase}, active=${data.state.activeRunId ?? "none"}`;
		}
		case "unified:run-start": {
			const data = payload as EventMap["unified:run-start"];
			return `${data.trigger}${formatTraceTag(data.traceId)}: ${data.requestText ?? "direct game step"}`;
		}
		case "unified:run-complete": {
			const data = payload as EventMap["unified:run-complete"];
			return `${data.gameId ?? "unknown"} ${data.success ? "complete" : "failed"}${formatTraceTag(data.traceId)}: ${data.summary} / total-blocking ${data.timings.totalBlockingMs.toFixed(0)}ms / nonblocking ${data.timings.totalNonBlockingMs.toFixed(0)}ms`;
		}
		case "unified:voice-input": {
			const data = payload as EventMap["unified:voice-input"];
			return data.command ? `${data.command}: ${truncate(data.text, 80)}` : `voice: ${truncate(data.text, 80)}`;
		}
		case "companion-runtime:state-change": {
			const data = payload as EventMap["companion-runtime:state-change"];
			return `phase=${data.phase}, frames=${data.frameQueueLength}, summaries=${data.summaryHistoryLength}`;
		}
		case "companion-runtime:frame-described": {
			const data = payload as EventMap["companion-runtime:frame-described"];
			return `${data.record.source === "unchanged" ? "unchanged" : "vision"}: ${truncate(data.record.description, 96)}`;
		}
		case "companion-runtime:summary-complete": {
			const data = payload as EventMap["companion-runtime:summary-complete"];
			return `${data.record.source}: ${truncate(data.record.summary, 100)}`;
		}
		case "companion-runtime:benchmark-start": {
			const data = payload as EventMap["companion-runtime:benchmark-start"];
			return `${data.name} @ ${data.targetTitle} (${Math.round(data.durationMs / 1000)}s)`;
		}
		case "companion-runtime:benchmark-complete": {
			const data = payload as EventMap["companion-runtime:benchmark-complete"];
			return `${data.result.benchmarkName}: ${data.result.metrics.framesPerMinute.toFixed(1)}/min, unchanged ${formatPercent(data.result.metrics.unchangedRatio)}`;
		}
		case "companion-runtime:benchmark-state-change": {
			const data = payload as EventMap["companion-runtime:benchmark-state-change"];
			return `active=${data.state.activeBenchmarkId ?? "none"}, history=${data.state.history.length}`;
		}
		default:
			return serializePayload(payload);
	}
}

function getSeverity(event: EventName, payload: unknown): "info" | "warn" | "error" {
	switch (event) {
		case "system:error":
		case "llm:error":
		case "system:ui-stall":
		case "mcp:tool-complete": {
			if (event === "mcp:tool-complete") {
				const data = payload as EventMap["mcp:tool-complete"];
				return data.ok ? "info" : "error";
			}
			if (event === "system:ui-stall") {
				const data = payload as EventMap["system:ui-stall"];
				return data.durationMs >= 1000 ? "error" : "warn";
			}
			return "error";
		}
		case "voice:state-change": {
			const data = payload as EventMap["voice:state-change"];
			return data.state.status === "error" ? "error" : "info";
		}
		case "orchestrator:task-log": {
			const data = payload as EventMap["orchestrator:task-log"];
			if (data.level === "error") return "error";
			if (data.level === "warn") return "warn";
			return "info";
		}
		case "orchestrator:task-complete": {
			const data = payload as EventMap["orchestrator:task-complete"];
			return data.success ? "info" : "error";
		}
		case "game2048:run-complete": {
			const data = payload as EventMap["game2048:run-complete"];
			return data.success ? "info" : "warn";
		}
		case "sokoban:run-complete": {
			const data = payload as EventMap["sokoban:run-complete"];
			return data.success ? "info" : "warn";
		}
		case "unified:run-complete": {
			const data = payload as EventMap["unified:run-complete"];
			return data.success ? "info" : "warn";
		}
		case "companion-runtime:benchmark-complete": {
			const data = payload as EventMap["companion-runtime:benchmark-complete"];
			return data.result.status === "completed" ? "info" : "warn";
		}
		case "evaluation:case-complete": {
			const data = payload as EventMap["evaluation:case-complete"];
			if (data.result.status !== "completed") {
				return "error";
			}
			if (data.result.metrics.successRate < 1) {
				return "warn";
			}
			return "info";
		}
		case "safety:decision": {
			const data = payload as EventMap["safety:decision"];
			return data.allowed ? "info" : "warn";
		}
		default:
			return "info";
	}
}

function toEntry(entry: EventHistoryEntry): EventLogEntry | null {
	if (!TRACKED_EVENTS.includes(entry.event)) return null;

	const category = getCategoryForEvent(entry.event);
	return {
		key: String(entry.sequence),
		event: entry.event,
		timestamp: entry.timestamp,
		timestampLabel: new Date(entry.timestamp).toLocaleTimeString(),
		category: category.name,
		color: category.color,
		isDebug: isDebugEvent(entry.event),
		severity: getSeverity(entry.event, entry.payload),
		summary: formatSummary(entry.event, entry.payload),
		payloadPreviewText: formatPayloadPreview(entry.event, entry.payload),
		rawPayload: entry.payload,
	};
}

export function useEventLog(limit = DEFAULT_LIMIT, options?: UseEventLogOptions) {
	const { bus } = getServices();
	const historyVersion = useSyncExternalStore(
		(onStoreChange) => bus.subscribeHistory(onStoreChange),
		() => bus.getHistoryVersion(),
		() => 0,
	);
	const history = bus.getHistory();

	const entries = useMemo(() => {
		const includeTotalTrackedEntries = options?.includeTotalTrackedEntries ?? true;
		const mode = options?.mode ?? "full";
		if (mode === "latest") {
			let latest: EventLogEntry | null = null;
			for (let index = history.length - 1; index >= 0; index -= 1) {
				if (!options?.showDebug && isDebugEvent(history[index].event)) {
					continue;
				}
				const normalized = toEntry(history[index]);
				if (normalized) {
					latest = normalized;
					break;
				}
			}
			return {
				entries: latest ? [latest] : [],
				totalTrackedEntries: includeTotalTrackedEntries ? history.length : (latest ? 1 : 0),
			};
		}

		const next: EventLogEntry[] = [];
		const startIndex = Math.max(0, history.length - limit);
		for (let index = startIndex; index < history.length; index += 1) {
			if (!options?.showDebug && isDebugEvent(history[index].event)) {
				continue;
			}
			const normalized = toEntry(history[index]);
			if (normalized) {
				next.push(normalized);
			}
		}
		return {
			entries: next,
			totalTrackedEntries: includeTotalTrackedEntries
				? history.reduce((count, item) => {
					if (!TRACKED_EVENTS.includes(item.event)) return count;
					if (!options?.showDebug && isDebugEvent(item.event)) return count;
					return count + 1;
				}, 0)
				: next.length,
		};
	}, [history, historyVersion, limit, options?.includeTotalTrackedEntries, options?.mode, options?.showDebug]);

	const clear = useCallback(() => {
		bus.clearHistory();
	}, [bus]);

	return {
		entries: entries.entries,
		clear,
		latestEntry: entries.entries[entries.entries.length - 1] ?? null,
		totalTrackedEntries: entries.totalTrackedEntries,
	};
}
