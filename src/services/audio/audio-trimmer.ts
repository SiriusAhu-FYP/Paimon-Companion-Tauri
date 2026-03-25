/**
 * WAV 音频首尾静音裁剪。
 * 直接操作 WAV 二进制数据（不依赖 AudioContext 解码），
 * 裁掉首尾静音区域，保留少量保护边缘并施加线性 fade。
 */

import { createLogger } from "@/services/logger";

const log = createLogger("audio-trimmer");

export interface TrimOptions {
	/** 静音阈值（样本绝对值 / 最大值），默认 0.01 */
	threshold?: number;
	/** 保护边缘毫秒数，默认 30ms */
	marginMs?: number;
	/** fade in/out 毫秒数，默认 10ms */
	fadeMs?: number;
}

/**
 * 裁剪 WAV 音频首尾静音。
 * 如果输入不是有效 WAV 或无需裁剪，原样返回。
 */
export function trimSilence(audioData: ArrayBuffer, options?: TrimOptions): ArrayBuffer {
	const threshold = options?.threshold ?? 0.01;
	const marginMs = options?.marginMs ?? 30;
	const fadeMs = options?.fadeMs ?? 10;

	const view = new DataView(audioData);

	// 校验 WAV header
	if (audioData.byteLength < 44) return audioData;
	const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
	if (riff !== "RIFF") return audioData;

	const audioFormat = view.getUint16(20, true);
	if (audioFormat !== 1) return audioData; // 仅支持 PCM

	const channels = view.getUint16(22, true);
	const sampleRate = view.getUint32(24, true);
	const bitsPerSample = view.getUint16(34, true);

	if (bitsPerSample !== 16) return audioData; // 仅支持 16-bit

	// 找到 data chunk
	let dataOffset = 12;
	let dataSize = 0;
	while (dataOffset < audioData.byteLength - 8) {
		const chunkId = String.fromCharCode(
			view.getUint8(dataOffset),
			view.getUint8(dataOffset + 1),
			view.getUint8(dataOffset + 2),
			view.getUint8(dataOffset + 3),
		);
		const chunkSize = view.getUint32(dataOffset + 4, true);
		if (chunkId === "data") {
			dataOffset += 8;
			dataSize = chunkSize;
			break;
		}
		dataOffset += 8 + chunkSize;
	}

	if (dataSize === 0) return audioData;

	const bytesPerSample = bitsPerSample / 8;
	const bytesPerFrame = channels * bytesPerSample;
	const totalFrames = Math.floor(dataSize / bytesPerFrame);
	const maxVal = 32767; // 16-bit signed max

	// 扫描首部静音
	let startFrame = 0;
	for (let f = 0; f < totalFrames; f++) {
		let frameMax = 0;
		for (let c = 0; c < channels; c++) {
			const offset = dataOffset + f * bytesPerFrame + c * bytesPerSample;
			const sample = Math.abs(view.getInt16(offset, true)) / maxVal;
			if (sample > frameMax) frameMax = sample;
		}
		if (frameMax > threshold) {
			startFrame = f;
			break;
		}
	}

	// 扫描尾部静音
	let endFrame = totalFrames - 1;
	for (let f = totalFrames - 1; f >= startFrame; f--) {
		let frameMax = 0;
		for (let c = 0; c < channels; c++) {
			const offset = dataOffset + f * bytesPerFrame + c * bytesPerSample;
			const sample = Math.abs(view.getInt16(offset, true)) / maxVal;
			if (sample > frameMax) frameMax = sample;
		}
		if (frameMax > threshold) {
			endFrame = f;
			break;
		}
	}

	const leadingSilenceMs = (startFrame / sampleRate) * 1000;
	const trailingSilenceMs = ((totalFrames - 1 - endFrame) / sampleRate) * 1000;
	const totalMs = (totalFrames / sampleRate) * 1000;

	log.debug(
		`[trim] leading=${leadingSilenceMs.toFixed(0)}ms trailing=${trailingSilenceMs.toFixed(0)}ms ` +
		`total=${totalMs.toFixed(0)}ms`,
	);

	// 如果静音区域很小（< 2 * margin），不裁剪
	const minSilenceMs = marginMs * 2;
	if (leadingSilenceMs < minSilenceMs && trailingSilenceMs < minSilenceMs) {
		log.debug(`[trim] skip — silence below ${minSilenceMs}ms threshold`);
		return audioData;
	}

	// 计算裁剪范围（保留 margin）
	const marginFrames = Math.floor((marginMs / 1000) * sampleRate);
	const fadeFrames = Math.floor((fadeMs / 1000) * sampleRate);

	const trimStart = Math.max(0, startFrame - marginFrames);
	const trimEnd = Math.min(totalFrames - 1, endFrame + marginFrames);
	const trimmedFrames = trimEnd - trimStart + 1;
	const trimmedDataSize = trimmedFrames * bytesPerFrame;

	// 构建新 WAV
	const headerSize = dataOffset; // 保留原始 header 到 data chunk 开始
	const newBuffer = new ArrayBuffer(headerSize + trimmedDataSize);
	const newView = new DataView(newBuffer);
	const newBytes = new Uint8Array(newBuffer);
	const srcBytes = new Uint8Array(audioData);

	// 复制 header
	newBytes.set(srcBytes.slice(0, headerSize));

	// 更新 RIFF size
	newView.setUint32(4, newBuffer.byteLength - 8, true);

	// 更新 data chunk size
	newView.setUint32(headerSize - 4, trimmedDataSize, true);

	// 复制裁剪后的 PCM 数据
	const srcStart = dataOffset + trimStart * bytesPerFrame;
	newBytes.set(srcBytes.slice(srcStart, srcStart + trimmedDataSize), headerSize);

	// 施加 fade in
	const actualFadeIn = Math.min(fadeFrames, trimmedFrames);
	for (let f = 0; f < actualFadeIn; f++) {
		const gain = f / actualFadeIn;
		for (let c = 0; c < channels; c++) {
			const offset = headerSize + f * bytesPerFrame + c * bytesPerSample;
			const sample = newView.getInt16(offset, true);
			newView.setInt16(offset, Math.round(sample * gain), true);
		}
	}

	// 施加 fade out
	const actualFadeOut = Math.min(fadeFrames, trimmedFrames);
	for (let f = 0; f < actualFadeOut; f++) {
		const frameIdx = trimmedFrames - 1 - f;
		const gain = f / actualFadeOut;
		for (let c = 0; c < channels; c++) {
			const offset = headerSize + frameIdx * bytesPerFrame + c * bytesPerSample;
			const sample = newView.getInt16(offset, true);
			newView.setInt16(offset, Math.round(sample * gain), true);
		}
	}

	const removedMs = ((totalFrames - trimmedFrames) / sampleRate) * 1000;
	const trimmedMs = (trimmedFrames / sampleRate) * 1000;
	log.info(
		`[trim] removed ${removedMs.toFixed(0)}ms silence ` +
		`(${totalMs.toFixed(0)}ms -> ${trimmedMs.toFixed(0)}ms)`,
	);

	return newBuffer;
}
