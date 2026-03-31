import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService, OpenAIEmbeddingService, CompatibleRerankService } from "./knowledge";
import { LLMService, MockLLMService, OpenAILLMService } from "./llm";
import type { ILLMService } from "./llm/types";
import { MockTTSService, GptSovitsTTSService } from "./tts";
import type { ITTSService } from "./tts/types";
import { AudioPlayer } from "./audio";
import { PipelineService } from "./pipeline";
import { createLogger } from "./logger";
import { getConfig } from "./config";
import type { AppConfig, TTSProviderConfig } from "./config";

const log = createLogger("services");

export interface ServiceContainer {
	bus: EventBus;
	runtime: RuntimeService;
	character: CharacterService;
	knowledge: KnowledgeService;
	llm: LLMService;
	player: AudioPlayer;
	pipeline: PipelineService;
}

let services: ServiceContainer | null = null;

function resolveLLMProvider(config: AppConfig): ILLMService {
	// 优先使用活跃 LLM Profile
	const activeProfile = config.activeLlmProfileId
		? config.llmProfiles.find((p) => p.id === config.activeLlmProfileId)
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

function resolveTTSProvider(config: AppConfig): ITTSService {
	// 优先使用活跃 TTS Profile
	const activeProfile = config.activeTtsProfileId
		? config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId)
		: null;

	const ttsCfg: TTSProviderConfig = activeProfile
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

	if (ttsCfg.provider === "mock") {
		log.info("using mock TTS provider");
		return new MockTTSService();
	}
	if (ttsCfg.provider === "gpt-sovits") {
		if (!ttsCfg.baseUrl) {
			log.info("GPT-SoVITS configured but baseUrl missing, using mock fallback");
			return new MockTTSService();
		}
		log.info(`using GPT-SoVITS TTS provider: ${ttsCfg.baseUrl}`);
		return new GptSovitsTTSService(ttsCfg);
	}
	log.info(`unknown TTS provider "${ttsCfg.provider}", using mock fallback`);
	return new MockTTSService();
}

export function initServices(): ServiceContainer {
	if (services) {
		log.warn("services already initialized, returning existing instance");
		return services;
	}

	const config = getConfig();

	const runtime = new RuntimeService(eventBus);
	const character = new CharacterService(eventBus);
	const knowledge = new KnowledgeService(eventBus);

	// Phase 3.5: 初始化 Embedding Service + Rerank Service + Knowledge
	const embProfile = resolveEmbeddingProfile(config);
	if (embProfile) {
		const embeddingService = new OpenAIEmbeddingService(
			{ baseUrl: embProfile.baseUrl, model: embProfile.model, dimension: embProfile.dimension },
			embProfile.id,
		);
		knowledge.setEmbeddingService(embeddingService);
	}
	const rerankProfile = resolveRerankProfile(config);
	if (rerankProfile) {
		const rerankService = new CompatibleRerankService(
			{ baseUrl: rerankProfile.baseUrl, model: rerankProfile.model },
			rerankProfile.id,
		);
		knowledge.setRerankService(rerankService);
	}
	knowledge.initialize().catch((err) => {
		log.error("knowledge initialization failed", err);
	});

	const llmProvider = resolveLLMProvider(config);
	const llm = new LLMService(eventBus, runtime, llmProvider, character, knowledge);
	const ttsProvider = resolveTTSProvider(config);
	const player = new AudioPlayer();

	const pipeline = new PipelineService({
		bus: eventBus,
		runtime,
		character,
		llm,
		tts: ttsProvider,
		player,
	});

	services = {
		bus: eventBus,
		runtime,
		character,
		knowledge,
		llm,
		player,
		pipeline,
	};

	log.info("all services initialized", {
		llmProvider: config.llm.provider,
		ttsProvider: config.tts.provider,
	});
	return services;
}

export function getServices(): ServiceContainer {
	if (!services) {
		throw new Error("services not initialized — call initServices() first");
	}
	return services;
}

/**
 * 根据当前 config 中的 activeLlmProfileId / activeTtsProfileId 热更新 providers。
 * Settings 切换 profile 后调用此函数，使新 profile 立即生效。
 */
export function refreshProviders() {
	if (!services) {
		log.warn("refreshProviders called before initServices, skipping");
		return;
	}
	const config = getConfig();

	const newLLMProvider = resolveLLMProvider(config);
	const newTTSProvider = resolveTTSProvider(config);

	services.llm.setProvider(newLLMProvider);

	const sq = services.pipeline.getSpeechQueue();
	sq.setTTS(newTTSProvider);

	log.info("providers refreshed", {
		llmProvider: config.llm.provider,
		ttsProvider: config.tts.provider,
	});
}

function resolveEmbeddingProfile(config: AppConfig) {
	const activeProfile = config.knowledge.activeEmbeddingProfileId
		? config.knowledge.embeddingProfiles.find((p) => p.id === config.knowledge.activeEmbeddingProfileId)
		: null;
	if (activeProfile && activeProfile.baseUrl && activeProfile.model) {
		return activeProfile;
	}
	// fallback to inline embedding config (legacy)
	if (config.knowledge.embedding.baseUrl && config.knowledge.embedding.model) {
		return { id: "__inline__", ...config.knowledge.embedding };
	}
	return null;
}

function resolveRerankProfile(config: AppConfig) {
	if (!config.knowledge.rerankEnabled) return null;
	const activeProfile = config.knowledge.activeRerankProfileId
		? config.knowledge.rerankProfiles.find((p) => p.id === config.knowledge.activeRerankProfileId)
		: null;
	if (activeProfile && activeProfile.baseUrl && activeProfile.model) {
		return activeProfile;
	}
	// fallback to inline rerank config
	if (config.knowledge.rerank.baseUrl && config.knowledge.rerank.model) {
		return { id: "__inline_rerank__", name: "inline", ...config.knowledge.rerank };
	}
	return null;
}

/**
 * Embedding / Rerank profile 变更后调用——重建对应 service + 重新初始化知识库。
 */
export async function refreshEmbeddingService() {
	if (!services) {
		log.warn("refreshEmbeddingService called before initServices, skipping");
		return;
	}
	const config = getConfig();

	// 刷新 embedding（无档案时清理旧 service，保持配置一致性）
	const embProfile = resolveEmbeddingProfile(config);
	if (embProfile) {
		const embeddingService = new OpenAIEmbeddingService(
			{ baseUrl: embProfile.baseUrl, model: embProfile.model, dimension: embProfile.dimension },
			embProfile.id,
		);
		services.knowledge.setEmbeddingService(embeddingService);
	} else {
		services.knowledge.setEmbeddingService(null);
	}

	// 刷新 rerank
	const rerankProfile = resolveRerankProfile(config);
	if (rerankProfile) {
		const rerankService = new CompatibleRerankService(
			{ baseUrl: rerankProfile.baseUrl, model: rerankProfile.model },
			rerankProfile.id,
		);
		services.knowledge.setRerankService(rerankService);
	} else {
		services.knowledge.setRerankService(null);
	}

	await services.knowledge.reinitialize();
	log.info("knowledge providers refreshed", {
		embeddingProfileId: embProfile?.id ?? "none",
		embeddingModel: embProfile?.model ?? "none",
		rerankProfileId: rerankProfile?.id ?? "none",
		rerankModel: rerankProfile?.model ?? "none",
		rerankEnabled: config.knowledge.rerankEnabled,
	});
}

export { eventBus } from "./event-bus";
export { createLogger } from "./logger";
