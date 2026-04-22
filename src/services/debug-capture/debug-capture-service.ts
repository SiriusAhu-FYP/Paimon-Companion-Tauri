import type { EventBus, EventHistoryEntry } from "@/services/event-bus/event-bus";
import { registerLogSink } from "@/services/logger/logger-service";
import type { DebugCaptureState } from "@/types";
import {
	appendDebugCaptureText,
	exportDebugCaptureSession,
	type DebugCaptureExportInfo,
	startDebugCapture,
	writeDebugCaptureImage,
} from "./client";

function makeInitialState(): DebugCaptureState {
	return {
		enabled: false,
		sessionId: null,
		sessionDirectory: null,
		capturedEventCount: 0,
		capturedImageCount: 0,
		lastWriteAt: null,
		lastError: null,
	};
}

const STRING_SOFT_LIMIT = 512;
const ARRAY_DEPTH_LIMIT = 32;
const MAX_DEPTH = 6;
const DATA_URL_PREFIX = "data:image/";

const THROTTLED_EVENTS = new Set([
	"orchestrator:state-change",
	"companion-runtime:state-change",
	"unified:state-change",
	"game2048:state-change",
	"sokoban:state-change",
]);
const THROTTLE_INTERVAL_MS = 2000;

type DataUrlSummary = {
	_redactedDataUrl: true;
	mimeType: string;
	charLength: number;
	estimatedBytes: number | null;
};

function isDataUrl(value: string): boolean {
	return value.startsWith(DATA_URL_PREFIX);
}

function summarizeDataUrl(value: string): DataUrlSummary {
	const commaIndex = value.indexOf(",");
	const header = commaIndex >= 0 ? value.slice(0, commaIndex) : "";
	const match = header.match(/^data:([^;,\s]+)/i);
	const mimeType = match?.[1] ?? "image/unknown";
	if (commaIndex < 0) {
		return {
			_redactedDataUrl: true,
			mimeType,
			charLength: value.length,
			estimatedBytes: null,
		};
	}
	const encoded = value.slice(commaIndex + 1);
	const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
	const estimatedBytes = Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
	return {
		_redactedDataUrl: true,
		mimeType,
		charLength: value.length,
		estimatedBytes,
	};
}

function truncateString(value: string): string | { _truncated: true; length: number; preview: string } | DataUrlSummary {
	if (isDataUrl(value)) {
		return summarizeDataUrl(value);
	}
	if (value.length <= STRING_SOFT_LIMIT) return value;
	return { _truncated: true, length: value.length, preview: value.slice(0, STRING_SOFT_LIMIT) + "..." };
}

function stringifyJsonl(payload: unknown) {
	return `${JSON.stringify(payload)}\n`;
}

function sanitizePathSegment(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

export class DebugCaptureService {
	private bus: EventBus;
	private state: DebugCaptureState = makeInitialState();
	private nextLabel = "manual";
	private lastEventSequence = 0;
	private pendingWrites = new Map<string, string[]>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushInFlight = false;
	private lastThrottledWriteAt = new Map<string, number>();
	private lastSessionId: string | null = null;
	private inlineEventImageCounter = 0;

	constructor(bus: EventBus) {
		this.bus = bus;
		this.bus.subscribeHistory(() => {
			void this.captureNewEvents();
		});
		registerLogSink((entry) => {
			if (!this.state.enabled) return;
			if (entry.module === "debug-capture") return;
			this.enqueueWrite("app.log", stringifyJsonl(entry));
		});
	}

	getState(): Readonly<DebugCaptureState> {
		return { ...this.state };
	}

	setNextLabel(label: string | null | undefined) {
		const trimmed = label?.trim();
		this.nextLabel = trimmed || "manual";
	}

	async setEnabled(enabled: boolean): Promise<void> {
		if (enabled === this.state.enabled) return;
		if (enabled) {
			const session = await startDebugCapture(this.nextLabel);
			this.inlineEventImageCounter = 0;
			this.state = {
				...this.state,
				enabled: true,
				sessionId: session.sessionId,
				sessionDirectory: session.directory,
				capturedEventCount: 0,
				capturedImageCount: 0,
				lastWriteAt: null,
				lastError: null,
			};
			const history = this.bus.getHistory();
			this.lastEventSequence = history.length ? history[history.length - 1].sequence : 0;
			this.lastSessionId = session.sessionId;
			this.emitState();
			this.enqueueWrite("session.jsonl", stringifyJsonl({
				timestamp: new Date().toISOString(),
				type: "session-start",
				sessionId: session.sessionId,
				directory: session.directory,
			}));
			return;
		}

		this.enqueueWrite("session.jsonl", stringifyJsonl({
			timestamp: new Date().toISOString(),
			type: "session-stop",
			sessionId: this.state.sessionId,
		}));
		await this.flush();
		this.state = {
			...this.state,
			enabled: false,
			sessionId: null,
			sessionDirectory: null,
		};
		this.emitState();
	}

	async exportSession(label?: string): Promise<DebugCaptureExportInfo> {
		const sessionId = this.state.sessionId ?? this.lastSessionId;
		if (!sessionId) {
			throw new Error("no debug capture session available for export");
		}
		return exportDebugCaptureSession(sessionId, label);
	}

	recordLlmExchange(kind: "request" | "response" | "error", payload: Record<string, unknown>) {
		if (!this.state.enabled) return;
		this.enqueueWrite("llm.jsonl", stringifyJsonl({
			timestamp: new Date().toISOString(),
			kind,
			...payload,
		}));
	}

	recordPerceptionImage(snapshot: {
		targetTitle: string;
		capturedAt: number;
		captureMethod: string;
		qualityScore: number;
		dataUrl: string;
	}) {
		if (!this.state.enabled || !this.state.sessionId) return;
		const fileName = `images/frame-${snapshot.capturedAt}.png`;
		void writeDebugCaptureImage(this.state.sessionId, fileName, snapshot.dataUrl)
			.then(() => {
				this.state.capturedImageCount += 1;
				this.state.lastWriteAt = Date.now();
				this.emitState();
				this.enqueueWrite("images.jsonl", stringifyJsonl({
					timestamp: new Date().toISOString(),
					fileName,
					targetTitle: snapshot.targetTitle,
					captureMethod: snapshot.captureMethod,
					qualityScore: snapshot.qualityScore,
				}));
			})
			.catch((error) => {
				this.setLastError(error);
			});
	}

	private async captureNewEvents() {
		if (!this.state.enabled || !this.state.sessionId) return;
		const history = this.bus.getHistory();
		const nextEntries = history.filter((entry) => entry.sequence > this.lastEventSequence);
		if (!nextEntries.length) return;
		for (const entry of nextEntries) {
			this.lastEventSequence = entry.sequence;
			if (entry.event === "debug-capture:state-change") continue;
			if (THROTTLED_EVENTS.has(entry.event)) {
				const lastAt = this.lastThrottledWriteAt.get(entry.event) ?? 0;
				if (entry.timestamp - lastAt < THROTTLE_INTERVAL_MS) continue;
				this.lastThrottledWriteAt.set(entry.event, entry.timestamp);
			}
			await this.enqueueEvent(entry);
		}
	}

	private async enqueueEvent(entry: EventHistoryEntry) {
		this.state.capturedEventCount += 1;
		const payload = await this.sanitizeEventPayload(entry.payload, entry.sequence, ["payload"], 0);
		this.enqueueWrite("events.jsonl", stringifyJsonl({
			timestamp: new Date(entry.timestamp).toISOString(),
			sequence: entry.sequence,
			event: entry.event,
			payload,
		}));
		this.emitState();
	}

	private async sanitizeEventPayload(value: unknown, sequence: number, path: string[], depth: number): Promise<unknown> {
		if (value == null) return value;
		if (typeof value === "number" || typeof value === "boolean") return value;
		if (typeof value === "string") {
			if (isDataUrl(value)) {
				return this.persistEventImageReference(value, sequence, path);
			}
			return truncateString(value);
		}
		if (value instanceof ArrayBuffer) {
			return { _type: "ArrayBuffer", byteLength: value.byteLength };
		}
		if (ArrayBuffer.isView(value)) {
			return { _type: value.constructor.name, byteLength: value.byteLength };
		}
		if (depth >= MAX_DEPTH) return "[depth limit]";
		if (Array.isArray(value)) {
			const sliced = value.slice(0, ARRAY_DEPTH_LIMIT);
			const items = await Promise.all(
				sliced.map((item, index) => this.sanitizeEventPayload(item, sequence, [...path, String(index)], depth + 1)),
			);
			if (value.length > ARRAY_DEPTH_LIMIT) {
				items.push({ _truncated: true, totalLength: value.length });
			}
			return items;
		}
		if (typeof value === "object") {
			const entries = Object.entries(value as Record<string, unknown>);
			const mapped = await Promise.all(entries.map(async ([key, nested]) => (
				[key, await this.sanitizeEventPayload(nested, sequence, [...path, key], depth + 1)] as const
			)));
			return Object.fromEntries(mapped);
		}
		return String(value);
	}

	private async persistEventImageReference(dataUrl: string, sequence: number, path: string[]): Promise<unknown> {
		const sessionId = this.state.sessionId;
		if (!sessionId) {
			return summarizeDataUrl(dataUrl);
		}
		const counter = this.inlineEventImageCounter++;
		const pathHint = sanitizePathSegment(path.slice(-2).join("-")) || "payload";
		const fileName = `images/events/event-${sequence}-${counter}-${pathHint}.png`;
		try {
			await writeDebugCaptureImage(sessionId, fileName, dataUrl);
			this.state.capturedImageCount += 1;
			this.state.lastWriteAt = Date.now();
			this.enqueueWrite("images.jsonl", stringifyJsonl({
				timestamp: new Date().toISOString(),
				fileName,
				source: "event-payload",
				sequence,
				path: path.join("."),
				charLength: dataUrl.length,
			}));
			return {
				_imageRef: true,
				fileName,
				source: "event-payload",
				charLength: dataUrl.length,
			};
		} catch (error) {
			this.setLastError(error);
			return summarizeDataUrl(dataUrl);
		}
	}

	private enqueueWrite(fileName: string, text: string) {
		if (!this.state.enabled || !this.state.sessionId) return;
		const bucket = this.pendingWrites.get(fileName) ?? [];
		bucket.push(text);
		this.pendingWrites.set(fileName, bucket);
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, 250);
	}

	private async flush() {
		if (this.flushInFlight || !this.state.enabled || !this.state.sessionId || this.pendingWrites.size === 0) {
			return;
		}
		this.flushInFlight = true;
		const sessionId = this.state.sessionId;
		const writes = [...this.pendingWrites.entries()];
		this.pendingWrites.clear();
		try {
			for (const [fileName, chunks] of writes) {
				await appendDebugCaptureText(sessionId, fileName, chunks.join(""));
			}
			this.state.lastWriteAt = Date.now();
			this.emitState();
		} catch (error) {
			for (const [fileName, chunks] of writes) {
				const existing = this.pendingWrites.get(fileName) ?? [];
				this.pendingWrites.set(fileName, [...chunks, ...existing]);
			}
			this.setLastError(error);
		} finally {
			this.flushInFlight = false;
		}
	}

	private setLastError(error: unknown) {
		this.state.lastError = error instanceof Error ? error.message : String(error);
		this.emitState();
	}

	private emitState() {
		this.bus.emit("debug-capture:state-change", {
			state: this.getState() as DebugCaptureState,
		});
	}
}
