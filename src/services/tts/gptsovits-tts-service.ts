import type { ITTSService, VoiceConfig } from "./types";
import type { TTSProviderConfig } from "@/services/config/types";
import { proxyRequest, proxyBinaryRequest } from "@/services/config/http-proxy";
import { createLogger } from "@/services/logger";

const log = createLogger("gptsovits-tts");

/**
 * GPT-SoVITS TTS 实现。
 * 三步流程：加载 GPT 权重 -> 加载 SoVITS 权重 -> 调用 /tts 合成。
 * 权重路径有变化时才重新加载，避免重复加载开销。
 */
export class GptSovitsTTSService implements ITTSService {
	private config: TTSProviderConfig;
	private loadedWeights: { gpt: string; sovits: string } | null = null;

	constructor(config: TTSProviderConfig) {
		this.config = config;
	}

	async synthesize(text: string, _config?: VoiceConfig): Promise<ArrayBuffer> {
		const baseUrl = this.config.baseUrl.replace(/\/+$/, "");

		await this.ensureWeightsLoaded(baseUrl);

		const textLang = this.config.textLang || "zh";

		const params = new URLSearchParams({
			text,
			text_lang: textLang,
			ref_audio_path: this.config.refAudioPath,
			prompt_text: this.config.promptText,
			prompt_lang: this.config.promptLang || "zh",
		});

		const url = `${baseUrl}/tts?${params.toString()}`;
		log.info(`synthesize: ${text.length} chars, lang=${textLang}`);

		const audioData = await proxyBinaryRequest({
			url,
			method: "GET",
			timeoutMs: 60000,
		});

		log.info(`synthesize done: ${audioData.byteLength} bytes`);
		return audioData;
	}

	private async ensureWeightsLoaded(baseUrl: string): Promise<void> {
		const gptPath = this.config.gptWeightsPath;
		const sovitsPath = this.config.sovitsWeightsPath;

		if (!gptPath || !sovitsPath) {
			throw new Error("GPT-SoVITS 权重路径未配置，请在设置中填写 GPT/SoVITS 权重路径");
		}

		if (
			this.loadedWeights &&
			this.loadedWeights.gpt === gptPath &&
			this.loadedWeights.sovits === sovitsPath
		) {
			return;
		}

		log.info(`loading GPT weights: ${gptPath}`);
		const gptResp = await proxyRequest({
			url: `${baseUrl}/set_gpt_weights?weights_path=${encodeURIComponent(gptPath)}`,
			method: "GET",
			timeoutMs: 30000,
		});
		if (gptResp.status >= 400) {
			throw new Error(`GPT 权重加载失败 (HTTP ${gptResp.status}): ${gptResp.body}`);
		}
		log.info("GPT weights loaded");

		log.info(`loading SoVITS weights: ${sovitsPath}`);
		const sovitsResp = await proxyRequest({
			url: `${baseUrl}/set_sovits_weights?weights_path=${encodeURIComponent(sovitsPath)}`,
			method: "GET",
			timeoutMs: 30000,
		});
		if (sovitsResp.status >= 400) {
			throw new Error(`SoVITS 权重加载失败 (HTTP ${sovitsResp.status}): ${sovitsResp.body}`);
		}
		log.info("SoVITS weights loaded");

		this.loadedWeights = { gpt: gptPath, sovits: sovitsPath };
	}
}
