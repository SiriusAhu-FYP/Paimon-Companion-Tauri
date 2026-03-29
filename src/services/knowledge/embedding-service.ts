// Phase 3.5 — Embedding Service
// 接口化设计：后续可替换为本地模型实现

import { createLogger } from "@/services/logger";
import { proxyRequest } from "@/services/config/http-proxy";
import { SECRET_KEYS } from "@/services/config/types";
import type { EmbeddingProviderConfig } from "@/types/knowledge";

const log = createLogger("embedding");

// ── 接口 ──

export interface IEmbeddingService {
	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
	getDimension(): number;
	getModelName(): string;
}

// ── OpenAI 兼容实现 ──

export class OpenAIEmbeddingService implements IEmbeddingService {
	private config: EmbeddingProviderConfig;
	private profileId: string | null;

	constructor(config: EmbeddingProviderConfig, profileId: string | null = null) {
		this.config = config;
		this.profileId = profileId;
		log.info("OpenAI embedding service initialized", {
			baseUrl: config.baseUrl,
			model: config.model,
			dimension: config.dimension,
			profileId,
		});
	}

	async embed(text: string): Promise<number[]> {
		const results = await this.embedBatch([text]);
		return results[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		let baseUrl = this.config.baseUrl.replace(/\/+$/, "");
		if (!baseUrl.endsWith("/v1")) {
			baseUrl += "/v1";
		}
		const url = `${baseUrl}/embeddings`;

		const body = JSON.stringify({
			input: texts,
			model: this.config.model,
			dimensions: this.config.dimension,
		});

		const secretKey = this.profileId ? SECRET_KEYS.EMBEDDING_API_KEY(this.profileId) : undefined;

		log.debug(`embedding request: ${texts.length} texts, model=${this.config.model}`);

		const resp = await proxyRequest({
			url,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			secretKey,
			timeoutMs: 30000,
		});

		if (resp.status < 200 || resp.status >= 300) {
			const errMsg = `Embedding API error: HTTP ${resp.status} — ${resp.body.slice(0, 200)}`;
			log.error(errMsg);
			throw new Error(errMsg);
		}

		const data = JSON.parse(resp.body) as {
			data: Array<{ embedding: number[]; index: number }>;
		};

		const sorted = data.data.sort((a, b) => a.index - b.index);
		const embeddings = sorted.map((d) => d.embedding);

		log.debug(`embedding response: ${embeddings.length} vectors, dim=${embeddings[0]?.length ?? 0}`);

		return embeddings;
	}

	getDimension(): number {
		return this.config.dimension;
	}

	getModelName(): string {
		return this.config.model;
	}
}
