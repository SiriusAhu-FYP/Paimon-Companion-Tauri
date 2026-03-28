import type { EventBus } from "@/services/event-bus";
import { createLogger } from "@/services/logger";

const log = createLogger("knowledge");

interface KnowledgeEntry {
	id: string;
	content: string;
}

interface LiveContextEntry {
	id: string;
	content: string;
	priority: number;
	expiresAt: number | null;
}

/**
 * Phase 1 最小占位：知识与上下文层。
 * 定义长期知识和临时高优先级上下文的接口边界。
 * 真实 RAG 和持久化留到后续 phase。
 */
export class KnowledgeService {
	private longTermKnowledge: KnowledgeEntry[] = [];
	private liveContext: LiveContextEntry[] = [];
	private bus: EventBus;

	constructor(bus: EventBus) {
		this.bus = bus;

		this.bus.on("external:product-message", (payload) => {
			if (payload.type === "priority") {
				this.addLiveContext({
					id: `product-${Date.now()}`,
					content: payload.content,
					priority: 10,
					expiresAt: payload.ttl ? Date.now() + payload.ttl * 1000 : null,
				});
			} else {
				this.addKnowledge({
					id: `knowledge-${Date.now()}`,
					content: payload.content,
				});
			}
		});
	}

	addKnowledge(entry: KnowledgeEntry) {
		this.longTermKnowledge.push(entry);
		log.info(`added long-term knowledge: ${entry.id}`);
	}

	addLiveContext(entry: LiveContextEntry) {
		this.liveContext.push(entry);
		log.info(`added live context: ${entry.id}`);
	}

	removeLiveContext(id: string) {
		this.liveContext = this.liveContext.filter((e) => e.id !== id);
	}

	/** 清空长期商品/资料条目（仅内存） */
	clearLongTermKnowledge() {
		this.longTermKnowledge = [];
		log.info("cleared long-term knowledge");
	}

	/** 清空当前直播/运营上下文（仅内存） */
	clearLiveContext() {
		this.liveContext = [];
		log.info("cleared live context");
	}

	// 组装上下文供 LLM 调用，按优先级排序
	getAssembledContext(): string {
		this.pruneExpired();

		const liveParts = this.liveContext
			.sort((a, b) => b.priority - a.priority)
			.map((e) => e.content);
		const knowledgeParts = this.longTermKnowledge.map((e) => e.content);

		// 临时高优先级上下文排在前面
		return [...liveParts, ...knowledgeParts].join("\n\n");
	}

	getLiveContextCount(): number {
		this.pruneExpired();
		return this.liveContext.length;
	}

	getKnowledgeCount(): number {
		return this.longTermKnowledge.length;
	}

	private pruneExpired() {
		const now = Date.now();
		this.liveContext = this.liveContext.filter(
			(e) => e.expiresAt === null || e.expiresAt > now
		);
	}
}
