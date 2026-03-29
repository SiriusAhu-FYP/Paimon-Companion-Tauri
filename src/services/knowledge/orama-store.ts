// Phase 3.5 — Orama 向量数据库封装层

import {
	create, insert, insertMultiple, search, searchVector,
	removeMultiple,
	save, load,
	count,
} from "@orama/orama";
import type { AnyOrama, RawData } from "@orama/orama";
import type { KnowledgeChunk, RetrievalResult, KnowledgeSearchMode } from "@/types/knowledge";
import { createLogger } from "@/services/logger";

const log = createLogger("orama-store");

// Orama schema 定义（dimension 动态构建）
function buildSchema(dimension: number) {
	return {
		docId: "string",
		chunkIndex: "number",
		text: "string",
		title: "string",
		source: "string",
		embedding: `vector[${dimension}]`,
	} as const;
}

export type KnowledgeOrama = AnyOrama;

// ── 创建实例 ──

export function createKnowledgeDB(dimension: number): KnowledgeOrama {
	const schema = buildSchema(dimension);
	const db = create({ schema, id: "knowledge-db" });
	log.info(`knowledge DB created, dimension=${dimension}`);
	return db;
}

// ── 插入 ──

export async function insertChunk(db: KnowledgeOrama, chunk: KnowledgeChunk): Promise<string> {
	const id = await insert(db, {
		docId: chunk.docId,
		chunkIndex: chunk.chunkIndex,
		text: chunk.text,
		title: chunk.title,
		source: chunk.source,
		embedding: chunk.embedding,
	});
	return id as string;
}

export async function insertChunks(db: KnowledgeOrama, chunks: KnowledgeChunk[]): Promise<string[]> {
	if (chunks.length === 0) return [];
	const docs = chunks.map((c) => ({
		docId: c.docId,
		chunkIndex: c.chunkIndex,
		text: c.text,
		title: c.title,
		source: c.source,
		embedding: c.embedding,
	}));
	const ids = await insertMultiple(db, docs);
	return ids as string[];
}

// ── 搜索 ──

export async function searchKnowledge(
	db: KnowledgeOrama,
	queryVector: number[],
	queryText: string,
	mode: KnowledgeSearchMode,
	topK: number,
): Promise<RetrievalResult[]> {
	let results;

	if (mode === "vector") {
		results = await searchVector(db, {
			mode: "vector",
			vector: { value: queryVector, property: "embedding" },
			similarity: 0.2,
			limit: topK,
		});
	} else if (mode === "hybrid") {
		results = await search(db, {
			mode: "hybrid",
			term: queryText,
			vector: { value: queryVector, property: "embedding" },
			similarity: 0.2,
			limit: topK,
		});
	} else {
		// fulltext
		results = await search(db, {
			mode: "fulltext",
			term: queryText,
			limit: topK,
		});
	}

	// vector / hybrid 无结果时自动退回 fulltext
	if ((results.hits ?? []).length === 0 && mode !== "fulltext" && queryText.trim()) {
		log.info(`${mode} returned 0 hits, falling back to fulltext`);
		results = await search(db, {
			mode: "fulltext",
			term: queryText,
			limit: topK,
		});
	}

	return (results.hits ?? []).map((hit) => {
		const doc = hit.document as Record<string, unknown>;
		return {
			chunkText: doc.text as string,
			docId: doc.docId as string,
			title: doc.title as string,
			source: doc.source as string,
			score: hit.score,
		};
	});
}

// ── 按 docId 删除所有关联 chunks ──

export async function removeByDocId(db: KnowledgeOrama, docId: string): Promise<number> {
	// Orama 不支持按字段批量删除，需要先搜再删
	const hits = await search(db, {
		term: docId,
		properties: ["docId"],
		limit: 10000,
	});

	const idsToRemove = (hits.hits ?? [])
		.filter((h) => (h.document as Record<string, unknown>).docId === docId)
		.map((h) => h.id);

	if (idsToRemove.length === 0) return 0;

	const removed = await removeMultiple(db, idsToRemove);
	log.info(`removed ${removed} chunks for docId=${docId}`);
	return typeof removed === "number" ? removed : idsToRemove.length;
}

// ── 序列化 / 反序列化 ──

export function saveDB(db: KnowledgeOrama): RawData {
	return save(db);
}

export function loadDB(db: KnowledgeOrama, raw: RawData): void {
	load(db, raw);
}

// ── 统计 ──

export function getChunkCount(db: KnowledgeOrama): number {
	return count(db) as number;
}
