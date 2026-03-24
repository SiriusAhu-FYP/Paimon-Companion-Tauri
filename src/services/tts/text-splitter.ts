/**
 * 文本切片器——将 LLM 回复按标点边界拆分成适合逐段合成的片段。
 * 规则：按句末标点（。！？；.!?;）和省略号（...、……）及换行拆分。
 * 超过 maxLen 的片段再按逗号（，,）二次拆分。
 */

const SENTENCE_SPLIT_RE = /([。！？；.!?;\n]+|\.{3}|……)/;
const COMMA_SPLIT_RE = /([，,])/;

const DEFAULT_MAX_LEN = 80;

export function splitText(text: string, maxLen = DEFAULT_MAX_LEN): string[] {
	if (!text || !text.trim()) return [];

	const rawParts = text.split(SENTENCE_SPLIT_RE);

	// 将标点重新合并到前一片段
	const merged = mergePunctuation(rawParts);

	const result: string[] = [];
	for (const seg of merged) {
		const trimmed = seg.trim();
		if (!trimmed) continue;

		if (trimmed.length <= maxLen) {
			result.push(trimmed);
		} else {
			const subParts = splitByComma(trimmed, maxLen);
			result.push(...subParts);
		}
	}

	return result;
}

function mergePunctuation(parts: string[]): string[] {
	const merged: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i > 0 && SENTENCE_SPLIT_RE.test(part)) {
			merged[merged.length - 1] = (merged[merged.length - 1] || "") + part;
		} else {
			merged.push(part);
		}
	}
	return merged;
}

function splitByComma(text: string, maxLen: number): string[] {
	const rawParts = text.split(COMMA_SPLIT_RE);
	const merged = mergeCommaPunctuation(rawParts);

	const result: string[] = [];
	let buffer = "";

	for (const seg of merged) {
		const trimmed = seg.trim();
		if (!trimmed) continue;

		if (buffer && (buffer.length + trimmed.length) > maxLen) {
			result.push(buffer.trim());
			buffer = trimmed;
		} else {
			buffer += seg;
		}
	}

	if (buffer.trim()) {
		result.push(buffer.trim());
	}

	return result;
}

function mergeCommaPunctuation(parts: string[]): string[] {
	const merged: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i > 0 && COMMA_SPLIT_RE.test(part)) {
			merged[merged.length - 1] = (merged[merged.length - 1] || "") + part;
		} else {
			merged.push(part);
		}
	}
	return merged;
}
