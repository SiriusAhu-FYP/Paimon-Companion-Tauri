import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";
import type { AffectState, AffectEventSource, ApplyEmotionInput, ResetAffectInput } from "@/types";

const log = createLogger("affect-state");
const DEFAULT_INITIAL_INTENSITY = 1;
const DEFAULT_CARRY_INTENSITY = 0.45;
const DEFAULT_DECAY_WINDOW_MS = 15_000;
const PENDING_SPEECH_HOLD_MS = 30_000;

function makeInitialState(): AffectState {
	return {
		currentEmotion: "neutral",
		intensity: 0,
		carryEmotion: "neutral",
		carryIntensity: 0,
		presentationEmotion: "neutral",
		isHeldForSpeech: false,
		lastReason: "initial",
		lastSource: "system",
		updatedAt: Date.now(),
	};
}

function cloneState(state: AffectState): AffectState {
	return { ...state };
}

export class AffectStateService {
	private bus: EventBus;
	private state: AffectState = makeInitialState();
	private decayTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSpeechHoldTimer: ReturnType<typeof setTimeout> | null = null;
	private speaking = false;
	private decayWindowMs = DEFAULT_DECAY_WINDOW_MS;

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	getState(): Readonly<AffectState> {
		return cloneState(this.state);
	}

	setDecayWindowSeconds(seconds: number | null | undefined) {
		const normalizedSeconds = Number.isFinite(seconds)
			? Math.max(5, Math.min(600, Math.round(seconds as number)))
			: DEFAULT_DECAY_WINDOW_MS / 1000;
		this.decayWindowMs = normalizedSeconds * 1000;
		log.info(`affect decay window -> ${normalizedSeconds}s`);
		if (!this.state.isHeldForSpeech && this.state.presentationEmotion !== "neutral") {
			this.scheduleDecay();
		}
	}

	applyEmotion(input: ApplyEmotionInput) {
		this.clearDecayTimer();
		this.state.currentEmotion = input.emotion;
		this.state.presentationEmotion = input.emotion;
		this.state.intensity = input.emotion === "neutral" ? 0 : DEFAULT_INITIAL_INTENSITY;
		this.state.carryEmotion = input.emotion;
		this.state.carryIntensity = input.emotion === "neutral" ? 0 : DEFAULT_CARRY_INTENSITY;
		this.state.lastSource = input.source;
		this.state.lastReason = input.reason;
		this.state.updatedAt = Date.now();

		if (input.emotion === "neutral") {
			this.clearPendingSpeechHoldTimer();
			this.state.isHeldForSpeech = false;
			this.emitStateChange(input.source, input.reason);
			return;
		}

		if (this.speaking || input.holdForSpeech) {
			this.state.isHeldForSpeech = true;
			if (!this.speaking) {
				this.schedulePendingSpeechHoldTimeout();
			}
		} else {
			this.clearPendingSpeechHoldTimer();
			this.state.isHeldForSpeech = false;
			this.scheduleDecay();
		}

		this.emitStateChange(input.source, input.reason);
	}

	reset(input: ResetAffectInput) {
		this.clearDecayTimer();
		this.clearPendingSpeechHoldTimer();
		this.state.currentEmotion = "neutral";
		this.state.presentationEmotion = "neutral";
		this.state.intensity = 0;
		this.state.carryEmotion = "neutral";
		this.state.carryIntensity = 0;
		this.state.isHeldForSpeech = false;
		this.state.lastSource = input.source;
		this.state.lastReason = input.reason;
		this.state.updatedAt = Date.now();
		this.emitStateChange(input.source, input.reason);
	}

	setSpeaking(isSpeaking: boolean) {
		if (this.speaking === isSpeaking) return;

		this.speaking = isSpeaking;
		if (isSpeaking) {
			this.clearDecayTimer();
			this.clearPendingSpeechHoldTimer();
			if (this.state.presentationEmotion !== "neutral") {
				this.state.isHeldForSpeech = true;
				this.state.lastSource = "system";
				this.state.lastReason = "speech-active";
				this.state.updatedAt = Date.now();
				this.emitStateChange("system", "speech-active");
			}
			return;
		}

		this.clearPendingSpeechHoldTimer();
		if (this.state.isHeldForSpeech) {
			this.state.isHeldForSpeech = false;
			this.state.lastSource = "system";
			this.state.lastReason = "speech-ended";
			this.state.updatedAt = Date.now();
			this.emitStateChange("system", "speech-ended");
		}

		if (this.state.presentationEmotion !== "neutral") {
			this.scheduleDecay();
		}
	}

	private scheduleDecay() {
		this.clearDecayTimer();
		if (this.state.presentationEmotion === "neutral" || this.state.isHeldForSpeech) {
			return;
		}

		this.decayTimer = setTimeout(() => {
			this.decayTimer = null;
			this.advanceDecay();
		}, this.decayWindowMs);
	}

	private advanceDecay() {
		if (this.state.isHeldForSpeech || this.speaking) {
			return;
		}

		if (this.state.presentationEmotion === "neutral") {
			return;
		}

		if (this.state.intensity > this.state.carryIntensity) {
			this.state.intensity = this.state.carryIntensity;
			this.state.lastSource = "system";
			this.state.lastReason = "decay-to-carry";
			this.state.updatedAt = Date.now();
			this.emitStateChange("system", "decay-to-carry");
			this.scheduleDecay();
			return;
		}

		this.state.currentEmotion = "neutral";
		this.state.presentationEmotion = "neutral";
		this.state.intensity = 0;
		this.state.carryEmotion = "neutral";
		this.state.carryIntensity = 0;
		this.state.lastSource = "system";
		this.state.lastReason = "decay-to-neutral";
		this.state.updatedAt = Date.now();
		this.emitStateChange("system", "decay-to-neutral");
	}

	private schedulePendingSpeechHoldTimeout() {
		this.clearPendingSpeechHoldTimer();
		this.pendingSpeechHoldTimer = setTimeout(() => {
			this.pendingSpeechHoldTimer = null;
			if (this.speaking || !this.state.isHeldForSpeech || this.state.presentationEmotion === "neutral") {
				return;
			}
			this.state.isHeldForSpeech = false;
			this.state.lastSource = "system";
			this.state.lastReason = "speech-hold-timeout";
			this.state.updatedAt = Date.now();
			this.emitStateChange("system", "speech-hold-timeout");
			this.scheduleDecay();
		}, PENDING_SPEECH_HOLD_MS);
	}

	private clearDecayTimer() {
		if (this.decayTimer) {
			clearTimeout(this.decayTimer);
			this.decayTimer = null;
		}
	}

	private clearPendingSpeechHoldTimer() {
		if (this.pendingSpeechHoldTimer) {
			clearTimeout(this.pendingSpeechHoldTimer);
			this.pendingSpeechHoldTimer = null;
		}
	}

	private emitStateChange(source: AffectEventSource, reason: string) {
		this.bus.emit("affect:state-change", {
			state: this.getState() as AffectState,
			source,
			reason,
		});
		log.info(`affect -> ${this.state.presentationEmotion}`, {
			currentEmotion: this.state.currentEmotion,
			intensity: this.state.intensity,
			carryEmotion: this.state.carryEmotion,
			carryIntensity: this.state.carryIntensity,
			held: this.state.isHeldForSpeech,
			source,
			reason,
		});
	}
}
