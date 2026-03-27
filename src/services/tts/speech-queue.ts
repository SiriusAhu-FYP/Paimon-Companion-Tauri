import type { ITTSService } from "./types";
import type { SplitSegment } from "./text-splitter";
import type { AudioPlayer } from "@/services/audio/audio-player";
import { trimSilence } from "@/services/audio/audio-trimmer";
import { createLogger } from "@/services/logger";

const log = createLogger("speech-queue");

/** 正式支持的语言列表，与 GptSovitsTTSService 的 LANG_ROUTE 保持一致 */
const SUPPORTED_LANGS = new Set(["zh", "en", "ja"]);

interface SynthResult {
	index: number;
	audio: ArrayBuffer | null;
	error?: string;
	synthStartMs: number;
	synthDoneMs: number;
}

interface SegmentTiming {
	index: number;
	text: string;
	lang: string;
	synthMs: number;
	playMs: number;
	gapMs: number;
}

/** speakAll 的返回摘要，供调用者显示诊断信息 */
export interface SpeakAllResult {
	totalSegments: number;
	playedSegments: number;
	skippedSegments: number;
	errors: string[];
	stopped: boolean;
}

/**
 * 合成+播放队列：1 段预缓冲并发合成、严格顺序播放。
 *
 * - 播放 slot[i] 的同时，slot[i+1] 的合成已经启动
 * - 合成失败或 unsupported 语言的段会被跳过
 * - speaking 状态由 onSpeakingChange 回调统一管理，段间不抖动
 * - trim 默认关闭，可通过 setTrimEnabled 开启
 */
export class SpeechQueue {
	private tts: ITTSService;
	private player: AudioPlayer;
	private onSpeakingChange: (speaking: boolean) => void;
	private _debugFailIndex: number | null = null;
	private _trimEnabled = false;
	private _stopped = false;

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
			log.info(`[debug] will fail synthesis at index ${index}`);
		}
	}

	/** 中断当前 speakAll，停止所有进行中的合成+播放 */
	stop() {
		this._stopped = true;
		this.player.stop();
		log.info("[queue] stopped");
	}

	/** 重置中断标志（新一次 speakAll 前自动调用） */
	private resetStopped() {
		this._stopped = false;
	}

	/** 设置是否启用静音裁剪（默认关闭） */
	setTrimEnabled(enabled: boolean) {
		this._trimEnabled = enabled;
		log.info(`[trim] ${enabled ? "enabled" : "disabled"}`);
	}

	getTrimEnabled(): boolean {
		return this._trimEnabled;
	}

	/**
	 * 对传入的文本片段数组执行"1 段预缓冲"合成 + 严格顺序播放。
	 *
	 * 审计确认的关键行为：
	 * 1. 播放 slot[i] 的同时，slot[i+1] 的合成已在后台进行（异步并发）
	 * 2. 播放严格按序，slot[i] 播完才播 slot[i+1]
	 * 3. unsupported 语言的段直接跳过
	 * 4. 合成失败的段跳过，后续段继续
	 */
	async speakAll(segments: SplitSegment[]): Promise<SpeakAllResult> {
		if (!segments.length) return { totalSegments: 0, playedSegments: 0, skippedSegments: 0, errors: [], stopped: false };

		this.resetStopped();
		log.info(`[queue] speakAll: ${segments.length} segments`);
		const queueStartMs = performance.now();
		let anyPlayed = false;
		const timings: SegmentTiming[] = [];
		const errors: string[] = [];

		// 启动第一段合成（跳过 unsupported）
		let nextSynthPromise: Promise<SynthResult> | null =
			this.prepareSegment(segments[0], 0);

		for (let i = 0; i < segments.length; i++) {
			// 检查停止标志
			if (this._stopped) {
				log.info(`[queue] stopped at segment ${i + 1}, breaking`);
				break;
			}

			// 等待当前段合成完成
			const current = await nextSynthPromise!;

			// 停止标志可能在等待中被打断
			if (this._stopped) {
				log.info(`[queue] stopped during synth at segment ${i + 1}, breaking`);
				break;
			}

			// 启动下一段的预缓冲合成（如果有）
			if (i + 1 < segments.length) {
				nextSynthPromise = this.prepareSegment(segments[i + 1], i + 1);
			} else {
				nextSynthPromise = null;
			}

			// 处理当前段
			if (!current.audio || current.audio.byteLength === 0) {
				if (current.error) {
					log.warn(`[queue][${i + 1}/${segments.length}] skipped: ${current.error}`);
					errors.push(current.error);
				}
				continue;
			}

			if (!anyPlayed) {
				anyPlayed = true;
				this.onSpeakingChange(true);
			}

			// trim 可选
			let audioToPlay = current.audio;
			if (this._trimEnabled) {
				try {
					audioToPlay = trimSilence(current.audio);
				} catch (err) {
					log.warn(`[trim][${i + 1}/${segments.length}] trim failed, using original: ${err}`);
				}
			}

			// 播放
			const playStartMs = performance.now();
			try {
				await this.player.play(audioToPlay);
			} catch (err) {
				log.warn(`[queue][${i + 1}/${segments.length}] playback failed: ${err}`);
			}
			const playDoneMs = performance.now();

			// 性能日志
			const synthMs = current.synthDoneMs - current.synthStartMs;
			const playMs = playDoneMs - playStartMs;
			const gapMs = playStartMs - (timings.length > 0 ? playDoneMs - playMs : current.synthDoneMs);

			const timing: SegmentTiming = {
				index: i,
				text: segments[i].text.slice(0, 40),
				lang: segments[i].lang,
				synthMs,
				playMs,
				gapMs: Math.max(0, gapMs),
			};
			timings.push(timing);

			log.info(
				`[perf][${i + 1}/${segments.length}] ` +
				`synth=${synthMs.toFixed(0)}ms play=${playMs.toFixed(0)}ms gap=${timing.gapMs.toFixed(0)}ms ` +
				`lang=${segments[i].lang} text="${segments[i].text.slice(0, 30)}"`,
			);
		}

		// 整轮汇总
		if (timings.length > 0) {
			const totalMs = performance.now() - queueStartMs;
			const totalSynth = timings.reduce((s, t) => s + t.synthMs, 0);
			const totalPlay = timings.reduce((s, t) => s + t.playMs, 0);
			const totalGap = timings.reduce((s, t) => s + t.gapMs, 0);
			log.info(
				`[perf] TOTAL: ${totalMs.toFixed(0)}ms ` +
				`(synth=${totalSynth.toFixed(0)}ms play=${totalPlay.toFixed(0)}ms gap=${totalGap.toFixed(0)}ms) ` +
				`${timings.length}/${segments.length} segments played`,
			);
		}

		if (anyPlayed) {
			this.onSpeakingChange(false);
		}
		log.info(`[queue] speakAll done (stopped=${this._stopped}, played=${timings.length}/${segments.length})`);

		return {
			totalSegments: segments.length,
			playedSegments: timings.length,
			skippedSegments: segments.length - timings.length,
			errors,
			stopped: this._stopped,
		};
	}

	/**
	 * 准备一个段的合成。unsupported 语言直接返回空结果。
	 */
	private prepareSegment(
		segment: SplitSegment,
		index: number,
	): Promise<SynthResult> {
		if (!SUPPORTED_LANGS.has(segment.lang)) {
			log.info(`[lang][${index + 1}] unsupported lang="${segment.lang}", skipping: "${segment.text.slice(0, 30)}"`);
			const now = performance.now();
			return Promise.resolve({
				index,
				audio: null,
				error: `unsupported lang: ${segment.lang}`,
				synthStartMs: now,
				synthDoneMs: now,
			});
		}
		return this.synthesizeSegment(segment, index);
	}

	private async synthesizeSegment(
		segment: SplitSegment,
		index: number,
	): Promise<SynthResult> {
		const synthStartMs = performance.now();
		log.debug(`[synth][${index + 1}] start: "${segment.text.slice(0, 40)}..." lang=${segment.lang}`);

		if (this._debugFailIndex === index) {
			return {
				index,
				audio: null,
				error: `[debug] forced failure at index ${index}`,
				synthStartMs,
				synthDoneMs: performance.now(),
			};
		}

		try {
			const audio = await this.tts.synthesize(segment.text, { lang: segment.lang });
			const synthDoneMs = performance.now();
			log.info(
				`[synth][${index + 1}] done: ${audio.byteLength} bytes ` +
				`${(synthDoneMs - synthStartMs).toFixed(0)}ms lang=${segment.lang}`,
			);
			return { index, audio, synthStartMs, synthDoneMs };
		} catch (err) {
			return { index, audio: null, error: String(err), synthStartMs, synthDoneMs: performance.now() };
		}
	}
}
