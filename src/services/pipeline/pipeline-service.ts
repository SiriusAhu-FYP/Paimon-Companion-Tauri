import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { CharacterService } from "@/services/character";
import type { LLMService } from "@/services/llm";
import type { ITTSService } from "@/services/tts";
import { AudioPlayer } from "@/services/audio";
import { SpeechQueue } from "@/services/tts/speech-queue";
import { splitText } from "@/services/tts/text-splitter";
import { normalizeForSpeech } from "@/services/tts/spoken-text-normalizer";
import { broadcastMouth } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("pipeline");

/**
 * 主链路编排：文本输入 → LLM → 文本切片 → 合成队列+播放队列 → 口型同步 → 角色反馈。
 * 不管理服务生命周期，只负责串联已有服务。
 */
export class PipelineService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private character: CharacterService;
	private llm: LLMService;
	private speechQueue: SpeechQueue;

	constructor(deps: {
		bus: EventBus;
		runtime: RuntimeService;
		character: CharacterService;
		llm: LLMService;
		tts: ITTSService;
		player: AudioPlayer;
	}) {
		this.bus = deps.bus;
		this.runtime = deps.runtime;
		this.character = deps.character;
		this.llm = deps.llm;

		// 口型数据 → 主窗口 Live2D + BroadcastChannel → Stage 窗口
		deps.player.onMouthData((value) => {
			broadcastMouth(value);
		});

		// SpeechQueue 统一管理 speaking 状态，段间不抖动
		this.speechQueue = new SpeechQueue(
			deps.tts,
			deps.player,
			(speaking) => {
				this.character.setSpeaking(speaking);
				if (speaking) {
					this.bus.emit("audio:tts-start", { text: "" });
				} else {
					this.bus.emit("audio:tts-end");
				}
			},
		);
	}

	/** 获取 SpeechQueue 实例（供调试工具使用） */
	getSpeechQueue(): SpeechQueue {
		return this.speechQueue;
	}

	/** 执行完整主链路：文本 → LLM → 分段合成+播放 */
	async run(userText: string): Promise<void> {
		if (!this.runtime.isAllowed()) {
			log.warn("pipeline blocked — runtime stopped");
			return;
		}

		log.info(`pipeline start: "${userText.slice(0, 30)}..."`);

		await this.llm.sendMessage(userText);

		if (!this.runtime.isAllowed()) return;

		const history = this.llm.getHistory();
		const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
		if (!lastAssistant?.content) {
			log.warn("no assistant reply for TTS");
			return;
		}

		// display_text → spoken_text → 切片
		const spokenText = normalizeForSpeech(lastAssistant.content);
		const segments = splitText(spokenText);
		if (!segments.length) {
			log.warn("text splitting produced no segments");
			return;
		}
		log.info(`split into ${segments.length} segments: ${segments.map((s) => `[${s.lang}]"${s.text.slice(0, 20)}"`).join(", ")}`);

		try {
			await this.speechQueue.speakAll(segments);
		} catch (err) {
			log.error("speech queue failed", err);
		} finally {
			log.info("pipeline complete");
		}
	}
}
