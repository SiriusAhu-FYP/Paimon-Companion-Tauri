import type { ITTSService } from "./types";
import type { AudioPlayer } from "@/services/audio/audio-player";
import { createLogger } from "@/services/logger";

const log = createLogger("speech-queue");

/**
 * 合成+播放队列：逐段合成、逐段播放、严格按序。
 * 某段合成失败时跳过该段，继续后续段。
 * speaking 状态由 onSpeakingChange 回调统一管理，段间不抖动。
 */
export class SpeechQueue {
	private tts: ITTSService;
	private player: AudioPlayer;
	private onSpeakingChange: (speaking: boolean) => void;

	constructor(
		tts: ITTSService,
		player: AudioPlayer,
		onSpeakingChange: (speaking: boolean) => void,
	) {
		this.tts = tts;
		this.player = player;
		this.onSpeakingChange = onSpeakingChange;
	}

	/**
	 * 对传入的文本片段数组依次合成并播放。
	 * 整轮开始时进入 speaking，整轮结束后退出 speaking。
	 */
	async speakAll(segments: string[]): Promise<void> {
		if (!segments.length) return;

		log.info(`speakAll: ${segments.length} segments`);
		let anyPlayed = false;

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			log.debug(`[${i + 1}/${segments.length}] synthesizing: "${seg.slice(0, 40)}..."`);

			let audioData: ArrayBuffer;
			try {
				audioData = await this.tts.synthesize(seg);
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] synthesis failed, skipping: ${err}`);
				continue;
			}

			if (!audioData || audioData.byteLength === 0) {
				log.warn(`[${i + 1}/${segments.length}] empty audio, skipping`);
				continue;
			}

			// 第一段成功合成时开始 speaking
			if (!anyPlayed) {
				anyPlayed = true;
				this.onSpeakingChange(true);
			}

			try {
				await this.player.play(audioData);
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] playback failed, skipping: ${err}`);
			}
		}

		if (anyPlayed) {
			this.onSpeakingChange(false);
		}
		log.info("speakAll done");
	}
}
