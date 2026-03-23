import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService } from "./knowledge";
import { ExternalInputService } from "./external-input";
import { LLMService, MockLLMService } from "./llm";
import { MockTTSService } from "./tts";
import { AudioPlayer } from "./audio";
import { PipelineService } from "./pipeline";
import { createLogger } from "./logger";

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

export function initServices(): ServiceContainer {
	if (services) {
		log.warn("services already initialized, returning existing instance");
		return services;
	}

	const runtime = new RuntimeService(eventBus);
	const character = new CharacterService(eventBus);
	const knowledge = new KnowledgeService(eventBus);
	const externalInput = new ExternalInputService(eventBus);
	externalInput.setRuntime(runtime);

	// Phase 2: mock LLM + mock TTS
	const llmProvider = new MockLLMService();
	const llm = new LLMService(eventBus, runtime, llmProvider);
	const tts = new MockTTSService();
	const player = new AudioPlayer();

	const pipeline = new PipelineService({
		bus: eventBus,
		runtime,
		character,
		llm,
		tts,
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

	log.info("all services initialized");
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
