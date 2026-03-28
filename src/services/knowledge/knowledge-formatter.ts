// Phase 3.5 — 检索结果格式化为 prompt 文本

import type { RetrievalResult } from "@/types/knowledge";

/**
 * 将语义检索结果格式化为 LLM system prompt 中的知识上下文字符串。
 * liveContext 优先级最高，排在前面；检索结果排在后面。
 */
export function formatRetrievalForPrompt(
	retrievalResults: RetrievalResult[],
	liveContext: string,
): string {
	const sections: string[] = [];

	// liveContext 优先、全量
	const live = liveContext.trim();
	if (live) {
		sections.push(live);
	}

	// 检索结果
	if (retrievalResults.length > 0) {
		const items = retrievalResults.map((r, i) => {
			const sourceLabel = [r.source, r.title].filter(Boolean).join(" / ");
			return `【参考知识 ${i + 1}】[来源: ${sourceLabel}]\n${r.chunkText}`;
		});
		sections.push(items.join("\n\n"));
	}

	return sections.join("\n\n");
}

/**
 * 生成检索日志摘要（用于 log.info）。
 */
export function summarizeRetrieval(results: RetrievalResult[]): Record<string, unknown> {
	return {
		count: results.length,
		items: results.map((r) => ({
			docId: r.docId,
			title: r.title,
			score: Math.round(r.score * 10000) / 10000,
		})),
	};
}
