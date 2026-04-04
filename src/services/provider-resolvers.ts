import type { AppConfig, ASRProviderConfig, TTSProviderConfig } from "./config";
import { BrowserNativeTTSService, MockTTSService, UnavailableTTSService } from "./tts";
import type { ITTSService } from "./tts/types";
import { MockLLMService, OpenAILLMService } from "./llm";
import type { ILLMService } from "./llm/types";
import {
	FasterWhisperLocalASRService,
	MockASRService,
	OpenAICompatibleASRService,
	UnavailableASRService,
} from "./asr";
import type { IASRService } from "./asr";
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
			voiceName: activeProfile.voiceName,
			speed: activeProfile.speed,
			textLang: activeProfile.textLang,
		}
		: config.tts;

	if (ttsConfig.provider === "mock") {
		log.info("using mock TTS provider");
		return new MockTTSService();
	}
	if (ttsConfig.provider === "browser-native") {
		log.info("using browser-native TTS provider");
		return new BrowserNativeTTSService(ttsConfig);
	}
	if (ttsConfig.provider === "volcengine") {
		log.info("configured Volcengine TTS provider");
		return new UnavailableTTSService("火山引擎 TTS");
	}
	if (ttsConfig.provider === "aliyun") {
		log.info("configured Aliyun TTS provider");
		return new UnavailableTTSService("阿里云 TTS");
	}

	log.info(`unknown TTS provider "${ttsConfig.provider}", using mock fallback`);
	return new MockTTSService();
}

export function resolveASRProvider(config: AppConfig): IASRService {
	const activeProfile = config.activeAsrProfileId
		? config.asrProfiles.find((profile) => profile.id === config.activeAsrProfileId)
		: null;

	const asrConfig: ASRProviderConfig = activeProfile
		? {
			provider: activeProfile.provider,
			baseUrl: activeProfile.baseUrl,
			model: activeProfile.model,
			language: activeProfile.language,
			autoDetectLanguage: activeProfile.autoDetectLanguage,
			modelSource: activeProfile.modelSource,
			modelPath: activeProfile.modelPath,
			downloadUrl: activeProfile.downloadUrl,
			vadEnabled: activeProfile.vadEnabled,
			vadAggressiveness: activeProfile.vadAggressiveness,
			silenceThresholdMs: activeProfile.silenceThresholdMs,
			minSpeechMs: activeProfile.minSpeechMs,
		}
		: config.asr;

	if (asrConfig.provider === "mock") {
		log.info("using mock ASR provider");
		return new MockASRService();
	}

	if (asrConfig.provider === "openai-compatible") {
		if (!asrConfig.baseUrl.trim()) {
			log.info("OpenAI-compatible ASR configured but baseUrl missing, using mock fallback");
			return new MockASRService();
		}
		log.info(`using OpenAI-compatible ASR provider: ${asrConfig.baseUrl}`);
		return new OpenAICompatibleASRService({
			baseUrl: asrConfig.baseUrl,
			model: asrConfig.model,
			language: asrConfig.language,
			autoDetectLanguage: asrConfig.autoDetectLanguage,
			secretKey: activeProfile ? `asr-api-key:${activeProfile.id}` : null,
		});
	}

	if (asrConfig.provider === "faster-whisper-local") {
		if (!asrConfig.baseUrl.trim()) {
			log.info("Faster-Whisper local configured but baseUrl missing, using mock fallback");
			return new MockASRService();
		}
		log.info(`using Faster-Whisper local ASR provider: ${asrConfig.baseUrl}`);
		return new FasterWhisperLocalASRService({
			baseUrl: asrConfig.baseUrl,
			model: asrConfig.model,
			language: asrConfig.language,
			autoDetectLanguage: asrConfig.autoDetectLanguage,
			vadEnabled: asrConfig.vadEnabled,
		});
	}

	const labelMap: Record<Exclude<ASRProviderConfig["provider"], "mock">, string> = {
		"openai-compatible": "OpenAI-compatible ASR",
		"faster-whisper-local": "Faster-Whisper local sidecar",
		volcengine: "Volcengine ASR",
		aliyun: "Aliyun ASR",
	};
	const label = labelMap[asrConfig.provider];
	log.info(`configured ASR provider: ${label}`);
	return new UnavailableASRService(label);
}
