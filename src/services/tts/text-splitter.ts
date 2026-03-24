/**
 * 文本切片器——将 LLM 回复按语义边界拆分成适合逐段合成的片段。
 *
 * 策略：
 * 1. 硬边界切分：句号/问号/感叹号/分号/换行/省略号
 * 2. 软边界细化：超长句按逗号/顿号/冒号拆分
 * 3. 短片段合并：过短片段与相邻片段合并
 * 4. 中英分离：连续英文独立成段，标注 lang
 */

export interface SplitSegment {
	text: string;
	lang: "zh" | "en" | "auto";
}

const DEFAULT_MAX_LEN = 80;
const DEFAULT_MIN_LEN = 15;

// 硬边界：中文句末标点、分号、换行、省略号
// 英文句号仅在后跟空格+大写字母时作为硬边界（避免误切缩写/小数）
const HARD_BOUNDARY_RE = /([。！？；\n]+|\.{3}|……|\.(?=\s+[A-Z]))/;

// 软边界：逗号、顿号、冒号
const SOFT_BOUNDARY_RE = /([，、：,:])/;

// 英文片段检测：连续英文字符、数字、空格、常见标点
const ENGLISH_BLOCK_RE = /[A-Za-z][A-Za-z0-9\s,.!?;:'"()\-]+/g;

// 判断文本是否以中文为主（含 CJK 字符比例 > 30%）
function isMostlyChinese(text: string): boolean {
	const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
	return !!cjk && cjk.length / text.length > 0.3;
}

export function splitText(
	text: string,
	maxLen = DEFAULT_MAX_LEN,
	minLen = DEFAULT_MIN_LEN,
): SplitSegment[] {
	if (!text || !text.trim()) return [];

	// Step 1: 硬边界切分
	const hardParts = splitByPattern(text, HARD_BOUNDARY_RE);

	// Step 2: 软边界细化（仅超长片段）
	const softParts: string[] = [];
	for (const part of hardParts) {
		if (part.length > maxLen) {
			softParts.push(...splitByPattern(part, SOFT_BOUNDARY_RE));
		} else {
			softParts.push(part);
		}
	}

	// Step 3: 过滤空串 + trim
	const trimmed = softParts
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	// Step 4: 短片段合并
	const merged = mergeShortSegments(trimmed, minLen);

	// Step 5: 中英分离
	const segments = separateLanguages(merged);

	return segments;
}

/**
 * 按正则模式拆分，将匹配到的分隔符合并回前一片段。
 */
function splitByPattern(text: string, pattern: RegExp): string[] {
	const parts = text.split(pattern);
	const result: string[] = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i > 0 && pattern.test(part)) {
			result[result.length - 1] = (result[result.length - 1] || "") + part;
		} else {
			result.push(part);
		}
	}

	return result;
}

/**
 * 将低于 minLen 的短片段与相邻片段合并。
 * 优先向前合并（追加到前一片段），若前一片段不存在则向后合并。
 */
function mergeShortSegments(parts: string[], minLen: number): string[] {
	if (parts.length <= 1) return parts;

	const result: string[] = [];

	for (const part of parts) {
		if (
			result.length > 0 &&
			part.length < minLen
		) {
			result[result.length - 1] += part;
		} else if (
			result.length > 0 &&
			result[result.length - 1].length < minLen
		) {
			result[result.length - 1] += part;
		} else {
			result.push(part);
		}
	}

	return result;
}

/**
 * 对每个片段进行中英分离。
 * 扫描连续英文块，将其独立切出并标注 lang。
 */
function separateLanguages(parts: string[]): SplitSegment[] {
	const result: SplitSegment[] = [];

	for (const part of parts) {
		if (!isMostlyChinese(part)) {
			// 整段非中文为主，标记为 en 或 auto
			const hasAnyCJK = /[\u4e00-\u9fff]/.test(part);
			result.push({ text: part, lang: hasAnyCJK ? "auto" : "en" });
			continue;
		}

		// 中文为主的段落，提取连续英文块独立成段
		let lastIndex = 0;
		const matches = [...part.matchAll(ENGLISH_BLOCK_RE)];

		for (const match of matches) {
			const matchStart = match.index!;
			const matchEnd = matchStart + match[0].length;
			const englishText = match[0].trim();

			// 跳过过短的英文（单个单词嵌在中文中不拆）
			if (englishText.length < 4 || !/\s/.test(englishText)) continue;

			// 英文块前面的中文部分
			if (matchStart > lastIndex) {
				const zhPart = part.slice(lastIndex, matchStart).trim();
				if (zhPart) result.push({ text: zhPart, lang: "zh" });
			}

			result.push({ text: englishText, lang: "en" });
			lastIndex = matchEnd;
		}

		// 剩余尾部
		if (lastIndex < part.length) {
			const tail = part.slice(lastIndex).trim();
			if (tail) result.push({ text: tail, lang: "zh" });
		}

		// 如果没有任何英文块被提取，整段标记为 zh
		if (matches.length === 0 || result.length === 0 || result[result.length - 1].text !== part) {
			// 已在循环中处理
		}
	}

	return result;
}
