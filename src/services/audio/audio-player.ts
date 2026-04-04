import { createLogger } from "@/services/logger";

const log = createLogger("audio-player");

export type MouthDataCallback = (value: number) => void;

/**
 * 音频播放器：播放 ArrayBuffer 格式的音频（WAV），
 * 实时通过 AnalyserNode 提取音量驱动口型数据。
 */
export class AudioPlayer {
	private ctx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private mouthCallbacks: MouthDataCallback[] = [];
	private animFrameId = 0;
	private playing = false;

	onMouthData(cb: MouthDataCallback): () => void {
		this.mouthCallbacks.push(cb);
		return () => {
			this.mouthCallbacks = this.mouthCallbacks.filter((c) => c !== cb);
		};
	}

	isPlaying(): boolean {
		return this.playing;
	}

	pushMouthData(value: number) {
		this.emitMouth(value);
	}

	async play(audioData: ArrayBuffer): Promise<void> {
		if (this.playing) {
			log.warn("already playing, stopping previous");
			this.stop();
		}

		this.ctx = new AudioContext();
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 256;
		this.analyser.smoothingTimeConstant = 0.5;

		let audioBuffer: AudioBuffer;
		try {
			audioBuffer = await this.ctx.decodeAudioData(audioData.slice(0));
		} catch (err) {
			log.error("decode failed", err);
			this.cleanup();
			throw err;
		}

		const source = this.ctx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(this.analyser);
		this.analyser.connect(this.ctx.destination);

		this.playing = true;

		return new Promise<void>((resolve) => {
			source.onended = () => {
				this.playing = false;
				this.emitMouth(0);
				cancelAnimationFrame(this.animFrameId);
				this.cleanup();
				log.info("playback finished");
				resolve();
			};

			source.start(0);
			this.pumpMouthData();
			log.info(`playing ${audioBuffer.duration.toFixed(1)}s audio`);
		});
	}

	stop() {
		if (!this.playing) return;
		this.playing = false;
		cancelAnimationFrame(this.animFrameId);
		this.emitMouth(0);
		this.cleanup();
		log.info("playback stopped");
	}

	private pumpMouthData() {
		if (!this.playing || !this.analyser) return;

		const data = new Uint8Array(this.analyser.frequencyBinCount);
		this.analyser.getByteFrequencyData(data);

		// 取低频段平均值（人声主要在低频），映射到 0–1
		const lowFreqEnd = Math.min(32, data.length);
		let sum = 0;
		for (let i = 0; i < lowFreqEnd; i++) sum += data[i];
		const avg = sum / lowFreqEnd / 255;

		// 非线性映射，让口型更自然
		const mouthValue = Math.pow(avg, 0.6) * 1.5;
		this.emitMouth(Math.min(1, mouthValue));

		this.animFrameId = requestAnimationFrame(() => this.pumpMouthData());
	}

	private emitMouth(value: number) {
		for (const cb of this.mouthCallbacks) {
			try { cb(value); } catch { /* */ }
		}
	}

	private cleanup() {
		if (this.ctx) {
			try { this.ctx.close(); } catch { /* */ }
			this.ctx = null;
		}
		this.analyser = null;
	}
}
