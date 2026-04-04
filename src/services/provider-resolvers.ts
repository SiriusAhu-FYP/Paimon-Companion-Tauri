import type { AppConfig, TTSProviderConfig } from "./config";
import { GptSovitsTTSService, MockTTSService } from "./tts";
import type { ITTSService } from "./tts/types";
import { MockLLMService, OpenAILLMService } from "./llm";
import type { ILLMService } from "./llm/types";
import { createLogger } from "./logger";

const log = createLogger("providers");

export function resolveLLMProvider(config: AppConfig): ILLMService {
	const activeProfile = config.activeLlmProfileId
		? config.llmProfiles.find((profile) => profile.id === config.activeLlmProfileId)
		: null;

	const provider = activeProfile?.provider ?? config.llm.provider;
	const baseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
	const model = activeProfile?.model ?? config.llm.model;
	const temperature = activeProfile?.temperature ?? config.llm.temperature;
	const maxTokens = activeProfile?.maxTokens ?? config.llm.maxTokens;
	const profileId = activeProfile?.id ?? null;

	if (provider === "mock") {
		log.info("using mock LLM provider");
		return new MockLLMService();
	}
	if (provider === "openai-compatible") {
		if (!baseUrl || !model) {
			log.info("openai-compatible configured but baseUrl/model missing, using mock fallback");
			return new MockLLMService();
		}
		log.info(`using OpenAI-compatible LLM provider: ${baseUrl}, model=${model}`);
		return new OpenAILLMService(
			{ provider, baseUrl, model, temperature, maxTokens },
			profileId,
		);
	}

	log.info(`unknown LLM provider "${provider}", using mock fallback`);
	return new MockLLMService();
}

export function resolveTTSProvider(config: AppConfig): ITTSService {
	const activeProfile = config.activeTtsProfileId
		? config.ttsProfiles.find((profile) => profile.id === config.activeTtsProfileId)
		: null;

	const ttsConfig: TTSProviderConfig = activeProfile
		? {
			provider: activeProfile.provider,
			baseUrl: activeProfile.baseUrl,
			speakerId: activeProfile.speakerId,
			speed: activeProfile.speed,
			gptWeightsPath: activeProfile.gptWeightsPath,
			sovitsWeightsPath: activeProfile.sovitsWeightsPath,
			refAudioPath: activeProfile.refAudioPath,
			promptText: activeProfile.promptText,
			promptLang: activeProfile.promptLang,
			textLang: activeProfile.textLang,
		}
		: config.tts;

	if (ttsConfig.provider === "mock") {
		log.info("using mock TTS provider");
		return new MockTTSService();
	}
	if (ttsConfig.provider === "gpt-sovits") {
		if (!ttsConfig.baseUrl) {
			log.info("GPT-SoVITS configured but baseUrl missing, using mock fallback");
			return new MockTTSService();
		}
		log.info(`using GPT-SoVITS TTS provider: ${ttsConfig.baseUrl}`);
		return new GptSovitsTTSService(ttsConfig);
	}

	log.info(`unknown TTS provider "${ttsConfig.provider}", using mock fallback`);
	return new MockTTSService();
}
