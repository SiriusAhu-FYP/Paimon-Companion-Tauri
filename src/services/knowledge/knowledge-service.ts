// Phase 3.5 — KnowledgeService 重构
// 接入 Orama 向量数据库 + Embedding + 持久化

import type { EventBus } from "@/services/event-bus";
import { getConfig } from "@/services/config";
import { createLogger } from "@/services/logger";
import type {
	KnowledgeDocument, KnowledgeChunk, RetrievalResult,
	KnowledgeQueryOptions, KnowledgeDBMetadata,
} from "@/types/knowledge";
import {
	CURRENT_SCHEMA_VERSION, MAX_DOCUMENTS,
	DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_STRATEGY,
} from "@/types/knowledge";
import type { IEmbeddingService } from "./embedding-service";
import { chunkText } from "./text-chunker";
import {
	createKnowledgeDB, insertChunks, searchKnowledge,
	removeByDocId, saveDB, loadDB, getChunkCount,
	type KnowledgeOrama,
} from "./orama-store";
import {
	loadDocuments, saveDocuments,
	loadIndex, saveIndex,
} from "./knowledge-persistence";
import type { RawData } from "@orama/orama";

const log = createLogger("knowledge");

// ── 旧接口兼容：liveContext（ControlPanel 临时注入保留原样） ──

interface LiveContextEntry {
	id: string;
	content: string;
	priority: number;
	expiresAt: number | null;
}

export class KnowledgeService {
	private bus: EventBus;
	private embeddingService: IEmbeddingService | null = null;
	private db: KnowledgeOrama | null = null;
	private documents: KnowledgeDocument[] = [];
	private metadata: KnowledgeDBMetadata | null = null;

	// liveContext 保留原样（ControlPanel 临时注入，不走 Orama）
	private liveContext: LiveContextEntry[] = [];

	private initialized = false;
	private initializing = false;

	constructor(bus: EventBus) {
		this.bus = bus;

		// 保留 external:product-message 事件订阅
		this.bus.on("external:product-message", (payload) => {
			if (payload.type === "priority") {
				this.addLiveContext({
					id: `product-${Date.now()}`,
					content: payload.content,
					priority: 10,
					expiresAt: payload.ttl ? Date.now() + payload.ttl * 1000 : null,
				});
			}
			// "persistent" 类型不再走旧的 addKnowledge，应通过 importDocuments 导入
		});
	}

	// ── 初始化 ──

	setEmbeddingService(service: IEmbeddingService) {
		this.embeddingService = service;
		log.info("embedding service set", {
			model: service.getModelName(),
			dimension: service.getDimension(),
		});
	}

	async initialize(): Promise<void> {
		if (this.initialized || this.initializing) return;
		this.initializing = true;

		try {
			const config = getConfig().knowledge;
			const dimension = config.embedding.dimension;

			this.db = createKnowledgeDB(dimension);

			// 加载原始文档
			const docStore = await loadDocuments();
			if (docStore?.documents) {
				this.documents = docStore.documents;
				log.info(`loaded ${this.documents.length} documents from persistence`);
			}

			// 尝试加载索引快照
			const indexStore = await loadIndex();
			if (indexStore?.metadata && indexStore.oramaData) {
				const compat = this.checkCompatibility(indexStore.metadata, config);
				if (compat.compatible) {
					loadDB(this.db, indexStore.oramaData as RawData);
					this.metadata = indexStore.metadata;
					log.info("index loaded from persistence", {
						chunkCount: this.metadata.chunkCount,
						embeddingModel: this.metadata.embeddingModel,
					});
				} else {
					log.warn(`index incompatible: ${compat.reason}`);
					// 索引不兼容，但原始文档已加载；等用户触发重建
				}
			}

			// 只有 embedding service 可用时才标记为初始化完成
			// 否则后续 addDocument 会正确报错"Embedding 服务未配置"
			if (!this.embeddingService) {
				log.warn("knowledge service initialized without embedding service — waiting for configuration");
				return;
			}

			this.initialized = true;
			log.info("knowledge service initialized", {
				documentCount: this.documents.length,
				hasIndex: !!this.metadata,
			});
		} catch (err) {
			log.error("knowledge service initialization failed", err);
		} finally {
			this.initializing = false;
		}
	}

	/** 配置变更后完全重新初始化（dimension 可能变化） */
	async reinitialize(): Promise<void> {
		this.initialized = false;
		this.initializing = false;
		this.db = null;
		this.metadata = null;
		// 不清空 documents——持久化层会重新加载
		this.documents = [];
		await this.initialize();
	}

	// ── 导入文档 ──

	async importDocuments(docs: KnowledgeDocument[]): Promise<{ imported: number; errors: string[] }> {
		const errors: string[] = [];
		const totalAfter = this.documents.length + docs.length;
		if (totalAfter > MAX_DOCUMENTS) {
			errors.push(`超出文档上限 (${MAX_DOCUMENTS})，当前 ${this.documents.length} 条，尝试导入 ${docs.length} 条`);
			return { imported: 0, errors };
		}

		if (!this.embeddingService) {
			errors.push("Embedding 服务未配置");
			return { imported: 0, errors };
		}

		if (!this.db) {
			errors.push("知识库未初始化");
			return { imported: 0, errors };
		}

		let imported = 0;

		for (const doc of docs) {
			try {
				// 检查 id 重复
				if (this.documents.some((d) => d.id === doc.id)) {
					errors.push(`文档 "${doc.title}" (id: ${doc.id}) 已存在，跳过`);
					continue;
				}

				const chunks = await this.processDocument(doc);
				await insertChunks(this.db, chunks);

				this.documents.push(doc);
				imported++;

				log.info(`imported document: "${doc.title}" → ${chunks.length} chunks`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`导入 "${doc.title}" 失败: ${msg}`);
				log.error(`import failed for "${doc.title}"`, err);
			}
		}

		if (imported > 0) {
			await this.persistAll();
		}

		return { imported, errors };
	}

	// ── 手动添加单条 ──

	async addDocument(doc: KnowledgeDocument): Promise<{ success: boolean; error?: string }> {
		const result = await this.importDocuments([doc]);
		if (result.imported > 0) return { success: true };
		return { success: false, error: result.errors[0] ?? "未知错误" };
	}

	// ── 更新文档（删除旧 chunks + 重新向量化） ──

	async updateDocument(docId: string, updates: { title?: string; content?: string }): Promise<{ success: boolean; error?: string }> {
		if (!this.db) return { success: false, error: "知识库未初始化" };
		if (!this.embeddingService) return { success: false, error: "Embedding 服务未配置" };

		const idx = this.documents.findIndex((d) => d.id === docId);
		if (idx === -1) return { success: false, error: "文档不存在" };

		const doc = { ...this.documents[idx] };
		if (updates.title !== undefined) doc.title = updates.title;
		if (updates.content !== undefined) doc.content = updates.content;

		try {
			await removeByDocId(this.db, docId);
			const chunks = await this.processDocument(doc);
			await insertChunks(this.db, chunks);
			this.documents[idx] = doc;
			await this.persistAll();
			log.info(`updated document: "${doc.title}" → ${chunks.length} chunks`);
			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error(`update failed for "${doc.title}"`, err);
			return { success: false, error: msg };
		}
	}

	// ── 删除文档 ──

	async removeDocument(docId: string): Promise<boolean> {
		if (!this.db) return false;

		const idx = this.documents.findIndex((d) => d.id === docId);
		if (idx === -1) return false;

		await removeByDocId(this.db, docId);
		this.documents.splice(idx, 1);

		await this.persistAll();
		log.info(`removed document: ${docId}`);
		return true;
	}

	// ── 语义检索（核心能力） ──

	async query(queryText: string, options?: KnowledgeQueryOptions): Promise<RetrievalResult[]> {
		if (!this.db) {
			log.debug("query skipped — db not ready");
			return [];
		}

		const config = getConfig().knowledge;
		const topK = options?.topK ?? config.retrievalTopK;
		const mode = options?.searchMode ?? config.searchMode;

		let queryVector: number[] = [];

		if (mode !== "fulltext") {
			if (!this.embeddingService) {
				log.warn("embedding service unavailable, falling back to fulltext");
				return this.queryFulltext(queryText, topK);
			}
			try {
				queryVector = await this.embeddingService.embed(queryText);
				log.debug(`query embedding done: dim=${queryVector.length}`);
			} catch (err) {
				log.warn("embedding failed, falling back to fulltext", err);
				return this.queryFulltext(queryText, topK);
			}
		}

		const results = await searchKnowledge(this.db, queryVector, queryText, mode, topK);
		log.info(`query "${queryText.slice(0, 30)}" → ${results.length} results (mode=${mode}, topK=${topK}, chunkCount=${getChunkCount(this.db)})`);
		return results;
	}

	private async queryFulltext(queryText: string, topK: number): Promise<RetrievalResult[]> {
		if (!this.db) return [];
		return searchKnowledge(this.db, [], queryText, "fulltext", topK);
	}

	// ── 全量重建索引 ──

	async rebuildIndex(): Promise<{ success: boolean; error?: string }> {
		if (!this.embeddingService) {
			return { success: false, error: "Embedding 服务未配置" };
		}

		const config = getConfig().knowledge;
		const dimension = config.embedding.dimension;

		// 新建 DB
		this.db = createKnowledgeDB(dimension);
		this.metadata = null;

		let totalChunks = 0;

		for (const doc of this.documents) {
			try {
				const chunks = await this.processDocument(doc);
				await insertChunks(this.db, chunks);
				totalChunks += chunks.length;
			} catch (err) {
				log.error(`rebuild failed for "${doc.title}"`, err);
				return { success: false, error: `重建文档 "${doc.title}" 失败: ${err instanceof Error ? err.message : String(err)}` };
			}
		}

		await this.persistAll();
		log.info(`index rebuilt: ${this.documents.length} docs, ${totalChunks} chunks`);
		return { success: true };
	}

	// ── liveContext（保留原有接口，不走 Orama） ──

	addLiveContext(entry: LiveContextEntry) {
		this.liveContext.push(entry);
		log.info(`added live context: ${entry.id}`);
	}

	removeLiveContext(id: string) {
		this.liveContext = this.liveContext.filter((e) => e.id !== id);
	}

	clearLiveContext() {
		this.liveContext = [];
		log.info("cleared live context");
	}

	getAssembledLiveContext(): string {
		this.pruneExpired();
		return this.liveContext
			.sort((a, b) => b.priority - a.priority)
			.map((e) => e.content)
			.join("\n\n");
	}

	/** 向后兼容旧调用 */
	getAssembledContext(): string {
		return this.getAssembledLiveContext();
	}

	getLiveContextCount(): number {
		this.pruneExpired();
		return this.liveContext.length;
	}

	// ── 旧接口兼容 ──

	addKnowledge(entry: { id: string; content: string }) {
		log.warn("addKnowledge() deprecated — use importDocuments() for persistent knowledge");
		this.addLiveContext({
			id: entry.id,
			content: entry.content,
			priority: 1,
			expiresAt: null,
		});
	}

	clearLongTermKnowledge() {
		log.warn("clearLongTermKnowledge() deprecated");
	}

	getKnowledgeCount(): number {
		return this.documents.length;
	}

	// ── 查询状态 ──

	getDocuments(): readonly KnowledgeDocument[] {
		return this.documents;
	}

	getMetadata(): KnowledgeDBMetadata | null {
		return this.metadata;
	}

	getChunkCount(): number {
		if (!this.db) return 0;
		return getChunkCount(this.db);
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	hasIndex(): boolean {
		return this.metadata !== null;
	}

	// ── 内部方法 ──

	private async processDocument(doc: KnowledgeDocument): Promise<KnowledgeChunk[]> {
		if (!this.embeddingService) throw new Error("Embedding service not available");

		const textChunks = chunkText(doc.content);
		const texts = textChunks.map((c) => c.text);

		const embeddings = await this.embeddingService.embedBatch(texts);

		return textChunks.map((chunk, i) => ({
			docId: doc.id,
			chunkIndex: chunk.index,
			text: chunk.text,
			title: doc.title,
			source: doc.source ?? "manual",
			embedding: embeddings[i],
		}));
	}

	private async persistAll(): Promise<void> {
		if (!this.db) return;

		const config = getConfig().knowledge;

		// 保存原始文档
		await saveDocuments({
			documents: this.documents,
			updatedAt: Date.now(),
		});

		// 保存索引快照
		const chunkCount = getChunkCount(this.db);
		const now = Date.now();

		this.metadata = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			embeddingModel: config.embedding.model,
			embeddingDimension: config.embedding.dimension,
			chunkStrategy: DEFAULT_CHUNK_STRATEGY,
			chunkSize: DEFAULT_CHUNK_SIZE,
			chunkOverlap: DEFAULT_CHUNK_OVERLAP,
			indexBuildVersion: (this.metadata?.indexBuildVersion ?? 0) + 1,
			createdAt: this.metadata?.createdAt ?? now,
			updatedAt: now,
			entryCount: this.documents.length,
			chunkCount,
		};

		await saveIndex({
			metadata: this.metadata,
			oramaData: saveDB(this.db),
		});

		log.info("persistence complete", {
			documentCount: this.documents.length,
			chunkCount,
		});
	}

	private checkCompatibility(
		meta: KnowledgeDBMetadata,
		config: import("@/types/knowledge").KnowledgeConfig,
	): { compatible: boolean; reason?: string } {
		if (meta.schemaVersion !== CURRENT_SCHEMA_VERSION) {
			return { compatible: false, reason: `schema version mismatch: ${meta.schemaVersion} vs ${CURRENT_SCHEMA_VERSION}` };
		}
		if (meta.embeddingModel !== config.embedding.model) {
			return { compatible: false, reason: `embedding model changed: ${meta.embeddingModel} → ${config.embedding.model}` };
		}
		if (meta.embeddingDimension !== config.embedding.dimension) {
			return { compatible: false, reason: `embedding dimension changed: ${meta.embeddingDimension} → ${config.embedding.dimension}` };
		}
		return { compatible: true };
	}

	private pruneExpired() {
		const now = Date.now();
		this.liveContext = this.liveContext.filter(
			(e) => e.expiresAt === null || e.expiresAt > now,
		);
	}
}
