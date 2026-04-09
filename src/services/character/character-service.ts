import type { CharacterProfile, CharacterState } from "@/types";
import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";
import { loadCharacterProfilesFromPublic } from "./character-cards";
import type { CharacterMotionCandidate } from "./expression-protocol";
import {
	pickExpressionCandidate,
	pickMotionCandidate,
	resolveEmotionCandidates,
	resolveMotionCandidates,
} from "./expression-protocol";

const log = createLogger("character");
const DEFAULT_EXPRESSION_IDLE_TIMEOUT_MS = 60_000;
const SPEECH_START_GRACE_MS = 2_000;
const TTS_PENDING_HOLD_MS = 30_000;

/**
 * 角色状态真源：当前档案、表情/说话状态、可用角色卡列表。
 */
export class CharacterService {
	private state: CharacterState;
	private profile: CharacterProfile | null = null;
	private catalog: CharacterProfile[] = [];
	private bus: EventBus;
	private lastExpressionName: string | null = null;
	private lastMotion: CharacterMotionCandidate | null = null;
	private expressionResetTimer: ReturnType<typeof setTimeout> | null = null;
	private speechStartGraceTimer: ReturnType<typeof setTimeout> | null = null;
	private expressionIdleTimeoutMs = DEFAULT_EXPRESSION_IDLE_TIMEOUT_MS;
	private holdExpressionUntilSpeechEnds = false;

	constructor(bus: EventBus) {
		this.bus = bus;
		this.state = {
			characterId: "",
			emotion: "neutral",
			isSpeaking: false,
			activeModel: null,
		};

		this.bus.on("audio:tts-pending", () => {
			if (this.state.emotion === "neutral") return;
			this.clearExpressionResetTimer();
			this.clearSpeechStartGraceTimer();
			this.holdExpressionUntilSpeechEnds = true;
			this.speechStartGraceTimer = setTimeout(() => {
				this.speechStartGraceTimer = null;
				if (!this.state.isSpeaking && this.state.emotion !== "neutral" && this.holdExpressionUntilSpeechEnds) {
					this.holdExpressionUntilSpeechEnds = false;
					this.scheduleExpressionReset(this.state.emotion);
				}
			}, TTS_PENDING_HOLD_MS);
		});
	}

	getState(): Readonly<CharacterState> {
		return { ...this.state };
	}

	/** 当前生效的角色档案（供 LLM prompt 等使用） */
	getProfile(): Readonly<CharacterProfile> | null {
		return this.profile ? { ...this.profile } : null;
	}

	/** 已加载的可用角色卡（来自 public/cards） */
	getAvailableProfiles(): readonly CharacterProfile[] {
		return [...this.catalog];
	}

	findProfileById(id: string): CharacterProfile | undefined {
		return this.catalog.find((p) => p.id === id);
	}

	/** 从网络拉取 manifest 与 JSON，填充 catalog */
	async refreshCatalogFromPublic(): Promise<void> {
		this.catalog = await loadCharacterProfilesFromPublic();
		log.info(`character catalog loaded: ${this.catalog.length} profile(s)`);
	}

	loadFromProfile(profile: CharacterProfile) {
		this.profile = { ...profile };
		this.state.characterId = profile.id;
		this.state.emotion = profile.defaultEmotion;
		this.lastExpressionName = null;
		this.lastMotion = null;
		this.clearExpressionResetTimer();
		log.info(`loaded character profile: ${profile.name} (${profile.id})`);
		this.notifyStateChange();
	}

	setActiveModel(modelPath: string | null) {
		if (modelPath === this.state.activeModel) return;
		this.state.activeModel = modelPath;
		this.notifyStateChange();
		log.info(`active model → ${modelPath ?? "none"}`);
	}

	setExpressionIdleTimeoutSeconds(seconds: number | null | undefined) {
		const normalizedSeconds = Number.isFinite(seconds)
			? Math.max(5, Math.min(600, Math.round(seconds as number)))
			: DEFAULT_EXPRESSION_IDLE_TIMEOUT_MS / 1000;
		this.expressionIdleTimeoutMs = normalizedSeconds * 1000;
		log.info(`expression idle timeout → ${normalizedSeconds}s`);
		if (this.state.emotion !== "neutral") {
			this.planExpressionReset(this.state.emotion);
		}
	}

	setEmotion(emotion: string) {
		const emotionChanged = emotion !== this.state.emotion;
		const candidates = resolveEmotionCandidates(
			this.state.activeModel,
			this.profile?.expressionMap,
			emotion,
		);
		const previousExpression = !emotionChanged ? this.lastExpressionName : null;
		const expressionName = pickExpressionCandidate(candidates, previousExpression) ?? emotion;
		const motionCandidates = resolveMotionCandidates(this.state.activeModel, emotion);
		const motion = pickMotionCandidate(motionCandidates, !emotionChanged ? this.lastMotion : null);

		if (!emotionChanged && previousExpression && expressionName === previousExpression) {
			this.planExpressionReset(emotion);
			log.info(`emotion timer refreshed: ${emotion}`, {
				activeModel: this.state.activeModel,
				expressionName,
				candidateCount: candidates.length,
				motionCandidateCount: motionCandidates.length,
			});
			return;
		}

		this.state.emotion = emotion;
		this.lastExpressionName = expressionName;
		this.lastMotion = motion;
		this.bus.emit("character:expression", { emotion, expressionName });
		if (motion) {
			this.bus.emit("character:motion", motion);
		}
		if (emotionChanged) {
			this.notifyStateChange();
		}
		this.planExpressionReset(emotion);
		log.info(`emotion → ${emotion}`, {
			activeModel: this.state.activeModel,
			expressionName,
			candidateCount: candidates.length,
			motionGroup: motion?.motionGroup ?? null,
			motionIndex: motion?.index ?? null,
		});
	}

	setSpeaking(isSpeaking: boolean) {
		if (isSpeaking === this.state.isSpeaking) return;
		const wasSpeaking = this.state.isSpeaking;
		this.state.isSpeaking = isSpeaking;
		this.notifyStateChange();
		if (isSpeaking) {
			this.clearExpressionResetTimer();
			this.clearSpeechStartGraceTimer();
			if (this.state.emotion !== "neutral") {
				this.holdExpressionUntilSpeechEnds = true;
			}
			return;
		}

		if (wasSpeaking && this.state.emotion !== "neutral" && this.holdExpressionUntilSpeechEnds) {
			this.holdExpressionUntilSpeechEnds = false;
			this.scheduleExpressionReset(this.state.emotion);
		}
	}

	private notifyStateChange() {
		this.bus.emit("character:state-change", {
			characterId: this.state.characterId,
			emotion: this.state.emotion,
			isSpeaking: this.state.isSpeaking,
		});
	}

	private planExpressionReset(emotion: string) {
		this.clearExpressionResetTimer();
		this.clearSpeechStartGraceTimer();
		this.holdExpressionUntilSpeechEnds = false;
		if (emotion === "neutral") return;

		if (this.state.isSpeaking) {
			this.holdExpressionUntilSpeechEnds = true;
			return;
		}

		// 给即将开始的 TTS 一个很短的接管窗口，避免表情从文本出现时就提前倒计时。
		this.speechStartGraceTimer = setTimeout(() => {
			this.speechStartGraceTimer = null;
			if (this.state.emotion !== emotion || this.state.isSpeaking) {
				return;
			}
			this.scheduleExpressionReset(emotion);
		}, SPEECH_START_GRACE_MS);
	}

	private scheduleExpressionReset(emotion: string) {
		this.clearExpressionResetTimer();
		this.clearSpeechStartGraceTimer();
		this.holdExpressionUntilSpeechEnds = false;
		if (emotion === "neutral") return;

		this.expressionResetTimer = setTimeout(() => {
			this.expressionResetTimer = null;
			this.lastExpressionName = null;
			this.lastMotion = null;
			this.setEmotion("neutral");
		}, this.expressionIdleTimeoutMs);
	}

	private clearExpressionResetTimer() {
		if (this.expressionResetTimer) {
			clearTimeout(this.expressionResetTimer);
			this.expressionResetTimer = null;
		}
	}

	private clearSpeechStartGraceTimer() {
		if (this.speechStartGraceTimer) {
			clearTimeout(this.speechStartGraceTimer);
			this.speechStartGraceTimer = null;
		}
	}
}
