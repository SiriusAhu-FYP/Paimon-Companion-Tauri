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
	lang: "zh" | "en" | "ja" | "unsupported";
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

// CJK 汉字（中日共用）
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
// 平假名 + 片假名
const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/g;

// 判断文本是否以 CJK 字符为主（含汉字+假名比例 > 30%）
function isMostlyCJK(text: string): boolean {
	const cjk = text.match(CJK_RE);
	const kana = text.match(KANA_RE);
	const total = (cjk?.length ?? 0) + (kana?.length ?? 0);
	return total / text.length > 0.3;
}

// 判断文本是否含大量假名（占 CJK+假名 总量 > 30%）→ 标记为日文
function isJapanese(text: string): boolean {
	const kana = text.match(KANA_RE);
	if (!kana || kana.length === 0) return false;
	const cjk = text.match(CJK_RE);
	const total = (cjk?.length ?? 0) + kana.length;
	// 如果只有假名没有汉字，也应该标记为日文
	if (total === kana.length) return true;
	return kana.length / total > 0.3;
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
 * 判断非 CJK 为主的文本应该标记为哪种语言。
 *
 * 优先级：假名存在→ja，含汉字→zh，韩文/西里尔/阿拉伯/泰文→unsupported，
 * 其余拉丁文字（含法文等带重音字符）统一归为 en（当前浏览器原生语音通常可处理）。
 */
function detectNonCJKLang(text: string): SplitSegment["lang"] {
	// 含假名 → 即使占比不高也标为 ja（短日文片段可能夹杂标点）
	if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
		return "ja";
	}
	// 含汉字但 CJK 占比不足 30%，保守标记为 zh
	if (/[\u4e00-\u9fff]/.test(text)) {
		return "zh";
	}
	// 韩文 Hangul
	if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) {
		return "unsupported";
	}
	// 西里尔、阿拉伯、泰文等非拉丁非 CJK → unsupported
	if (/[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/.test(text)) {
		return "unsupported";
	}
	// 拉丁文字（含法文/德文等带重音字符）统一视为 en
	return "en";
}

/**
 * 对每个片段进行中英日分离。
 * 扫描连续英文块，将其独立切出并标注 lang。
 * 含大量假名的段标记为 ja，其余 CJK 为主的段标记为 zh。
 */
function separateLanguages(parts: string[]): SplitSegment[] {
	const result: SplitSegment[] = [];

	for (const part of parts) {
		if (!isMostlyCJK(part)) {
			result.push({ text: part, lang: detectNonCJKLang(part) });
			continue;
		}

		// 含大量假名 → 整段标记为 ja，不再做中英分离
		if (isJapanese(part)) {
			result.push({ text: part, lang: "ja" });
			continue;
		}

		// 中文为主的段落，提取连续英文块独立成段
		let lastIndex = 0;
		const matches = [...part.matchAll(ENGLISH_BLOCK_RE)];

		for (const match of matches) {
			const matchStart = match.index!;
			const matchEnd = matchStart + match[0].length;
			const englishText = match[0].trim();

			// 短英文块留在中文段内，浏览器原生中文语音通常也能自然读出
			if (englishText.length < 20) continue;

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
	}

	return result;
}
