import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService } from "./knowledge";
import { ExternalInputService } from "./external-input";
import { LLMService, MockLLMService, OpenAILLMService } from "./llm";
import type { ILLMService } from "./llm/types";
import { MockTTSService } from "./tts";
import type { ITTSService } from "./tts/types";
import { AudioPlayer } from "./audio";
import { PipelineService } from "./pipeline";
import { createLogger } from "./logger";
import { getConfig } from "./config";
import type { AppConfig } from "./config";

const log = createLogger("services");

export interface ServiceContainer {
	bus: EventBus;
	runtime: RuntimeService;
	character: CharacterService;
	knowledge: KnowledgeService;
	externalInput: ExternalInputService;
	llm: LLMService;
	player: AudioPlayer;
	pipeline: PipelineService;
}

let services: ServiceContainer | null = null;

function resolveLLMProvider(config: AppConfig): ILLMService {
	if (config.llm.provider === "mock") {
		log.info("using mock LLM provider");
		return new MockLLMService();
	}
	if (config.llm.provider === "openai-compatible") {
		if (!config.llm.baseUrl || !config.llm.model) {
			log.info("openai-compatible configured but baseUrl/model missing, using mock fallback");
			return new MockLLMService();
		}
		log.info(`using OpenAI-compatible LLM provider: ${config.llm.baseUrl}, model=${config.llm.model}`);
		return new OpenAILLMService(config.llm);
	}
	log.info(`unknown LLM provider "${config.llm.provider}", using mock fallback`);
	return new MockLLMService();
}

function resolveTTSProvider(config: AppConfig): ITTSService {
	if (config.tts.provider === "mock") {
		log.info("using mock TTS provider");
		return new MockTTSService();
	}
	if (config.tts.provider === "gpt-sovits") {
		if (!config.tts.baseUrl) {
			log.info("GPT-SoVITS configured but baseUrl missing, using mock fallback");
			return new MockTTSService();
		}
		// GPT-SoVITS provider 将在 M2 中实现
		log.info(`GPT-SoVITS provider configured (${config.tts.baseUrl}) but real implementation pending (M2), using mock fallback`);
		return new MockTTSService();
	}
	log.info(`unknown TTS provider "${config.tts.provider}", using mock fallback`);
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
	const externalInput = new ExternalInputService(eventBus);
	externalInput.setRuntime(runtime);

	const llmProvider = resolveLLMProvider(config);
	const llm = new LLMService(eventBus, runtime, llmProvider);
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
		externalInput,
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

export { eventBus } from "./event-bus";
export { createLogger } from "./logger";
