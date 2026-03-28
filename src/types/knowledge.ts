// Phase 3.5 — 知识库共享类型定义

// ── 知识分类 ──

export type KnowledgeCategory = "faq" | "product" | "text";

// ── 导入层文档结构（用户导入粒度） ──

export interface KnowledgeDocument {
	id: string;
	category: KnowledgeCategory;
	title: string;
	content: string;
	tags?: string[];
	source?: string;
}

// ── Chunk 后的索引结构 ──

export interface KnowledgeChunk {
	docId: string;
	chunkIndex: number;
	text: string;
	category: KnowledgeCategory;
	title: string;
	source: string;
	embedding: number[];
}

// ── 检索结果 ──

export interface RetrievalResult {
	chunkText: string;
	docId: string;
	title: string;
	category: KnowledgeCategory;
	source: string;
	score: number;
}

// ── 检索选项 ──

export interface KnowledgeQueryOptions {
	topK?: number;
	category?: KnowledgeCategory;
	searchMode?: KnowledgeSearchMode;
}

// ── Embedding Provider 配置 ──

export type EmbeddingApiKeySource = "llm" | "dedicated";
export type KnowledgeSearchMode = "vector" | "hybrid" | "fulltext";

export interface EmbeddingProviderConfig {
	baseUrl: string;
	model: string;
	dimension: number;
	apiKeySource: EmbeddingApiKeySource;
}

export interface KnowledgeConfig {
	embedding: EmbeddingProviderConfig;
	retrievalTopK: number;
	searchMode: KnowledgeSearchMode;
}

// ── 索引元数据 ──

export interface KnowledgeDBMetadata {
	schemaVersion: number;
	embeddingModel: string;
	embeddingDimension: number;
	chunkStrategy: string;
	chunkSize: number;
	chunkOverlap: number;
	indexBuildVersion: number;
	createdAt: number;
	updatedAt: number;
	entryCount: number;
	chunkCount: number;
}

// ── 持久化存储格式 ──

export interface KnowledgeDocumentStore {
	documents: KnowledgeDocument[];
	updatedAt: number;
}

export interface KnowledgeIndexStore {
	metadata: KnowledgeDBMetadata;
	oramaData: unknown;
}

// ── 常量 ──

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_DOCUMENTS = 200;
export const DEFAULT_CHUNK_SIZE = 512;
export const DEFAULT_CHUNK_OVERLAP = 50;
export const DEFAULT_CHUNK_STRATEGY = "fixed-512-overlap-50";

export const DEFAULT_KNOWLEDGE_CONFIG: KnowledgeConfig = {
	embedding: {
		baseUrl: "https://api.openai.com/v1",
		model: "text-embedding-3-small",
		dimension: 1536,
		apiKeySource: "llm",
	},
	retrievalTopK: 5,
	searchMode: "vector",
};
