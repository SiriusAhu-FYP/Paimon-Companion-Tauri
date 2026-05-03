import { getConfig } from "@/services/config/config-service";

export type ReplyLanguageMode = "zh" | "en";

export function getReplyLanguageMode(): ReplyLanguageMode {
	return getConfig().locale === "en" ? "en" : "zh";
}

export function pickReplyLanguageText(zhText: string, enText: string): string {
	return getReplyLanguageMode() === "en" ? enText : zhText;
}

export function buildConversationReplyLanguageInstruction(): string {
	if (getReplyLanguageMode() === "en") {
		return [
			"Current reply language mode: English (en).",
			"You must reply in natural English.",
			"Only switch language when the user explicitly requests translation or a language change.",
		].join("\n");
	}
	return [
		"当前回复语言模式：简体中文（zh）。",
		"你必须使用简体中文回复。",
		"仅当用户明确要求翻译或切换语言时，才切换到其他语言。",
	].join("\n");
}

export function buildStructuredReplyLanguageInstruction(options?: {
	jsonResponse?: boolean;
	languageMode?: ReplyLanguageMode;
}): string {
	const jsonHint = options?.jsonResponse
		? "If you output JSON, keep keys, enums, booleans, and tool names unchanged; only localize natural-language text values."
		: "";
	const languageMode = options?.languageMode ?? getReplyLanguageMode();
	if (languageMode === "en") {
		return [
			"Reply language mode: English (en).",
			"Use English for every natural-language sentence you generate.",
			"Only switch language when the user explicitly requests translation or a language change.",
			jsonHint,
		].filter(Boolean).join("\n");
	}
	return [
		"Reply language mode: Simplified Chinese (zh).",
		"Use Simplified Chinese for every natural-language sentence you generate.",
		"Only switch language when the user explicitly requests translation or a language change.",
		jsonHint,
	].filter(Boolean).join("\n");
}
