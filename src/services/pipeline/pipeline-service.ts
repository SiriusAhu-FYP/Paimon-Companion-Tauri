import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { CharacterService } from "@/services/character";
import type { LLMService } from "@/services/llm";
import type { ITTSService } from "@/services/tts";
import { AudioPlayer } from "@/services/audio";
import { broadcastMouth } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("pipeline");

/**
 * 主链路编排：文本输入 → LLM → TTS → 音频播放 → 口型同步 → 角色反馈。
 * 不管理服务生命周期，只负责串联已有服务。
 */
export class PipelineService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private character: CharacterService;
	private llm: LLMService;
	private tts: ITTSService;
	private player: AudioPlayer;

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
		this.tts = deps.tts;
		this.player = deps.player;

		// 口型数据 → 主窗口 Live2D + BroadcastChannel → Stage 窗口
		this.player.onMouthData((value) => {
			broadcastMouth(value);
		});
	}

	/** 执行完整主链路：文本 → LLM → TTS → 播放 */
	async run(userText: string): Promise<void> {
		if (!this.runtime.isAllowed()) {
			log.warn("pipeline blocked — runtime stopped");
			return;
		}

		log.info(`pipeline start: "${userText.slice(0, 30)}..."`);

		// 1. LLM（内部会发 llm:request-start, llm:stream-chunk, llm:tool-call, llm:response-end）
		await this.llm.sendMessage(userText);

		if (!this.runtime.isAllowed()) return;

		// 2. 获取完整回复文本用于 TTS
		const history = this.llm.getHistory();
		const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
		if (!lastAssistant?.content) {
			log.warn("no assistant reply for TTS");
			return;
		}

		// 3. TTS 合成
		this.character.setSpeaking(true);
		this.bus.emit("audio:tts-start", { text: lastAssistant.content });

		try {
			const audioData = await this.tts.synthesize(lastAssistant.content);

			if (!this.runtime.isAllowed()) {
				this.character.setSpeaking(false);
				return;
			}

			// 4. 播放音频（会自动驱动口型数据）
			await this.player.play(audioData);
		} catch (err) {
			log.error("TTS/play failed", err);
		} finally {
			this.character.setSpeaking(false);
			this.bus.emit("audio:tts-end");
			log.info("pipeline complete");
		}
	}
}
