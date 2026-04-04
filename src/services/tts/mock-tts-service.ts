import type { VoiceConfig, ITTSService } from "./types";
import { createLogger } from "@/services/logger";

const log = createLogger("mock-tts");

/**
 * Mock TTS 服务：生成带音量包络的正弦波测试音，用于验证口型同步通道。
 * 产出 WAV 格式 ArrayBuffer。
 */
export class MockTTSService implements ITTSService {
	async synthesize(text: string, _config?: VoiceConfig): Promise<ArrayBuffer> {
		// 根据文本长度模拟合成延迟
		const delayMs = 200 + text.length * 15;
		await new Promise((r) => setTimeout(r, delayMs));

		// 生成 1–3 秒的正弦波 WAV，时长与文本长度相关
		const durationSec = Math.min(3, Math.max(1, text.length * 0.08));
		const wav = generateSineWav(440, durationSec, 0.3);

		log.info(`synthesized ${text.length} chars → ${durationSec.toFixed(1)}s audio`);
		return wav;
	}
}

/** 生成带音量包络的正弦波 WAV（模拟说话节奏） */
function generateSineWav(freq: number, durationSec: number, volume: number): ArrayBuffer {
	const sampleRate = 22050;
	const numSamples = Math.floor(sampleRate * durationSec);
	const headerSize = 44;
	const dataSize = numSamples * 2;
	const buffer = new ArrayBuffer(headerSize + dataSize);
	const view = new DataView(buffer);

	// WAV header
	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	// 带包络的正弦波——模拟说话时的音量起伏
	for (let i = 0; i < numSamples; i++) {
		const t = i / sampleRate;
		const progress = i / numSamples;

		// 正弦波基音
		const sine = Math.sin(2 * Math.PI * freq * t);

		// 音量包络：渐入渐出 + 说话节奏波动
		const fadeIn = Math.min(1, progress * 10);
		const fadeOut = Math.min(1, (1 - progress) * 10);
		const rhythm = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t); // ~3Hz 节奏

		const envelope = fadeIn * fadeOut * rhythm * volume;
		const sample = Math.max(-1, Math.min(1, sine * envelope));

		view.setInt16(headerSize + i * 2, sample * 32767, true);
	}

	return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
