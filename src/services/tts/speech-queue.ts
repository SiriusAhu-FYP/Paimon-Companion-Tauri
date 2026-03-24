import type { ITTSService } from "./types";
import type { SplitSegment } from "./text-splitter";
import type { AudioPlayer } from "@/services/audio/audio-player";
import { trimSilence } from "@/services/audio/audio-trimmer";
import { createLogger } from "@/services/logger";

const log = createLogger("speech-queue");

interface SynthResult {
	index: number;
	audio: ArrayBuffer | null;
	error?: string;
}

/**
 * 合成+播放队列：1 段预缓冲并发合成、严格顺序播放。
 * 某段合成失败时跳过该段，继续后续段。
 * speaking 状态由 onSpeakingChange 回调统一管理，段间不抖动。
 */
export class SpeechQueue {
	private tts: ITTSService;
	private player: AudioPlayer;
	private onSpeakingChange: (speaking: boolean) => void;
	private _debugFailIndex: number | null = null;

	constructor(
		tts: ITTSService,
		player: AudioPlayer,
		onSpeakingChange: (speaking: boolean) => void,
	) {
		this.tts = tts;
		this.player = player;
		this.onSpeakingChange = onSpeakingChange;
	}

	/** 设置调试失败注入：指定 index 的合成将人为失败 */
	setDebugFailIndex(index: number | null) {
		this._debugFailIndex = index;
		if (index !== null) {
			log.info(`debug: will fail synthesis at index ${index}`);
		}
	}

	/**
	 * 对传入的文本片段数组执行"1 段预缓冲"合成 + 严格顺序播放。
	 *
	 * 流程：
	 * - 在播放 slot[i] 的同时，启动 slot[i+1] 的合成
	 * - 播放严格按序，slot[i] 播完才播 slot[i+1]
	 * - 合成失败的段跳过
	 */
	async speakAll(segments: SplitSegment[]): Promise<void> {
		if (!segments.length) return;

		log.info(`speakAll: ${segments.length} segments`);
		let anyPlayed = false;

		// 启动第一段合成
		let nextSynthPromise: Promise<SynthResult> | null =
			this.synthesizeSegment(segments[0], 0);

		for (let i = 0; i < segments.length; i++) {
			// 等待当前段合成完成
			const current = await nextSynthPromise!;

			// 启动下一段的预缓冲合成（如果有）
			if (i + 1 < segments.length) {
				nextSynthPromise = this.synthesizeSegment(segments[i + 1], i + 1);
			} else {
				nextSynthPromise = null;
			}

			// 处理当前段
			if (!current.audio || current.audio.byteLength === 0) {
				if (current.error) {
					log.warn(`[${i + 1}/${segments.length}] synthesis failed, skipping: ${current.error}`);
				} else {
					log.warn(`[${i + 1}/${segments.length}] empty audio, skipping`);
				}
				continue;
			}

			if (!anyPlayed) {
				anyPlayed = true;
				this.onSpeakingChange(true);
			}

			// 裁剪静音后播放
			let audioToPlay = current.audio;
			try {
				audioToPlay = trimSilence(current.audio);
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] trim failed, using original: ${err}`);
			}

			try {
				await this.player.play(audioToPlay);
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] playback failed, skipping: ${err}`);
			}
		}

		if (anyPlayed) {
			this.onSpeakingChange(false);
		}
		log.info("speakAll done");
	}

	private async synthesizeSegment(
		segment: SplitSegment,
		index: number,
	): Promise<SynthResult> {
		log.debug(`[${index + 1}] synthesizing: "${segment.text.slice(0, 40)}..." lang=${segment.lang}`);

		// 调试失败注入
		if (this._debugFailIndex === index) {
			return {
				index,
				audio: null,
				error: `[debug] forced failure at index ${index}`,
			};
		}

		try {
			const audio = await this.tts.synthesize(segment.text, { lang: segment.lang });
			return { index, audio };
		} catch (err) {
			return { index, audio: null, error: String(err) };
		}
	}
}
