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
	/** EXP-LOG: synthesis timing */
	synthStartMs?: number;
	synthDoneMs?: number;
}

/** EXP-LOG: per-segment timing record */
interface SegmentTiming {
	index: number;
	text: string;
	lang: string;
	synthStartMs: number;
	synthDoneMs: number;
	playStartMs: number;
	playDoneMs: number;
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

		// EXP-LOG: timing records for all segments
		const timings: SegmentTiming[] = [];

		// 启动第一段合成
		let nextSynthPromise: Promise<SynthResult> | null =
			this.synthesizeSegment(segments[0], 0);

		for (let i = 0; i < segments.length; i++) {
			const t0 = performance.now();

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

			// EXP-LOG: record synth timing
			const segTiming: SegmentTiming = {
				index: i,
				text: segments[i].text.slice(0, 40),
				lang: segments[i].lang,
				synthStartMs: current.synthStartMs ?? 0,
				synthDoneMs: current.synthDoneMs ?? t0,
				playStartMs: 0,
				playDoneMs: 0,
			};

			// 裁剪静音后播放
			let audioToPlay = current.audio;
			try {
				audioToPlay = trimSilence(current.audio);
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] trim failed, using original: ${err}`);
			}

			try {
				// EXP-LOG: play start
				segTiming.playStartMs = performance.now();
				await this.player.play(audioToPlay);
				// EXP-LOG: play done
				segTiming.playDoneMs = performance.now();
			} catch (err) {
				log.warn(`[${i + 1}/${segments.length}] playback failed, skipping: ${err}`);
			}

			// EXP-LOG: log segment timing
			const synthDur = segTiming.synthDoneMs - segTiming.synthStartMs;
			const playDur = segTiming.playDoneMs - segTiming.playStartMs;
			const prevEnd = i > 0 ? timings[i - 1].playDoneMs : segTiming.synthStartMs;
			const gap = segTiming.playStartMs - prevEnd;
			log.info(
				`[EXP-timing][${i + 1}/${segments.length}] ` +
				`synth=${synthDur.toFixed(0)}ms, play=${playDur.toFixed(0)}ms, gap=${gap.toFixed(0)}ms, ` +
				`text="${segTiming.text}" lang=${segTiming.lang}`,
			);

			timings.push(segTiming);
		}

		// EXP-LOG: summary
		if (timings.length > 0) {
			const total = timings[timings.length - 1].playDoneMs - timings[0].synthStartMs;
			log.info(`[EXP-timing] TOTAL: ${total.toFixed(0)}ms for ${timings.length} segments`);
			// Check if pre-buffering is working: play_start[i+1] should be < synth_done[i+1]
			for (let i = 0; i < timings.length - 1; i++) {
				const buffered = timings[i + 1].synthDoneMs < timings[i].playStartMs;
				log.info(`[EXP-timing] segment ${i + 1} pre-buffer: ${buffered ? "OK" : "FAILED"} (play_start=${timings[i].playStartMs.toFixed(0)}, next_synth_done=${timings[i + 1].synthDoneMs.toFixed(0)})`);
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
		const synthStartMs = performance.now();
		log.debug(`[${index + 1}] synthesizing: "${segment.text.slice(0, 40)}..." lang=${segment.lang}`);

		// 调试失败注入
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
				`[EXP-synth][${index + 1}] done: ${audio.byteLength} bytes, ` +
				`duration=${(synthDoneMs - synthStartMs).toFixed(0)}ms, lang=${segment.lang}`,
			);
			return { index, audio, synthStartMs, synthDoneMs };
		} catch (err) {
			return { index, audio: null, error: String(err), synthStartMs, synthDoneMs: performance.now() };
		}
	}
}
