import type { CharacterProfile, CharacterState } from "@/types";
import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";
import { loadCharacterProfilesFromPublic } from "./character-cards";

const log = createLogger("character");

/**
 * 角色状态真源：当前档案、表情/说话状态、可用角色卡列表。
 */
export class CharacterService {
	private state: CharacterState;
	private profile: CharacterProfile | null = null;
	private catalog: CharacterProfile[] = [];
	private bus: EventBus;

	constructor(bus: EventBus) {
		this.bus = bus;
		this.state = {
			characterId: "",
			emotion: "neutral",
			isSpeaking: false,
			activeModel: null,
		};

		this.bus.on("llm:tool-call", (payload) => {
			if (payload.name === "setExpression") {
				const emotion = payload.args["emotion"] as string;
				if (emotion) this.setEmotion(emotion);
			}
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
		log.info(`loaded character profile: ${profile.name} (${profile.id})`);
		this.notifyStateChange();
	}

	setEmotion(emotion: string) {
		if (emotion === this.state.emotion) return;

		this.state.emotion = emotion;
		const expressionName = this.profile?.expressionMap[emotion] ?? emotion;

		this.bus.emit("character:expression", { emotion, expressionName });
		this.notifyStateChange();
		log.info(`emotion → ${emotion}`);
	}

	setSpeaking(isSpeaking: boolean) {
		if (isSpeaking === this.state.isSpeaking) return;
		this.state.isSpeaking = isSpeaking;
		this.notifyStateChange();
	}

	private notifyStateChange() {
		this.bus.emit("character:state-change", {
			characterId: this.state.characterId,
			emotion: this.state.emotion,
			isSpeaking: this.state.isSpeaking,
		});
	}
}
