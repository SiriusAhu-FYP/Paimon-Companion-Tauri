import type { AppConfig } from "./config";
import { CompatibleRerankService, KnowledgeService, OpenAIEmbeddingService } from "./knowledge";
import { createLogger } from "./logger";

const log = createLogger("knowledge-providers");

export function resolveEmbeddingProfile(config: AppConfig) {
	const activeProfile = config.knowledge.activeEmbeddingProfileId
		? config.knowledge.embeddingProfiles.find((profile) => profile.id === config.knowledge.activeEmbeddingProfileId)
		: null;

	if (activeProfile && activeProfile.baseUrl && activeProfile.model) {
		return activeProfile;
	}
	if (config.knowledge.embedding.baseUrl && config.knowledge.embedding.model) {
		return { id: "__inline__", ...config.knowledge.embedding };
	}

	return null;
}

export function resolveRerankProfile(config: AppConfig) {
	if (!config.knowledge.rerankEnabled) return null;

	const activeProfile = config.knowledge.activeRerankProfileId
		? config.knowledge.rerankProfiles.find((profile) => profile.id === config.knowledge.activeRerankProfileId)
		: null;

	if (activeProfile && activeProfile.baseUrl && activeProfile.model) {
		return activeProfile;
	}
	if (config.knowledge.rerank.baseUrl && config.knowledge.rerank.model) {
		return { id: "__inline_rerank__", name: "inline", ...config.knowledge.rerank };
	}

	return null;
}

export function configureKnowledgeProviders(knowledge: KnowledgeService, config: AppConfig) {
	const embeddingProfile = resolveEmbeddingProfile(config);
	if (embeddingProfile) {
		knowledge.setEmbeddingService(new OpenAIEmbeddingService(
			{ baseUrl: embeddingProfile.baseUrl, model: embeddingProfile.model, dimension: embeddingProfile.dimension },
			embeddingProfile.id,
		));
	} else {
		knowledge.setEmbeddingService(null);
	}

	const rerankProfile = resolveRerankProfile(config);
	if (rerankProfile) {
		knowledge.setRerankService(new CompatibleRerankService(
			{ baseUrl: rerankProfile.baseUrl, model: rerankProfile.model },
			rerankProfile.id,
		));
	} else {
		knowledge.setRerankService(null);
	}

	return { embeddingProfile, rerankProfile };
}

export async function reinitializeKnowledgeProviders(knowledge: KnowledgeService, config: AppConfig) {
	const { embeddingProfile, rerankProfile } = configureKnowledgeProviders(knowledge, config);

	await knowledge.reinitialize();
	log.info("knowledge providers refreshed", {
		embeddingProfileId: embeddingProfile?.id ?? "none",
		embeddingModel: embeddingProfile?.model ?? "none",
		rerankProfileId: rerankProfile?.id ?? "none",
		rerankModel: rerankProfile?.model ?? "none",
		rerankEnabled: config.knowledge.rerankEnabled,
	});
}
