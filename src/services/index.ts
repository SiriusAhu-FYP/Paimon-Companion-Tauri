import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService } from "./knowledge";
import { ExternalInputService } from "./external-input";
import { LLMService, MockLLMService } from "./llm";
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
	switch (config.llm.provider) {
		case "openai-compatible":
			// 真实 LLM provider 将在 M1 中实现，当前降级到 mock
			log.warn("openai-compatible LLM provider not yet implemented, falling back to mock");
			return new MockLLMService();
		case "mock":
		default:
			return new MockLLMService();
	}
}

function resolveTTSProvider(config: AppConfig): ITTSService {
	switch (config.tts.provider) {
		case "http-api":
			// 真实 TTS provider 将在 M2 中实现，当前降级到 mock
			log.warn("http-api TTS provider not yet implemented, falling back to mock");
			return new MockTTSService();
		case "mock":
		default:
			return new MockTTSService();
	}
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
