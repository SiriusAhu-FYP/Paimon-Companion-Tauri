import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService } from "./knowledge";
import { PerceptionService } from "./perception";
import { SafetyService } from "./safety";
import { OrchestratorService } from "./orchestrator";
import { Game2048Service } from "./games";
import { EvaluationService } from "./evaluation";
import { UnifiedRuntimeService } from "./unified";
import { LLMService } from "./llm";
import { AudioPlayer } from "./audio";
import type { IASRService } from "./asr";
import { PipelineService } from "./pipeline";
import { VoiceInputService } from "./voice-input";
import { createLogger } from "./logger";
import { getConfig } from "./config";
import { configureKnowledgeProviders, reinitializeKnowledgeProviders } from "./knowledge-provider-manager";
import { resolveASRProvider, resolveLLMProvider, resolveTTSProvider } from "./provider-resolvers";

const log = createLogger("services");

export interface ServiceContainer {
	bus: EventBus;
	runtime: RuntimeService;
	character: CharacterService;
	knowledge: KnowledgeService;
	perception: PerceptionService;
	safety: SafetyService;
	orchestrator: OrchestratorService;
	game2048: Game2048Service;
	evaluation: EvaluationService;
	unified: UnifiedRuntimeService;
	llm: LLMService;
	asr: IASRService;
	player: AudioPlayer;
	pipeline: PipelineService;
	voiceInput: VoiceInputService;
}

let services: ServiceContainer | null = null;

export function initServices(): ServiceContainer {
	if (services) {
		log.warn("services already initialized, returning existing instance");
		return services;
	}

	const config = getConfig();

	const runtime = new RuntimeService(eventBus);
	const character = new CharacterService(eventBus);
	const knowledge = new KnowledgeService(eventBus);
	const perception = new PerceptionService(eventBus);
	const safety = new SafetyService(eventBus, runtime);
	const orchestrator = new OrchestratorService({
		bus: eventBus,
		safety,
		perception,
	});
	const game2048 = new Game2048Service({
		bus: eventBus,
		orchestrator,
	});
	const evaluation = new EvaluationService({
		bus: eventBus,
		game2048,
		orchestrator,
	});

	// Keep knowledge alive for companion/chat workflows, but do not route the
	// latency-sensitive functional game loop through embedding or rerank.
	configureKnowledgeProviders(knowledge, config);
	knowledge.initialize().catch((err) => {
		log.error("knowledge initialization failed", err);
	});

	const llmProvider = resolveLLMProvider(config);
	const llm = new LLMService(eventBus, runtime, llmProvider, character, knowledge);
	const asr = resolveASRProvider(config);
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
	const voiceInput = new VoiceInputService({
		bus: eventBus,
		pipeline,
		asr,
	});
	const unified = new UnifiedRuntimeService({
		bus: eventBus,
		runtime,
		character,
		game2048,
		pipeline,
	});

	services = {
		bus: eventBus,
		runtime,
		character,
		knowledge,
		perception,
		safety,
		orchestrator,
		game2048,
		evaluation,
		unified,
		llm,
		asr,
		player,
		pipeline,
		voiceInput,
	};

	log.info("all services initialized", {
		llmProvider: config.llm.provider,
		ttsProvider: config.tts.provider,
		asrProvider: config.asr.provider,
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
	const newASRProvider = resolveASRProvider(config);
	const newTTSProvider = resolveTTSProvider(config);

	services.llm.setProvider(newLLMProvider);
	services.asr = newASRProvider;
	services.voiceInput.setASRService(newASRProvider);

	const sq = services.pipeline.getSpeechQueue();
	sq.setTTS(newTTSProvider);

	log.info("providers refreshed", {
		llmProvider: config.llm.provider,
		ttsProvider: config.tts.provider,
		asrProvider: config.asr.provider,
	});
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
	await reinitializeKnowledgeProviders(services.knowledge, config);
}

export { eventBus } from "./event-bus";
export { createLogger } from "./logger";
