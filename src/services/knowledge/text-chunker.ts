// Phase 3.5 — 文本切块器
// 固定长度切块，在句号/换行处优先切分

import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from "@/types/knowledge";

export interface ChunkOptions {
	chunkSize?: number;
	chunkOverlap?: number;
}

export interface TextChunk {
	text: string;
	index: number;
}

// 中英文句末标点 + 换行
const SENTENCE_BREAK_RE = /[。！？.!?\n]/;

function findBestBreakPoint(text: string, targetEnd: number, minPos: number): number {
	// 从 targetEnd 往回找句子边界
	for (let i = targetEnd; i >= minPos; i--) {
		if (SENTENCE_BREAK_RE.test(text[i])) {
			return i + 1; // 包含标点
		}
	}
	// 没找到句子边界，按空格切
	for (let i = targetEnd; i >= minPos; i--) {
		if (text[i] === " " || text[i] === "\t") {
			return i + 1;
		}
	}
	// 实在没有好的切分点，按原始位置切
	return targetEnd;
}

export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
	const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
	const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

	const cleaned = text.trim();
	if (!cleaned) return [];

	// 短文本不切
	if (cleaned.length <= chunkSize) {
		return [{ text: cleaned, index: 0 }];
	}

	const chunks: TextChunk[] = [];
	let start = 0;
	let chunkIndex = 0;

	while (start < cleaned.length) {
		let end = Math.min(start + chunkSize, cleaned.length);

		if (end < cleaned.length) {
			// 在 [start + chunkSize * 0.6, end] 范围内找更好的断点
			const minBreak = start + Math.floor(chunkSize * 0.6);
			end = findBestBreakPoint(cleaned, end - 1, minBreak);
		}

		const chunkStr = cleaned.slice(start, end).trim();
		if (chunkStr) {
			chunks.push({ text: chunkStr, index: chunkIndex++ });
		}

		if (end >= cleaned.length) break;

		// 下一段起点 = 当前段结束 - overlap
		start = Math.max(end - chunkOverlap, start + 1);
	}

	return chunks;
}
