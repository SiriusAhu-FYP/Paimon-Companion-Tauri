import type { EventBus } from "@/services/event-bus";
import type { IASRService } from "@/services/asr";
import type { PipelineService } from "@/services/pipeline";
import type { VoiceInputState } from "@/types";
import { getConfig } from "@/services/config";
import { createLogger } from "@/services/logger";

const log = createLogger("voice-input");

function createInitialState(providerLabel: string): VoiceInputState {
	return {
		enabled: false,
		status: "idle",
		permission: "unknown",
		providerLabel,
		playbackLocked: false,
		lastTranscript: null,
		lastError: null,
	};
}

function describeProvider(asr: IASRService): string {
	const descriptor = "descriptor" in asr ? (asr as IASRService & { descriptor?: { label?: string } }).descriptor : null;
	return descriptor?.label ?? "ASR";
}

function pickMimeType(): string {
	const candidates = [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/mp4",
		"audio/ogg",
	];
	if (typeof MediaRecorder !== "undefined") {
		for (const candidate of candidates) {
			if (MediaRecorder.isTypeSupported(candidate)) {
				return candidate;
			}
		}
	}
	return "audio/webm";
}

function fileNameForMimeType(mimeType: string): string {
	if (mimeType.includes("ogg")) return "voice-input.ogg";
	if (mimeType.includes("mp4")) return "voice-input.m4a";
	return "voice-input.webm";
}

function computeRms(analyser: AnalyserNode, buffer: Uint8Array): number {
	analyser.getByteTimeDomainData(buffer);
	let sum = 0;
	for (let index = 0; index < buffer.length; index += 1) {
		const normalized = (buffer[index] - 128) / 128;
		sum += normalized * normalized;
	}
	return Math.sqrt(sum / buffer.length);
}

function getVadThreshold(aggressiveness: number): number {
	switch (aggressiveness) {
		case 0:
			return 0.06;
		case 1:
			return 0.045;
		case 3:
			return 0.02;
		case 2:
		default:
			return 0.03;
	}
}

export class VoiceInputService {
	private bus: EventBus;
	private pipeline: PipelineService;
	private asr: IASRService;
	private state: VoiceInputState;
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private analyser: AnalyserNode | null = null;
	private analyserBuffer: Uint8Array | null = null;
	private monitorTimer: number | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private recorderChunks: Blob[] = [];
	private recorderMimeType = pickMimeType();
	private segmentStartedAt = 0;
	private lastSpeechAt = 0;
	private segmentDiscarded = false;
	private pendingRecorderStopResolve: (() => void) | null = null;
	private playbackLocked = false;
	private interactionLocked = false;
	private transcribing = false;

	constructor(deps: {
		bus: EventBus;
		pipeline: PipelineService;
		asr: IASRService;
	}) {
		this.bus = deps.bus;
		this.pipeline = deps.pipeline;
		this.asr = deps.asr;
		this.state = createInitialState(describeProvider(deps.asr));

		this.bus.on("audio:tts-start", () => {
			this.playbackLocked = true;
			void this.interruptRecording(true);
			this.syncState();
		});
		this.bus.on("audio:tts-end", () => {
			this.playbackLocked = false;
			this.interactionLocked = false;
			this.syncState();
		});
		this.bus.on("llm:request-start", () => {
			this.interactionLocked = true;
			void this.interruptRecording(true);
			this.syncState();
		});
		this.bus.on("llm:error", () => {
			this.interactionLocked = false;
			this.syncState();
		});
		this.bus.on("runtime:mode-change", ({ mode }) => {
			if (mode === "stopped" && this.state.enabled) {
				void this.disable();
			}
		});
	}

	getState(): VoiceInputState {
		return { ...this.state };
	}

	setASRService(asr: IASRService) {
		this.asr = asr;
		this.updateState({
			providerLabel: describeProvider(asr),
		});
	}

	async toggle(): Promise<void> {
		if (this.state.enabled) {
			await this.disable();
			return;
		}
		await this.enable();
	}

	async enable(): Promise<void> {
		if (this.state.enabled) return;

		this.updateState({
			enabled: true,
			status: "requesting-permission",
			lastError: null,
		});

		try {
			await this.ensureCaptureGraph();
			this.syncState();
			this.startMonitor();
			log.info("voice input enabled");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const permission = message.includes("denied") ? "denied" : this.state.permission;
			this.updateState({
				enabled: false,
				status: "error",
				permission,
				lastError: message,
			});
			this.bus.emit("system:error", {
				module: "voice-input",
				error: message,
			});
			await this.teardownCaptureGraph();
		}
	}

	async disable(): Promise<void> {
		if (!this.state.enabled && this.state.status === "idle") return;

		this.stopMonitor();
		await this.interruptRecording(true);
		await this.teardownCaptureGraph();

		this.updateState({
			enabled: false,
			status: "idle",
			playbackLocked: false,
			lastError: null,
		});
		log.info("voice input disabled");
	}

	private updateState(partial: Partial<VoiceInputState>) {
		this.state = {
			...this.state,
			...partial,
		};
		this.bus.emit("voice:state-change", { state: this.getState() });
	}

	private syncState() {
		if (!this.state.enabled) {
			this.updateState({
				playbackLocked: false,
				status: this.state.status === "error" ? "error" : "idle",
			});
			return;
		}
		if (this.transcribing) {
			this.updateState({
				playbackLocked: this.playbackLocked,
				status: "transcribing",
			});
			return;
		}
		if (this.playbackLocked || this.interactionLocked) {
			this.updateState({
				playbackLocked: this.playbackLocked,
				status: "locked",
			});
			return;
		}
		if (this.mediaRecorder?.state === "recording") {
			this.updateState({
				playbackLocked: false,
				status: "recording",
			});
			return;
		}
		this.updateState({
			playbackLocked: false,
			status: "listening",
		});
	}

	private async ensureCaptureGraph() {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error("当前环境不支持麦克风采集");
		}
		if (!this.stream) {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
		}
		if (!this.audioContext) {
			this.audioContext = new AudioContext();
		}
		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}
		if (!this.sourceNode || !this.analyser) {
			this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 2048;
			this.analyser.smoothingTimeConstant = 0.25;
			this.sourceNode.connect(this.analyser);
			this.analyserBuffer = new Uint8Array(this.analyser.fftSize);
		}
		this.updateState({
			permission: "granted",
		});
	}

	private async teardownCaptureGraph() {
		if (this.monitorTimer != null) {
			window.clearInterval(this.monitorTimer);
			this.monitorTimer = null;
		}
		if (this.sourceNode) {
			this.sourceNode.disconnect();
			this.sourceNode = null;
		}
		if (this.analyser) {
			this.analyser.disconnect();
			this.analyser = null;
		}
		this.analyserBuffer = null;
		if (this.audioContext) {
			await this.audioContext.close().catch(() => undefined);
			this.audioContext = null;
		}
		if (this.stream) {
			for (const track of this.stream.getTracks()) {
				track.stop();
			}
			this.stream = null;
		}
	}

	private startMonitor() {
		if (this.monitorTimer != null || !this.analyser || !this.analyserBuffer) return;
		this.monitorTimer = window.setInterval(() => {
			void this.monitorTick();
		}, 120);
	}

	private stopMonitor() {
		if (this.monitorTimer != null) {
			window.clearInterval(this.monitorTimer);
			this.monitorTimer = null;
		}
	}

	private async monitorTick() {
		if (!this.state.enabled || !this.analyser || !this.analyserBuffer) return;
		if (this.playbackLocked || this.interactionLocked || this.transcribing) {
			if (this.mediaRecorder?.state === "recording") {
				await this.interruptRecording(true);
			}
			this.syncState();
			return;
		}

		const { asr } = getConfig();
		const rms = computeRms(this.analyser, this.analyserBuffer);
		const threshold = getVadThreshold(asr.vadAggressiveness);
		const now = Date.now();
		const speaking = rms >= threshold;

		if (speaking) {
			this.lastSpeechAt = now;
			if (this.mediaRecorder?.state !== "recording") {
				this.startRecording(now);
			}
			return;
		}

		if (
			this.mediaRecorder?.state === "recording"
			&& this.lastSpeechAt > 0
			&& now - this.lastSpeechAt >= asr.silenceThresholdMs
		) {
			const duration = now - this.segmentStartedAt;
			await this.stopRecording(duration < asr.minSpeechMs);
		}
	}

	private startRecording(now: number) {
		if (!this.stream) return;
		if (typeof MediaRecorder === "undefined") {
			this.updateState({
				status: "error",
				lastError: "当前环境不支持 MediaRecorder",
			});
			return;
		}

		this.recorderChunks = [];
		this.segmentStartedAt = now;
		this.lastSpeechAt = now;
		this.segmentDiscarded = false;
		this.recorderMimeType = pickMimeType();

		this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.recorderMimeType });
		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				this.recorderChunks.push(event.data);
			}
		};
		this.mediaRecorder.onstop = () => {
			const resolve = this.pendingRecorderStopResolve;
			this.pendingRecorderStopResolve = null;
			void this.handleRecorderStop()
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					this.updateState({ lastError: message });
					this.bus.emit("system:error", {
						module: "voice-input",
						error: message,
					});
				})
				.finally(() => resolve?.());
		};
		this.mediaRecorder.start();
		this.bus.emit("audio:vad-start");
		this.syncState();
	}

	private async stopRecording(discard: boolean) {
		const recorder = this.mediaRecorder;
		if (!recorder || recorder.state !== "recording") return;
		this.segmentDiscarded = discard;
		await new Promise<void>((resolve) => {
			this.pendingRecorderStopResolve = resolve;
			recorder.stop();
		});
	}

	private async interruptRecording(discard: boolean) {
		if (this.mediaRecorder?.state === "recording") {
			await this.stopRecording(discard);
		}
	}

	private async handleRecorderStop() {
		const chunks = this.recorderChunks;
		const mimeType = this.recorderMimeType;
		this.recorderChunks = [];
		this.mediaRecorder = null;

		if (this.segmentDiscarded || !chunks.length) {
			this.segmentDiscarded = false;
			this.syncState();
			return;
		}

		const blob = new Blob(chunks, { type: mimeType });
		const audioData = await blob.arrayBuffer();
		this.bus.emit("audio:vad-end", { audioData });
		await this.transcribeAndDispatch(audioData, mimeType);
	}

	private async transcribeAndDispatch(audioData: ArrayBuffer, mimeType: string) {
		this.transcribing = true;
		this.syncState();

		try {
			const text = (await this.asr.transcribe({
				data: audioData,
				mimeType,
				fileName: fileNameForMimeType(mimeType),
			})).trim();

			this.updateState({
				lastTranscript: text || null,
				lastError: null,
			});

			if (!text) {
				this.syncState();
				return;
			}

			this.bus.emit("audio:asr-result", {
				text,
				source: "voice",
			});

			void this.pipeline.run(text).catch((err) => {
				const message = err instanceof Error ? err.message : String(err);
				this.updateState({
					lastError: message,
				});
				this.bus.emit("system:error", {
					module: "voice-input",
					error: message,
				});
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.updateState({
				lastError: message,
			});
			this.bus.emit("system:error", {
				module: "voice-input",
				error: message,
			});
		} finally {
			this.transcribing = false;
			this.syncState();
		}
	}
}
