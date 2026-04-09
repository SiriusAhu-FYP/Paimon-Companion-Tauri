import type { ITTSService, VoiceConfig } from "./types";
import type { TTSProviderConfig } from "@/services/config/types";
import { proxyRequest, proxyBinaryRequest } from "@/services/config/http-proxy";
import { createLogger } from "@/services/logger";

const log = createLogger("gptsovits-tts");

const LANG_ROUTE: Record<string, string> = {
	zh: "zh",
	en: "en",
	ja: "ja",
	jp: "ja",
	auto: "zh",
};

export class GptSovitsTTSService implements ITTSService {
	private config: TTSProviderConfig;
	private loadedWeights: { gpt: string; sovits: string } | null = null;

	constructor(config: TTSProviderConfig) {
		this.config = config;
	}

	async synthesize(text: string, config?: VoiceConfig): Promise<ArrayBuffer> {
		const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
		const rawLang = config?.lang || this.config.textLang || "zh";
		const textLang = LANG_ROUTE[rawLang.toLowerCase()];

		if (!textLang) {
			log.warn(`[lang] unsupported lang="${rawLang}" for text="${text.slice(0, 30)}..." — skipping synthesis`);
			return new ArrayBuffer(0);
		}

		await this.ensureWeightsLoaded(baseUrl);

		const params = new URLSearchParams({
			text,
			text_lang: textLang,
			ref_audio_path: this.config.refAudioPath,
			prompt_text: this.config.promptText,
			prompt_lang: this.config.promptLang || "zh",
		});

		const url = `${baseUrl}/tts?${params.toString()}`;
		const audioData = await proxyBinaryRequest({
			url,
			method: "GET",
			timeoutMs: 60000,
		});

		log.info(`[synth] ${text.length} chars -> ${audioData.byteLength} bytes`);
		return audioData;
	}

	private async ensureWeightsLoaded(baseUrl: string): Promise<void> {
		const gptPath = this.config.gptWeightsPath;
		const sovitsPath = this.config.sovitsWeightsPath;

		if (!gptPath || !sovitsPath) {
			throw new Error("GPT-SoVITS 权重路径未配置，请在设置中填写 GPT/SoVITS 权重路径");
		}

		if (
			this.loadedWeights
			&& this.loadedWeights.gpt === gptPath
			&& this.loadedWeights.sovits === sovitsPath
		) {
			return;
		}

		const gptResp = await proxyRequest({
			url: `${baseUrl}/set_gpt_weights?weights_path=${gptPath}`,
			method: "GET",
			timeoutMs: 30000,
		});
		if (gptResp.status >= 400) {
			throw new Error(`GPT 权重加载失败 (HTTP ${gptResp.status}): ${gptResp.body}`);
		}

		const sovitsResp = await proxyRequest({
			url: `${baseUrl}/set_sovits_weights?weights_path=${sovitsPath}`,
			method: "GET",
			timeoutMs: 30000,
		});
		if (sovitsResp.status >= 400) {
			throw new Error(`SoVITS 权重加载失败 (HTTP ${sovitsResp.status}): ${sovitsResp.body}`);
		}

		this.loadedWeights = { gpt: gptPath, sovits: sovitsPath };
	}
}
