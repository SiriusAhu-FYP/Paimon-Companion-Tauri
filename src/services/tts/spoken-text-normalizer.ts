/**
 * Spoken-text normalizer — 将显示文本转化为口播友好文本。
 * 在 LLM 回复之后、文本切片之前执行。
 * 规则以 rule table 模式组织，方便后续扩展。
 */

interface NormRule {
	pattern: RegExp;
	replacer: (match: string, ...groups: string[]) => string;
}

const DIGIT_CHARS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function digitToChar(d: string): string {
	return DIGIT_CHARS[parseInt(d, 10)] ?? d;
}

const UNITS = ["", "十", "百", "千"];
const BIG_UNITS = ["", "万", "亿"];

/**
 * 将整数转为中文读法（支持到亿级别）。
 * 超过 8 位的数字原样返回。
 */
function integerToChinese(numStr: string): string {
	const n = numStr.replace(/^0+/, "") || "0";
	if (n === "0") return "零";
	if (n.length > 8) return numStr;

	const digits = n.split("").reverse();
	const groups: string[][] = [];
	for (let i = 0; i < digits.length; i += 4) {
		groups.push(digits.slice(i, i + 4));
	}

	const parts: string[] = [];
	for (let g = groups.length - 1; g >= 0; g--) {
		const group = groups[g];
		let groupStr = "";
		let prevZero = false;

		for (let i = group.length - 1; i >= 0; i--) {
			const d = parseInt(group[i], 10);
			if (d === 0) {
				prevZero = true;
			} else {
				if (prevZero) {
					groupStr += "零";
					prevZero = false;
				}
				if (i === 1 && d === 1 && groupStr === "" && g === groups.length - 1) {
					groupStr += UNITS[i];
				} else {
					groupStr += DIGIT_CHARS[d] + UNITS[i];
				}
			}
		}

		if (groupStr) {
			parts.push(groupStr + BIG_UNITS[g]);
		}
	}

	return parts.join("") || "零";
}

function decimalPartToChinese(dec: string): string {
	return dec.split("").map(digitToChar).join("");
}

const RULES: NormRule[] = [
	// 百分比：50% -> 百分之五十
	{
		pattern: /(\d+(?:\.\d+)?)%/g,
		replacer: (_m, num) => {
			if (num.includes(".")) {
				const [int, dec] = num.split(".");
				return `百分之${integerToChinese(int)}点${decimalPartToChinese(dec)}`;
			}
			return `百分之${integerToChinese(num)}`;
		},
	},

	// 金额：¥100 -> 一百元
	{
		pattern: /¥(\d+(?:\.\d+)?)/g,
		replacer: (_m, num) => {
			if (num.includes(".")) {
				const [int, dec] = num.split(".");
				return `${integerToChinese(int)}元${decimalPartToChinese(dec)}`;
			}
			return `${integerToChinese(num)}元`;
		},
	},

	// 金额：$50 -> 五十美元
	{
		pattern: /\$(\d+(?:\.\d+)?)/g,
		replacer: (_m, num) => {
			if (num.includes(".")) {
				const [int, dec] = num.split(".");
				return `${integerToChinese(int)}点${decimalPartToChinese(dec)}美元`;
			}
			return `${integerToChinese(num)}美元`;
		},
	},

	// 时间：14:30 -> 十四点三十
	{
		pattern: /(\d{1,2}):(\d{2})/g,
		replacer: (_m, h, min) => {
			const hStr = integerToChinese(h);
			if (min === "00") return `${hStr}点`;
			return `${hStr}点${integerToChinese(min)}`;
		},
	},

	// 算术表达式：1+2=3 -> 一加二等于三（仅纯数字运算）
	{
		pattern: /(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/g,
		replacer: (_m, a, b, c) =>
			`${integerToChinese(a)}加${integerToChinese(b)}等于${integerToChinese(c)}`,
	},
	{
		pattern: /(\d+)\s*-\s*(\d+)\s*=\s*(\d+)/g,
		replacer: (_m, a, b, c) =>
			`${integerToChinese(a)}减${integerToChinese(b)}等于${integerToChinese(c)}`,
	},
	{
		pattern: /(\d+)\s*[×\*]\s*(\d+)\s*=\s*(\d+)/g,
		replacer: (_m, a, b, c) =>
			`${integerToChinese(a)}乘${integerToChinese(b)}等于${integerToChinese(c)}`,
	},
	{
		pattern: /(\d+)\s*[÷\/]\s*(\d+)\s*=\s*(\d+)/g,
		replacer: (_m, a, b, c) =>
			`${integerToChinese(a)}除以${integerToChinese(b)}等于${integerToChinese(c)}`,
	},

	// 独立等号：1=2 -> 一等于二
	{
		pattern: /(\d+)\s*=\s*(\d+)/g,
		replacer: (_m, a, b) => `${integerToChinese(a)}等于${integerToChinese(b)}`,
	},

	// 小数（非运算上下文）：3.14 -> 三点一四
	{
		pattern: /(?<![A-Za-z])(\d+)\.(\d+)(?![A-Za-z%])/g,
		replacer: (_m, int, dec) =>
			`${integerToChinese(int)}点${decimalPartToChinese(dec)}`,
	},

	// 独立整数（非英文上下文）：1234 -> 一千二百三十四
	{
		pattern: /(?<![A-Za-z.\d])(\d{1,8})(?![A-Za-z.\d:%])/g,
		replacer: (_m, num) => integerToChinese(num),
	},

	// 特殊符号
	{ pattern: /~/g, replacer: () => "约" },
	{ pattern: /×/g, replacer: () => "乘" },
	{ pattern: /÷/g, replacer: () => "除以" },
];

/**
 * 将显示文本转为口播文本。
 * 英文原样保留（交给 TTS 引擎处理），中文数字/符号转为口语形式。
 */
export function normalizeForSpeech(text: string): string {
	let result = text;
	for (const rule of RULES) {
		result = result.replace(rule.pattern, rule.replacer as (...args: string[]) => string);
	}
	return result;
}
