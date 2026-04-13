import type { CharacterProfile, CharacterState } from "@/types";
import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";
import { loadCharacterProfilesFromPublic } from "./character-cards";
import type { AffectStateService } from "@/services/affect-state";
import {
	pickExpressionCandidate,
	pickMotionCandidate,
	resolveEmotionCandidates,
	resolveMotionCandidates,
} from "./expression-protocol";

const log = createLogger("character");

/**
 * 角色状态真源：当前档案、表情/说话状态、可用角色卡列表。
 */
export class CharacterService {
	private state: CharacterState;
	private profile: CharacterProfile | null = null;
	private catalog: CharacterProfile[] = [];
	private bus: EventBus;
	private affect: AffectStateService;
	private lastExpressionName: string | null = null;

	constructor(bus: EventBus, affect: AffectStateService) {
		this.bus = bus;
		this.affect = affect;
		this.state = {
			characterId: "",
			emotion: "neutral",
			emotionReason: null,
			emotionSource: null,
			isSpeaking: false,
			activeModel: null,
		};
		this.syncFromAffect(this.affect.getState());
		this.bus.on("affect:state-change", ({ state }) => {
			this.syncFromAffect(state);
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
		this.lastExpressionName = null;
		log.info(`loaded character profile: ${profile.name} (${profile.id})`);
		this.bus.emit("character:switch", { characterId: profile.id });
		this.affect.applyEmotion({
			emotion: profile.defaultEmotion,
			source: "system",
			reason: `character-profile-load:${profile.id}`,
		});
		this.notifyStateChange();
	}

	setActiveModel(modelPath: string | null) {
		if (modelPath === this.state.activeModel) return;
		this.state.activeModel = modelPath;
		this.syncFromAffect(this.affect.getState(), true);
		this.notifyStateChange();
		log.info(`active model → ${modelPath ?? "none"}`);
	}

	setExpressionIdleTimeoutSeconds(seconds: number | null | undefined) {
		this.affect.setDecayWindowSeconds(seconds);
	}

	setEmotion(emotion: string) {
		const nextEmotion = resolveManualEmotion(emotion);
		this.affect.applyEmotion({
			emotion: nextEmotion,
			source: "manual",
			reason: `manual-character-set:${nextEmotion}`,
		});
	}

	setSpeaking(isSpeaking: boolean) {
		if (isSpeaking === this.state.isSpeaking) return;
		this.state.isSpeaking = isSpeaking;
		this.affect.setSpeaking(isSpeaking);
		this.notifyStateChange();
	}

	private notifyStateChange() {
		this.bus.emit("character:state-change", {
			characterId: this.state.characterId,
			emotion: this.state.emotion,
			emotionReason: this.state.emotionReason,
			emotionSource: this.state.emotionSource,
			isSpeaking: this.state.isSpeaking,
		});
	}

	private syncFromAffect(nextState: Readonly<{ presentationEmotion: string; lastReason: string; lastSource: string }>, forceExpression = false) {
		const emotionChanged = this.state.emotion !== nextState.presentationEmotion;
		const metadataChanged = this.state.emotionReason !== nextState.lastReason || this.state.emotionSource !== nextState.lastSource;

		this.state.emotion = nextState.presentationEmotion;
		this.state.emotionReason = nextState.lastReason;
		this.state.emotionSource = nextState.lastSource;

		if (emotionChanged || forceExpression) {
			this.applyPresentationEmotion(nextState.presentationEmotion, emotionChanged ? null : this.lastExpressionName);
		}

		if (emotionChanged || metadataChanged) {
			this.notifyStateChange();
		}
	}

	private applyPresentationEmotion(emotion: string, previousExpression: string | null) {
		const candidates = resolveEmotionCandidates(
			this.state.activeModel,
			this.profile?.expressionMap,
			emotion,
		);
		const expressionName = pickExpressionCandidate(candidates, previousExpression) ?? emotion;
		const motionCandidates = resolveMotionCandidates(this.state.activeModel, emotion);
		const motion = pickMotionCandidate(motionCandidates, null);

		this.lastExpressionName = expressionName;
		this.bus.emit("character:expression", { emotion, expressionName });
		if (motion) {
			this.bus.emit("character:motion", motion);
		}
		log.info(`presentation emotion -> ${emotion}`, {
			activeModel: this.state.activeModel,
			expressionName,
			candidateCount: candidates.length,
			motionGroup: motion?.motionGroup ?? null,
			motionIndex: motion?.index ?? null,
		});
	}
}

function resolveManualEmotion(emotion: string): CharacterProfile["defaultEmotion"] {
	switch (emotion) {
		case "happy":
		case "angry":
		case "sad":
		case "delighted":
		case "alarmed":
		case "dazed":
		case "neutral":
			return emotion;
		default:
			return "neutral";
	}
}
