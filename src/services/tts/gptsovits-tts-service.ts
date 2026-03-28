import type { ITTSService, VoiceConfig } from "./types";
import type { TTSProviderConfig } from "@/services/config/types";
import { proxyRequest, proxyBinaryRequest } from "@/services/config/http-proxy";
import { createLogger } from "@/services/logger";

const log = createLogger("gptsovits-tts");

/**
 * GPT-SoVITS 语言路由表。
 * 正式支持 zh / en / ja，其余语言视为 unsupported。
 * auto 保守回退到 zh（GPT-SoVITS 部分版本不支持 auto）。
 */
const LANG_ROUTE: Record<string, string> = {
	zh: "zh",
	en: "en",
	ja: "ja",
	jp: "ja", // 兼容 jp 标签
	auto: "zh",
};

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

	async synthesize(text: string, config?: VoiceConfig): Promise<ArrayBuffer> {
		const baseUrl = this.config.baseUrl.replace(/\/+$/, "");

		const rawLang = config?.lang || this.config.textLang || "zh";
		const textLang = LANG_ROUTE[rawLang.toLowerCase()];

		if (!textLang) {
			log.warn(`[lang] unsupported lang="${rawLang}" for text="${text.slice(0, 30)}..." — skipping synthesis`);
			return new ArrayBuffer(0);
		}

		log.debug(`[lang] synthesize: rawLang=${rawLang}, textLang=${textLang}, text="${text.slice(0, 40)}..."`);

		await this.ensureWeightsLoaded(baseUrl);

		const params = new URLSearchParams({
			text,
			text_lang: textLang,
			ref_audio_path: this.config.refAudioPath,
			prompt_text: this.config.promptText,
			prompt_lang: this.config.promptLang || "zh",
		});

		const url = `${baseUrl}/tts?${params.toString()}`;
		log.info(`[synth] ${text.length} chars, lang=${textLang}`);

		const audioData = await proxyBinaryRequest({
			url,
			method: "GET",
			timeoutMs: 60000,
		});

		log.info(`[synth] done: ${audioData.byteLength} bytes`);
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
			url: `${baseUrl}/set_gpt_weights?weights_path=${gptPath}`,
			method: "GET",
			timeoutMs: 30000,
		});
		if (gptResp.status >= 400) {
			throw new Error(`GPT 权重加载失败 (HTTP ${gptResp.status}): ${gptResp.body}`);
		}
		log.info("GPT weights loaded");

		log.info(`loading SoVITS weights: ${sovitsPath}`);
		const sovitsResp = await proxyRequest({
			url: `${baseUrl}/set_sovits_weights?weights_path=${sovitsPath}`,
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
