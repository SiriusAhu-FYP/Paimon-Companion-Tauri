import { EventBus, eventBus } from "./event-bus";
import { RuntimeService } from "./runtime";
import { CharacterService } from "./character";
import { KnowledgeService } from "./knowledge";
import { ExternalInputService } from "./external-input";
import { createLogger } from "./logger";

const log = createLogger("services");

export interface ServiceContainer {
	bus: EventBus;
	runtime: RuntimeService;
	character: CharacterService;
	knowledge: KnowledgeService;
	externalInput: ExternalInputService;
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

	services = {
		bus: eventBus,
		runtime,
		character,
		knowledge,
		externalInput,
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
