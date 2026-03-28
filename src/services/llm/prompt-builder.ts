import type { CharacterProfile } from "@/types";
import type { ChatMessage } from "./types";

export interface PromptContext {
	characterProfile: CharacterProfile | null;
	knowledgeContext: string;
	customPersona: string;
}

/** 知识块过长时截断，避免撑爆上下文（粗略按字符计） */
const MAX_KNOWLEDGE_CHARS = 12000;

function truncateKnowledge(text: string): string {
	const t = text.trim();
	if (t.length <= MAX_KNOWLEDGE_CHARS) return t;
	return `${t.slice(0, MAX_KNOWLEDGE_CHARS)}\n\n[…知识上下文已截断…]`;
}

/**
 * 按约定优先级组装一条 system 消息；若无可注入内容则返回 null。
 * 优先级：卡内 system_prompt → persona → scenario → 自定义人设 → 商品/运营知识
 */
export function buildSystemMessage(ctx: PromptContext): ChatMessage | null {
	const sections: string[] = [];

	const sp = (ctx.characterProfile?.systemPrompt ?? "").trim();
	if (sp) {
		sections.push(`【角色系统指令】\n${sp}`);
	}

	const persona = (ctx.characterProfile?.persona ?? "").trim();
	if (persona) {
		sections.push(`【角色设定】\n${persona}`);
	}

	const scenario = (ctx.characterProfile?.scenario ?? "").trim();
	if (scenario) {
		sections.push(`【场景与世界观】\n${scenario}`);
	}

	const custom = (ctx.customPersona ?? "").trim();
	if (custom) {
		sections.push(`【附加人设】\n${custom}`);
	}

	const knowledge = truncateKnowledge(ctx.knowledgeContext ?? "");
	if (knowledge) {
		sections.push(`【当前商品与直播上下文】\n${knowledge}`);
	}

	if (!sections.length) return null;

	const content = `${sections.join("\n\n")}\n\n请严格按上述设定与上下文回复。`;
	const approxTokens = Math.ceil(content.length / 2);
	if (approxTokens > 8000) {
		// 二次保险：极端情况下再截整段尾部说明
		const maxChars = 16000;
		const body =
			content.length > maxChars ? `${content.slice(0, maxChars)}\n\n[…system 内容已截断…]` : content;
		return { role: "system", content: body };
	}

	return { role: "system", content };
}

/** 便于日志调试 */
export function summarizePromptContext(ctx: PromptContext): Record<string, unknown> {
	return {
		hasProfile: !!ctx.characterProfile,
		profileId: ctx.characterProfile?.id ?? null,
		systemPromptLen: (ctx.characterProfile?.systemPrompt ?? "").length,
		personaLen: (ctx.characterProfile?.persona ?? "").length,
		scenarioLen: (ctx.characterProfile?.scenario ?? "").length,
		customPersonaLen: (ctx.customPersona ?? "").length,
		knowledgeLen: (ctx.knowledgeContext ?? "").length,
	};
}
