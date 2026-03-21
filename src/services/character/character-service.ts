import type { CharacterConfig, CharacterState } from "@/types";
import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";

const log = createLogger("character");

/**
 * Phase 1 最小占位：角色状态的权威真源。
 * 管理角色配置加载和情绪/表情状态。
 * 真实的配置文件读取和 Live2D 集成留到后续。
 */
export class CharacterService {
	private state: CharacterState;
	private config: CharacterConfig | null = null;
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

	getConfig(): Readonly<CharacterConfig> | null {
		return this.config ? { ...this.config } : null;
	}

	// Phase 1：mock 加载，传入内存配置
	loadConfig(config: CharacterConfig) {
		this.config = config;
		this.state.characterId = config.id;
		this.state.emotion = config.defaultEmotion;
		log.info(`loaded character: ${config.name}`);
		this.notifyStateChange();
	}

	setEmotion(emotion: string) {
		if (emotion === this.state.emotion) return;

		this.state.emotion = emotion;
		const expressionName = this.config?.expressionMap[emotion] ?? emotion;

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
