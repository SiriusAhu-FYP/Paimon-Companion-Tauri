import type { EventBus, EventHistoryEntry } from "@/services/event-bus/event-bus";
import { registerLogSink } from "@/services/logger/logger-service";
import type { DebugCaptureState } from "@/types";
import { appendDebugCaptureText, startDebugCapture, writeDebugCaptureImage } from "./client";

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

function sanitizePayload(value: unknown): unknown {
	if (value == null) return value;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return { type: "ArrayBuffer", byteLength: value.byteLength };
	}
	if (ArrayBuffer.isView(value)) {
		return { type: value.constructor.name, byteLength: value.byteLength };
	}
	if (Array.isArray(value)) {
		return value.map(sanitizePayload);
	}
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizePayload(nested)]),
		);
	}
	return String(value);
}

function stringifyJsonl(payload: unknown) {
	return `${JSON.stringify(payload)}\n`;
}

export class DebugCaptureService {
	private bus: EventBus;
	private state: DebugCaptureState = makeInitialState();
	private nextLabel = "manual";
	private lastEventSequence = 0;
	private pendingWrites = new Map<string, string[]>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushInFlight = false;

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
			if (entry.event === "debug-capture:state-change") {
				continue;
			}
			this.enqueueEvent(entry);
		}
	}

	private enqueueEvent(entry: EventHistoryEntry) {
		this.state.capturedEventCount += 1;
		this.enqueueWrite("events.jsonl", stringifyJsonl({
			timestamp: new Date(entry.timestamp).toISOString(),
			sequence: entry.sequence,
			event: entry.event,
			payload: sanitizePayload(entry.payload),
		}));
		this.emitState();
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
