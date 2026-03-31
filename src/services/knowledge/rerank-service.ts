// Phase 3.5 — Rerank Service
// 兼容 /v1/rerank 端点（Cohere/Jina/DMXAPI 等）

import { createLogger } from "@/services/logger";
import { proxyRequest } from "@/services/config/http-proxy";
import { SECRET_KEYS } from "@/services/config/types";
import type { RerankProviderConfig, RerankResult } from "@/types/knowledge";

const log = createLogger("rerank");

// ── 接口 ──

export interface IRerankService {
	rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]>;
	getModelName(): string;
}

// ── 兼容 /v1/rerank 端点实现 ──

export class CompatibleRerankService implements IRerankService {
	private config: RerankProviderConfig;
	private profileId: string | null;

	constructor(config: RerankProviderConfig, profileId: string | null = null) {
		this.config = config;
		this.profileId = profileId;
		log.info("Compatible rerank service initialized", {
			baseUrl: config.baseUrl,
			model: config.model,
			profileId,
		});
	}

	async rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]> {
		if (documents.length === 0) return [];

		let baseUrl = this.config.baseUrl.replace(/\/+$/, "");
		baseUrl = baseUrl.replace(/\/v1$/, "");
		const url = `${baseUrl}/v1/rerank`;

		const body = JSON.stringify({
			model: this.config.model,
			query,
			documents,
			top_n: topN ?? documents.length,
			return_documents: true,
		});

		const secretKey = this.profileId ? SECRET_KEYS.RERANK_API_KEY(this.profileId) : undefined;

		log.debug(`rerank request: ${documents.length} docs, topN=${topN}, model=${this.config.model}`);

		const resp = await proxyRequest({
			url,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			secretKey,
			timeoutMs: 10000,
		});

		if (resp.status < 200 || resp.status >= 300) {
			const errMsg = `Rerank API error: HTTP ${resp.status} — ${resp.body.slice(0, 200)}`;
			log.error(errMsg);
			throw new Error(errMsg);
		}

		const data = JSON.parse(resp.body) as {
			results: Array<{
				index: number;
				relevance_score: number;
				document?: { text: string };
			}>;
		};

		const results: RerankResult[] = data.results.map((r) => ({
			index: r.index,
			relevanceScore: r.relevance_score,
			text: r.document?.text ?? documents[r.index] ?? "",
		}));

		log.debug(`rerank response: ${results.length} results, top score=${results[0]?.relevanceScore ?? "N/A"}`);

		return results;
	}

	getModelName(): string {
		return this.config.model;
	}
}
