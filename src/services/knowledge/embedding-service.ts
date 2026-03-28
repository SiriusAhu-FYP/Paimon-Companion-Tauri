// Phase 3.5 — Embedding Service
// 接口化设计：后续可替换为本地模型实现

import { createLogger } from "@/services/logger";
import { proxyRequest } from "@/services/config/http-proxy";
import { getConfig } from "@/services/config/config-service";
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

	constructor(config: EmbeddingProviderConfig) {
		this.config = config;
		log.info("OpenAI embedding service initialized", {
			baseUrl: config.baseUrl,
			model: config.model,
			dimension: config.dimension,
		});
	}

	async embed(text: string): Promise<number[]> {
		const results = await this.embedBatch([text]);
		return results[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
		const url = `${baseUrl}/embeddings`;

		const body = JSON.stringify({
			input: texts,
			model: this.config.model,
			dimensions: this.config.dimension,
		});

		const secretKey = this.resolveSecretKey();

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

		// 按 index 排序保证顺序一致
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

	private resolveSecretKey(): string | undefined {
		if (this.config.apiKeySource === "dedicated") {
			return SECRET_KEYS.EMBEDDING_API_KEY;
		}
		// apiKeySource === "llm"：复用当前活跃 LLM profile 的 key
		const cfg = getConfig();
		if (cfg.activeLlmProfileId) {
			return SECRET_KEYS.LLM_API_KEY(cfg.activeLlmProfileId);
		}
		return undefined;
	}
}
