/**
 * M2.2 裁切策略与听感判断实验脚本
 *
 * 用法（需要 Node.js 18+）：
 *   node scripts/m2-2-trim-audition.js
 *
 * 前置条件：
 *   1. GPT-SoVITS 服务运行中（默认 http://localhost:9880）
 *   2. 权重路径、参考音频路径配置正确（见下方 CONFIG）
 *
 * 输出：
 *   dev-reports/phase3/m2-2-trim-audition/samples/ 目录下的音频文件和数据
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============== CONFIG ==============
// ⚠️ 需要根据实际环境修改以下配置
const CONFIG = {
	baseUrl: "http://192.168.31.64:9880",
	//  GPT 权重路径（GPT-SoVITS 服务端路径）
	gptWeightsPath: "/home/ahu/fyp-tts/GPT-SoVITS-Inference/派蒙/派蒙-e10.ckpt",
	//  SoVITS 权重路径（GPT-SoVITS 服务端路径）
	sovitsWeightsPath: "/home/ahu/fyp-tts/GPT-SoVITS-Inference/派蒙/派蒙_e10_s19390.pth",
	//  参考音频路径（GPT-SoVITS 服务端路径）
	refAudioPath: "/home/ahu/fyp-tts/GPT-SoVITS-Inference/派蒙/平静-好耶！《特尔克西的奇幻历险》出发咯！.wav",
	//  参考音频文本
	promptText: "好耶！《特尔克西的奇幻历险》出发咯！",
	//  参考音频语言
	promptLang: "zh",
	//  超时（毫秒）
	timeout: 60000,
};

// ============== EXPERIMENT SAMPLES ==============
// 三句有语义连续性的话
const SAMPLES = [
	{ id: "S1", text: "你好，我是派蒙，你的旅行伙伴。", lang: "zh", note: "中文句子1" },
	{ id: "S2", text: "今天天气真好，我们一起去冒险吧！", lang: "zh", note: "中文句子2" },
	{ id: "S3", text: "我会一直陪在你身边，一起探索这个世界。", lang: "zh", note: "中文句子3" },
];

// ============== TRIM SETTINGS ==============
const TRIM_SETTINGS = {
	threshold: 0.01, // 静音阈值（样本绝对值 / 32767）
	marginFront: 10, // 前导保护边缘（ms）
	marginTail: 20,  // 尾部保护边缘（ms）
	marginFrontLight: 20, // 前导轻裁保护边缘（ms）
	marginTailHeavy: 10,  // 尾部重裁保护边缘（ms）
};

// ============== HELPERS ==============
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "dev-reports", "phase3", "m2-2-trim-audition", "samples");

async function fetchWithTimeout(url, options = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CONFIG.timeout);
	try {
		const resp = await fetch(url, { signal: controller.signal, ...options });
		return resp;
	} finally {
		clearTimeout(timer);
	}
}

async function apiGet(path) {
	const url = `${CONFIG.baseUrl}${path}`;
	const resp = await fetchWithTimeout(url);
	const text = await resp.text();
	return { status: resp.status, body: text };
}

async function apiGetBinary(path) {
	const url = `${CONFIG.baseUrl}${path}`;
	const resp = await fetchWithTimeout(url);
	const buf = await resp.arrayBuffer();
	return { status: resp.status, data: buf };
}

function saveWav(filename, arrayBuffer, label) {
	mkdirSync(OUT_DIR, { recursive: true });
	const fullPath = join(OUT_DIR, filename);
	writeFileSync(fullPath, Buffer.from(arrayBuffer));
	console.log(`  [${label}] saved: ${filename} (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);
	return fullPath;
}

function saveJson(filename, data) {
	mkdirSync(OUT_DIR, { recursive: true });
	const fullPath = join(OUT_DIR, filename);
	writeFileSync(fullPath, JSON.stringify(data, null, 2));
	console.log(`  [JSON] saved: ${filename}`);
	return fullPath;
}

function trimSilence(arrayBuffer, frontMargin = 0, tailMargin = 0) {
	// 简单的静音裁剪：找到首尾非静音区域
	const view = new DataView(arrayBuffer);
	if (arrayBuffer.byteLength < 44) return arrayBuffer;

	const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
	if (riff !== "RIFF") return arrayBuffer;

	const channels = view.getUint16(22, true);
	const sampleRate = view.getUint32(24, true);
	const bitsPerSample = view.getUint16(34, true);
	if (bitsPerSample !== 16) return arrayBuffer;

	// 找 data chunk
	let dataOffset = 12;
	let dataSize = 0;
	while (dataOffset < arrayBuffer.byteLength - 8) {
		const chunkId = String.fromCharCode(
			view.getUint8(dataOffset), view.getUint8(dataOffset + 1),
			view.getUint8(dataOffset + 2), view.getUint8(dataOffset + 3),
		);
		const chunkSize = view.getUint32(dataOffset + 4, true);
		if (chunkId === "data") { dataOffset += 8; dataSize = chunkSize; break; }
		dataOffset += 8 + chunkSize;
	}
	if (dataSize === 0) return arrayBuffer;

	const bytesPerSample = bitsPerSample / 8;
	const bytesPerFrame = channels * bytesPerSample;
	const totalFrames = Math.floor(dataSize / bytesPerFrame);
	const maxVal = 32767;
	const threshold = TRIM_SETTINGS.threshold;

	// 扫首部
	let startFrame = 0;
	for (let f = 0; f < totalFrames; f++) {
		let frameMax = 0;
		for (let c = 0; c < channels; c++) {
			const s = Math.abs(view.getInt16(dataOffset + f * bytesPerFrame + c * bytesPerSample, true)) / maxVal;
			if (s > frameMax) frameMax = s;
		}
		if (frameMax > threshold) { startFrame = f; break; }
	}

	// 扫尾部
	let endFrame = totalFrames - 1;
	for (let f = totalFrames - 1; f >= startFrame; f--) {
		let frameMax = 0;
		for (let c = 0; c < channels; c++) {
			const s = Math.abs(view.getInt16(dataOffset + f * bytesPerFrame + c * bytesPerSample, true)) / maxVal;
			if (s > frameMax) frameMax = s;
		}
		if (frameMax > threshold) { endFrame = f; break; }
	}

	const leadingMs = (startFrame / sampleRate) * 1000;
	const trailingMs = ((totalFrames - 1 - endFrame) / sampleRate) * 1000;
	const totalMs = (totalFrames / sampleRate) * 1000;

	// 应用保护边缘
	const marginFramesFront = Math.floor((frontMargin / 1000) * sampleRate);
	const marginFramesTail = Math.floor((tailMargin / 1000) * sampleRate);
	const trimStart = Math.max(0, startFrame - marginFramesFront);
	const trimEnd = Math.min(totalFrames - 1, endFrame + marginFramesTail);
	const trimmedFrames = trimEnd - trimStart + 1;

	const headerSize = dataOffset;
	const trimmedDataSize = trimmedFrames * bytesPerFrame;
	const newBuffer = new ArrayBuffer(headerSize + trimmedDataSize);
	const srcBytes = new Uint8Array(arrayBuffer);
	const dstBytes = new Uint8Array(newBuffer);

	dstBytes.set(srcBytes.slice(0, headerSize));
	const srcStart = dataOffset + trimStart * bytesPerFrame;
	dstBytes.set(srcBytes.slice(srcStart, srcStart + trimmedDataSize), headerSize);

	// 更新 RIFF size
	const dstView = new DataView(newBuffer);
	dstView.setUint32(4, newBuffer.byteLength - 8, true);
	dstView.setUint32(headerSize - 4, trimmedDataSize, true);

	return {
		trimmed: newBuffer,
		leadingMs: leadingMs.toFixed(0),
		trailingMs: trailingMs.toFixed(0),
		totalMs: totalMs.toFixed(0),
		trimmedMs: ((trimmedFrames / sampleRate) * 1000).toFixed(0),
		trimRatio: ((trimmedFrames / totalFrames) * 100).toFixed(1),
	};
}

function concatenateWavs(buffers) {
	if (buffers.length === 0) return null;

	// 检查所有音频参数是否一致
	const view0 = new DataView(buffers[0]);
	const channels = view0.getUint16(22, true);
	const sampleRate = view0.getUint32(24, true);
	const bitsPerSample = view0.getUint16(34, true);

	// 计算总数据大小
	let totalDataSize = 0;
	const dataOffsets = [];

	for (const buffer of buffers) {
		const view = new DataView(buffer);
		// 找 data chunk
		let dataOffset = 12;
		let dataSize = 0;
		while (dataOffset < buffer.byteLength - 8) {
			const chunkId = String.fromCharCode(
				view.getUint8(dataOffset), view.getUint8(dataOffset + 1),
				view.getUint8(dataOffset + 2), view.getUint8(dataOffset + 3),
			);
			const chunkSize = view.getUint32(dataOffset + 4, true);
			if (chunkId === "data") { dataOffset += 8; dataSize = chunkSize; break; }
			dataOffset += 8 + chunkSize;
		}
		totalDataSize += dataSize;
		dataOffsets.push({ offset: dataOffset, size: dataSize });
	}

	// 创建新的 WAV 文件
	const headerSize = 44; // 标准 WAV 头
	const newBuffer = new ArrayBuffer(headerSize + totalDataSize);
	const dstBytes = new Uint8Array(newBuffer);

	// 复制头信息（使用第一个文件的头）
	const srcBytes0 = new Uint8Array(buffers[0]);
	dstBytes.set(srcBytes0.slice(0, headerSize));

	// 更新数据大小和文件大小
	const dstView = new DataView(newBuffer);
	dstView.setUint32(4, newBuffer.byteLength - 8, true);
	dstView.setUint32(40, totalDataSize, true);

	// 复制数据
	let currentOffset = headerSize;
	for (let i = 0; i < buffers.length; i++) {
		const buffer = buffers[i];
		const { offset, size } = dataOffsets[i];
		const srcBytes = new Uint8Array(buffer);
		dstBytes.set(srcBytes.slice(offset, offset + size), currentOffset);
		currentOffset += size;
	}

	return newBuffer;
}

// ============== MAIN ==============
async function main() {
	console.log("=== M2.2 裁切策略与听感判断实验 ===\n");
	console.log(`GPT-SoVITS: ${CONFIG.baseUrl}`);
	console.log(`输出目录: ${OUT_DIR}\n`);

	mkdirSync(OUT_DIR, { recursive: true });

	// 检查服务
	console.log("[1] 检查服务连通性...");
	try {
		const r = await apiGet("/");
		console.log(`  服务状态: HTTP ${r.status} (根路径 — 可能返回 404 但说明服务在线)`);
	} catch (e) {
		console.error(`  无法连接 GPT-SoVITS (${CONFIG.baseUrl}): ${e.message}`);
		console.error("  请确认：1) GPT-SoVITS 服务已启动  2) CONFIG 中的路径正确");
		process.exit(1);
	}

	// 加载权重
	console.log("\n[2] 加载权重...");
	if (!CONFIG.gptWeightsPath || !CONFIG.sovitsWeightsPath) {
		console.warn("  ⚠️ 权重路径未配置，跳过权重加载（假设已加载）");
	} else {
		try {
			const g = await apiGet(`/set_gpt_weights?weights_path=${encodeURIComponent(CONFIG.gptWeightsPath)}`);
			console.log(`  GPT 权重: HTTP ${g.status}`);
			const s = await apiGet(`/set_sovits_weights?weights_path=${encodeURIComponent(CONFIG.sovitsWeightsPath)}`);
			console.log(`  SoVITS 权重: HTTP ${s.status}`);
		} catch (e) {
			console.error(`  权重加载失败: ${e.message}`);
		}
	}

	// 合成样本
	console.log("\n[3] 合成样本...");
	const results = [];
	const rawBuffers = [];

	for (const sample of SAMPLES) {
		console.log(`\n  --- 样本 ${sample.id}: ${sample.note} ---`);
		console.log(`  文本: "${sample.text}"`);
		console.log(`  语言标签: ${sample.lang}`);

		// 映射语言标签
		const unsupported = ["ko", "fr"];
		let textLang = unsupported.includes(sample.lang) ? "UNSUPPORTED" : sample.lang;
		// 处理混合语言
		if (sample.lang === "mixed") {
			textLang = "zh";
			console.log(`  ⚠️ 混合语言将使用中文模型处理`);
		} else if (textLang === "UNSUPPORTED") {
			console.log(`  ⚠️ 语言 ${sample.lang} 不被 GPT-SoVITS 支持，将用 fallback`);
		}

		const params = new URLSearchParams({
			text: sample.text,
			text_lang: textLang === "UNSUPPORTED" ? "zh" : textLang,
			ref_audio_path: CONFIG.refAudioPath,
			prompt_text: CONFIG.promptText,
			prompt_lang: CONFIG.promptLang,
		});

		const t0 = performance.now();
		let rawBuf = null;
		let error = null;

		try {
			const resp = await apiGetBinary(`/tts?${params.toString()}`);
			if (resp.status === 200) {
				rawBuf = resp.data;
				console.log(`  合成成功: ${(resp.data.byteLength / 1024).toFixed(1)} KB`);
			} else {
				error = `HTTP ${resp.status}: ${resp.body?.slice(0, 100)}`;
				console.error(`  合成失败: ${error}`);
			}
		} catch (e) {
			error = e.message;
			console.error(`  合成异常: ${error}`);
		}

		const synthMs = performance.now() - t0;

		if (rawBuf) {
			// 解析音频信息
			const view = new DataView(rawBuf);
			const sr = view.getUint32(24, true);
			const ch = view.getUint16(22, true);
			const bits = view.getUint16(34, true);
			const dataSize = view.getUint32(40, true);
			const frames = Math.floor(dataSize / (bits / 8 * ch));
			const durationMs = (frames / sr) * 1000;

			console.log(`  音频: ${sr}Hz, ${ch}ch, ${bits}bit, ${durationMs.toFixed(0)}ms`);

			// 保存原始
			const rawName = `${sample.id}_raw_${sample.lang}.wav`;
			saveWav(rawName, rawBuf, "RAW");
			rawBuffers.push(rawBuf);

			// 方案 B：裁切首尾
			const trimBothResult = trimSilence(rawBuf, TRIM_SETTINGS.marginFront, TRIM_SETTINGS.marginTail);
			const trimBothName = `${sample.id}_trim_both_${sample.lang}.wav`;
			saveWav(trimBothName, trimBothResult.trimmed, "TRIM_BOTH");

			// 方案 C：只裁切尾部
			const trimTailResult = trimSilence(rawBuf, 0, TRIM_SETTINGS.marginTail);
			const trimTailName = `${sample.id}_trim_tail_${sample.lang}.wav`;
			saveWav(trimTailName, trimTailResult.trimmed, "TRIM_TAIL");

			// 方案 D：前导轻裁 + 尾部重裁
			const trimFrontLightTailHeavyResult = trimSilence(rawBuf, TRIM_SETTINGS.marginFrontLight, TRIM_SETTINGS.marginTailHeavy);
			const trimFrontLightTailHeavyName = `${sample.id}_trim_front_light_tail_heavy_${sample.lang}.wav`;
			saveWav(trimFrontLightTailHeavyName, trimFrontLightTailHeavyResult.trimmed, "TRIM_FRONT_LIGHT_TAIL_HEAVY");

			results.push({
				...sample,
				synthMs: synthMs.toFixed(0),
				rawDurationMs: durationMs.toFixed(0),
				trimBoth: {
					durationMs: trimBothResult.trimmedMs,
					leadingMs: trimBothResult.leadingMs,
					trailingMs: trimBothResult.trailingMs,
					trimRatio: trimBothResult.trimRatio,
				},
				trimTail: {
					durationMs: trimTailResult.trimmedMs,
					leadingMs: trimTailResult.leadingMs,
					trailingMs: trimTailResult.trailingMs,
					trimRatio: trimTailResult.trimRatio,
				},
				trimFrontLightTailHeavy: {
					durationMs: trimFrontLightTailHeavyResult.trimmedMs,
					leadingMs: trimFrontLightTailHeavyResult.leadingMs,
					trailingMs: trimFrontLightTailHeavyResult.trailingMs,
					trimRatio: trimFrontLightTailHeavyResult.trimRatio,
				},
				error: null,
			});
		} else {
			results.push({ ...sample, synthMs: synthMs.toFixed(0), error });
		}
	}

	// 生成拼接音频
	console.log("\n[4] 生成拼接音频...");

	// 方案 A：不裁切
	const concatRaw = concatenateWavs(rawBuffers);
	if (concatRaw) {
		saveWav("concat_raw.wav", concatRaw, "CONCAT_RAW");
	}

	// 方案 B：裁切首尾
	const trimBothBuffers = results.map(r => {
		const view = new DataView(rawBuffers[results.indexOf(r)]);
		const trimResult = trimSilence(rawBuffers[results.indexOf(r)], TRIM_SETTINGS.marginFront, TRIM_SETTINGS.marginTail);
		return trimResult.trimmed;
	});
	const concatTrimBoth = concatenateWavs(trimBothBuffers);
	if (concatTrimBoth) {
		saveWav("concat_trim_both.wav", concatTrimBoth, "CONCAT_TRIM_BOTH");
	}

	// 方案 C：只裁切尾部
	const trimTailBuffers = results.map(r => {
		const view = new DataView(rawBuffers[results.indexOf(r)]);
		const trimResult = trimSilence(rawBuffers[results.indexOf(r)], 0, TRIM_SETTINGS.marginTail);
		return trimResult.trimmed;
	});
	const concatTrimTailOnly = concatenateWavs(trimTailBuffers);
	if (concatTrimTailOnly) {
		saveWav("concat_trim_tail_only.wav", concatTrimTailOnly, "CONCAT_TRIM_TAIL_ONLY");
	}

	// 方案 D：前导轻裁 + 尾部重裁
	const trimFrontLightTailHeavyBuffers = results.map(r => {
		const view = new DataView(rawBuffers[results.indexOf(r)]);
		const trimResult = trimSilence(rawBuffers[results.indexOf(r)], TRIM_SETTINGS.marginFrontLight, TRIM_SETTINGS.marginTailHeavy);
		return trimResult.trimmed;
	});
	const concatTrimFrontLightTailHeavy = concatenateWavs(trimFrontLightTailHeavyBuffers);
	if (concatTrimFrontLightTailHeavy) {
		saveWav("concat_trim_front_light_tail_heavy.wav", concatTrimFrontLightTailHeavy, "CONCAT_TRIM_FRONT_LIGHT_TAIL_HEAVY");
	}

	// 计算拼接总时长
	function getDuration(buffer) {
		const view = new DataView(buffer);
		const sr = view.getUint32(24, true);
		const ch = view.getUint16(22, true);
		const bits = view.getUint16(34, true);
		const dataSize = view.getUint32(40, true);
		const frames = Math.floor(dataSize / (bits / 8 * ch));
		return (frames / sr) * 1000;
	}

	const concatDurations = {
		raw: concatRaw ? getDuration(concatRaw).toFixed(0) : "N/A",
		trimBoth: concatTrimBoth ? getDuration(concatTrimBoth).toFixed(0) : "N/A",
		trimTailOnly: concatTrimTailOnly ? getDuration(concatTrimTailOnly).toFixed(0) : "N/A",
		trimFrontLightTailHeavy: concatTrimFrontLightTailHeavy ? getDuration(concatTrimFrontLightTailHeavy).toFixed(0) : "N/A",
	};

	// 保存结果
	console.log("\n[5] 保存实验结果...");
	const experimentResults = {
		samples: results,
		concatDurations,
		trimSettings: TRIM_SETTINGS,
		timestamp: new Date().toISOString(),
	};

	saveJson("experiment_results.json", experimentResults);

	// 输出汇总
	console.log("\n\n[6] 实验结果汇总");
	console.log("=".repeat(80));
	console.log(`样本总数: ${results.length}`);
	console.log(`\n拼接音频总时长:`);
	console.log(`  原始: ${concatDurations.raw}ms`);
	console.log(`  裁切首尾: ${concatDurations.trimBoth}ms`);
	console.log(`  只裁尾部: ${concatDurations.trimTailOnly}ms`);
	console.log(`  前导轻裁+尾部重裁: ${concatDurations.trimFrontLightTailHeavy}ms`);

	console.log(`\n\n[7] 裁切设置`);
	console.log("=".repeat(80));
	console.log(`静音阈值: ${TRIM_SETTINGS.threshold}`);
	console.log(`前导保护边缘: ${TRIM_SETTINGS.marginFront}ms`);
	console.log(`尾部保护边缘: ${TRIM_SETTINGS.marginTail}ms`);
	console.log(`前导轻裁保护边缘: ${TRIM_SETTINGS.marginFrontLight}ms`);
	console.log(`尾部重裁保护边缘: ${TRIM_SETTINGS.marginTailHeavy}ms`);

	console.log("\n✅ 实验完成！");
}

main().catch(e => { console.error(e); process.exit(1); });
