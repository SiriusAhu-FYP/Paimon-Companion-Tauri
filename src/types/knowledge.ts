// Phase 3.5 — 知识库共享类型定义

// ── 导入层文档结构（用户导入粒度） ──

export interface KnowledgeDocument {
	id: string;
	title: string;
	content: string;
	source?: string;
}

// ── Chunk 后的索引结构 ──

export interface KnowledgeChunk {
	docId: string;
	chunkIndex: number;
	text: string;
	title: string;
	source: string;
	embedding: number[];
}

// ── 检索结果 ──

export interface RetrievalResult {
	chunkText: string;
	docId: string;
	title: string;
	source: string;
	score: number;
}

// ── 检索选项 ──

export interface KnowledgeQueryOptions {
	topK?: number;
	searchMode?: KnowledgeSearchMode;
}

// ── Embedding Profile（类似 LLMProfile，独立管理 key/url） ──

export interface EmbeddingProfile {
	id: string;
	name: string;
	baseUrl: string;
	model: string;
	dimension: number;
}

// ── Embedding Provider 配置（运行时使用） ──

export type KnowledgeSearchMode = "vector" | "hybrid" | "fulltext";

export interface EmbeddingProviderConfig {
	baseUrl: string;
	model: string;
	dimension: number;
}

export interface KnowledgeConfig {
	embedding: EmbeddingProviderConfig;
	embeddingProfiles: EmbeddingProfile[];
	activeEmbeddingProfileId: string;
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
		baseUrl: "",
		model: "",
		dimension: 1536,
	},
	embeddingProfiles: [],
	activeEmbeddingProfileId: "",
	retrievalTopK: 5,
	searchMode: "vector",
};
