/**
 * M2.1 语音链路实验脚本
 *
 * 用法（需要 Node.js 18+）：
 *   node scripts/m2-1-gptsovits-experiment.js
 *
 * 前置条件：
 *   1. GPT-SoVITS 服务运行中（默认 http://localhost:9880）
 *   2. 权重路径、参考音频路径配置正确（见下方 CONFIG）
 *
 * 输出：
 *   samples/ 目录下的原始 WAV 和裁剪后 WAV
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============== CONFIG ==============
// ⚠️ 需要根据实际环境修改以下配置
const CONFIG = {
	baseUrl: "http://localhost:9880",
	//  GPT 权重路径（GPT-SoVITS 服务端路径）
	gptWeightsPath: "",
	//  SoVITS 权重路径（GPT-SoVITS 服务端路径）
	sovitsWeightsPath: "",
	//  参考音频路径（GPT-SoVITS 服务端路径）
	refAudioPath: "",
	//  参考音频文本
	promptText: "",
	//  参考音频语言
	promptLang: "zh",
	//  超时（毫秒）
	timeout: 60000,
};

// ============== SAMPLES ==============
const SAMPLES = [
	{ id: "A1", text: "你好", lang: "zh", note: "中文短句" },
	{ id: "A2", text: "今天天气真好，我们一起去公园散步吧。", lang: "zh", note: "中文长句" },
	{ id: "A3", text: "Hello, how are you today.", lang: "en", note: "英文句子" },
	{ id: "A4", text: "你好hello世界world", lang: "mixed", note: "中英混合" },
	{ id: "A5", text: "안녕하세요", lang: "ko", note: "韩文（验证 fallback）" },
	{ id: "A6", text: "Bonjour, comment allez-vous?", lang: "fr", note: "法文（验证 fallback）" },
];

// ============== HELPERS ==============
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "dev-reports", "phase3", "m2-1-silence-validation", "samples");

async function fetch(url, options = {}) {
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
	const resp = await fetch(url);
	const text = await resp.text();
	return { status: resp.status, body: text };
}

async function apiGetBinary(path) {
	const url = `${CONFIG.baseUrl}${path}`;
	const resp = await fetch(url);
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

function trimSilence(arrayBuffer) {
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
	const threshold = 0.01;

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

	return { trimmed: trimFrames(arrayBuffer, dataOffset, startFrame, endFrame, bytesPerFrame, channels, bitsPerSample, sampleRate, dataSize), leadingMs, trailingMs, totalMs };
}

function trimFrames(srcBuffer, dataOffset, startFrame, endFrame, bytesPerFrame, channels, bitsPerSample, sampleRate, dataSize) {
	const marginFrames = Math.floor((10 / 1000) * sampleRate); // 10ms margin
	const trimStart = Math.max(0, startFrame - marginFrames);
	const trimEnd = Math.min(totalFrames - 1, endFrame + marginFrames);
	const trimmedFrames = trimEnd - trimStart + 1;

	const headerSize = dataOffset;
	const trimmedDataSize = trimmedFrames * bytesPerFrame;
	const newBuffer = new ArrayBuffer(headerSize + trimmedDataSize);
	const srcBytes = new Uint8Array(srcBuffer);
	const dstBytes = new Uint8Array(newBuffer);

	dstBytes.set(srcBytes.slice(0, headerSize));
	const srcStart = dataOffset + trimStart * bytesPerFrame;
	dstBytes.set(srcBytes.slice(srcStart, srcStart + trimmedDataSize), headerSize);

	// 更新 RIFF size
	const dstView = new DataView(newBuffer);
	dstView.setUint32(4, newBuffer.byteLength - 8, true);
	dstView.setUint32(headerSize - 4, trimmedDataSize, true);

	return newBuffer;
}

// ============== MAIN ==============
async function main() {
	console.log("=== M2.1 GPT-SoVITS 实验 ===\n");
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

	for (const sample of SAMPLES) {
		console.log(`\n  --- 样本 ${sample.id}: ${sample.note} ---`);
		console.log(`  文本: "${sample.text}"`);
		console.log(`  语言标签: ${sample.lang}`);

		// 映射语言标签
		const unsupported = ["ko", "fr", "ja"];
		const textLang = unsupported.includes(sample.lang) ? "UNSUPPORTED" : sample.lang;
		if (textLang === "UNSUPPORTED") {
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

			// 裁剪
			const trimResult = trimSilence(rawBuf);
			if (trimResult && typeof trimResult === "object" && trimResult.trimmed) {
				const trimName = `${sample.id}_trimmed_${sample.lang}.wav`;
				saveWav(trimName, trimResult.trimmed, "TRIM");
				results.push({
					...sample,
					synthMs: synthMs.toFixed(0),
					rawDurationMs: durationMs.toFixed(0),
					trimmedDurationMs: (trimResult.trimmed.byteLength / (bits / 8 * ch) / sr * 1000).toFixed(0),
					leadingMs: trimResult.leadingMs.toFixed(0),
					trailingMs: trimResult.trailingMs.toFixed(0),
					error: null,
				});
			} else {
				// trimSilence returned the original buffer directly
				const trimName = `${sample.id}_trimmed_${sample.lang}.wav`;
				saveWav(trimName, rawBuf, "TRIM");
				results.push({
					...sample,
					synthMs: synthMs.toFixed(0),
					rawDurationMs: durationMs.toFixed(0),
					trimmedDurationMs: durationMs.toFixed(0),
					leadingMs: "N/A",
					trailingMs: "N/A",
					error: null,
				});
			}
		} else {
			results.push({ ...sample, synthMs: synthMs.toFixed(0), error });
		}
	}

	// 输出汇总
	console.log("\n\n[4] 实验结果汇总");
	console.log("=".repeat(80));
	console.log(`${"ID".padEnd(4)} ${"文本".padEnd(20)} ${"lang".padEnd(8)} ${"合成ms".padEnd(8)} ${"原始ms".padEnd(8)} ${"裁剪ms".padEnd(8)} ${"前导ms".padEnd(8)} ${"尾部ms".padEnd(8)} ${"错误".padEnd(15)}`);
	console.log("-".repeat(80));
	for (const r of results) {
		const text = r.text.slice(0, 18).padEnd(20);
		const err = (r.error ? r.error.slice(0, 13) : "-").padEnd(15);
		console.log(
			`${r.id.padEnd(4)} ${text} ${r.lang.padEnd(8)} ${(r.synthMs + "ms").padEnd(8)} ` +
			`${((r.rawDurationMs ?? "-") + "ms").padEnd(8)} ${((r.trimmedDurationMs ?? "-") + "ms").padEnd(8)} ` +
			`${((r.leadingMs ?? "-") + "ms").padEnd(8)} ${((r.trailingMs ?? "-") + "ms").padEnd(8)} ${err}`
		);
	}

	// 保存 CSV
	const csvPath = join(OUT_DIR, "results.csv");
	const csv = [
		"id,text,lang,synth_ms,raw_duration_ms,trimmed_duration_ms,leading_ms,trailing_ms,error",
		...results.map(r =>
			`${r.id},"${r.text}",${r.lang},${r.synthMs},${r.rawDurationMs ?? ""},${r.trimmedDurationMs ?? ""},${r.leadingMs ?? ""},${r.trailingMs ?? ""},${r.error ?? ""}`
		),
	].join("\n");
	writeFileSync(csvPath, csv, "utf-8");
	console.log(`\nCSV 结果已保存: ${csvPath}`);

	console.log("\n✅ 实验完成！");
}

main().catch(e => { console.error(e); process.exit(1); });
