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

function sameVoiceState(left: VoiceInputState, right: VoiceInputState): boolean {
	return left.enabled === right.enabled
		&& left.status === right.status
		&& left.permission === right.permission
		&& left.providerLabel === right.providerLabel
		&& left.playbackLocked === right.playbackLocked
		&& left.lastTranscript === right.lastTranscript
		&& left.lastError === right.lastError;
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
	private processorNode: ScriptProcessorNode | null = null;
	private muteGainNode: GainNode | null = null;
	private analyserBuffer: Uint8Array | null = null;
	private monitorTimer: number | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private recorderChunks: Blob[] = [];
	private recorderMimeType = pickMimeType();
	private pcmChunks: Float32Array[] = [];
	private segmentStartedAt = 0;
	private lastSpeechAt = 0;
	private segmentDiscarded = false;
	private pendingRecorderStopResolve: (() => void) | null = null;
	private playbackLocked = false;
	private interactionLocked = false;
	private transcribing = false;
	private recordingActive = false;

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
		const nextState = {
			...this.state,
			...partial,
		};
		if (sameVoiceState(this.state, nextState)) {
			return;
		}
		this.state = nextState;
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
		if (this.recordingActive) {
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
		if (!this.processorNode || !this.muteGainNode) {
			this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
			this.muteGainNode = this.audioContext.createGain();
			this.muteGainNode.gain.value = 0;
			this.processorNode.onaudioprocess = (event) => {
				if (!this.recordingActive) return;
				const channel = event.inputBuffer.getChannelData(0);
				this.pcmChunks.push(new Float32Array(channel));
			};
			this.sourceNode.connect(this.processorNode);
			this.processorNode.connect(this.muteGainNode);
			this.muteGainNode.connect(this.audioContext.destination);
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
		if (this.processorNode) {
			this.processorNode.disconnect();
			this.processorNode.onaudioprocess = null;
			this.processorNode = null;
		}
		if (this.muteGainNode) {
			this.muteGainNode.disconnect();
			this.muteGainNode = null;
		}
		this.analyserBuffer = null;
		this.pcmChunks = [];
		this.recordingActive = false;
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
			if (this.recordingActive) {
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
			if (!this.recordingActive) {
				this.startRecording(now);
			}
			return;
		}

		if (
			this.recordingActive
			&& this.lastSpeechAt > 0
			&& now - this.lastSpeechAt >= asr.silenceThresholdMs
		) {
			const duration = now - this.segmentStartedAt;
			await this.stopRecording(duration < asr.minSpeechMs);
		}
	}

	private startRecording(now: number) {
		if (!this.stream) return;
		if (this.asr.inputMode === "encoded" && typeof MediaRecorder === "undefined") {
			this.updateState({
				status: "error",
				lastError: "当前环境不支持 MediaRecorder",
			});
			return;
		}

		this.recorderChunks = [];
		this.pcmChunks = [];
		this.segmentStartedAt = now;
		this.lastSpeechAt = now;
		this.segmentDiscarded = false;
		this.recorderMimeType = pickMimeType();
		this.recordingActive = true;

		if (this.asr.inputMode === "encoded") {
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
		}
		this.bus.emit("audio:vad-start");
		this.syncState();
	}

	private async stopRecording(discard: boolean) {
		if (!this.recordingActive) return;
		this.segmentDiscarded = discard;
		this.recordingActive = false;

		const recorder = this.mediaRecorder;
		if (!recorder || recorder.state !== "recording") {
			await this.handleRecorderStop();
			return;
		}

		await new Promise<void>((resolve) => {
			this.pendingRecorderStopResolve = resolve;
			recorder.stop();
		});
	}

	private async interruptRecording(discard: boolean) {
		if (this.recordingActive) {
			await this.stopRecording(discard);
		}
	}

	private async handleRecorderStop() {
		const sampleRate = this.audioContext?.sampleRate ?? 16000;
		const pcmSamples = this.combinePcmChunks();
		const chunks = this.recorderChunks;
		const mimeType = this.recorderMimeType;
		this.recorderChunks = [];
		this.mediaRecorder = null;

		if (this.segmentDiscarded || (!chunks.length && pcmSamples.length === 0)) {
			this.segmentDiscarded = false;
			this.syncState();
			return;
		}

		const audioData = chunks.length
			? await new Blob(chunks, { type: mimeType }).arrayBuffer()
			: new ArrayBuffer(0);
		this.bus.emit("audio:vad-end", { audioData });
		await this.transcribeAndDispatch(audioData, mimeType, pcmSamples, sampleRate);
	}

	private combinePcmChunks(): Float32Array {
		if (!this.pcmChunks.length) return new Float32Array(0);
		const totalLength = this.pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const merged = new Float32Array(totalLength);
		let offset = 0;
		for (const chunk of this.pcmChunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		this.pcmChunks = [];
		return merged;
	}

	private async transcribeAndDispatch(
		audioData: ArrayBuffer,
		mimeType: string,
		samples: Float32Array,
		sampleRate: number,
	) {
		this.transcribing = true;
		this.syncState();

		try {
			const text = (await this.asr.transcribe({
				data: audioData,
				mimeType,
				fileName: fileNameForMimeType(mimeType),
				samples,
				sampleRate,
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

			void this.pipeline.run(text, { inputSource: "voice" }).catch((err) => {
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
