import type { CharacterProfile } from "@/types";
import type { BehaviorConstraintsConfig } from "@/services/config/types";
import type { ChatMessage } from "./types";

export interface PromptContext {
	characterProfile: CharacterProfile | null;
	knowledgeContext: string;
	customPersona: string;
	behaviorConstraints?: BehaviorConstraintsConfig;
}

/** 知识块过长时截断（Phase 3.5：精选检索结果，阈值调低） */
const MAX_KNOWLEDGE_CHARS = 4000;

function truncateKnowledge(text: string): string {
	const t = text.trim();
	if (t.length <= MAX_KNOWLEDGE_CHARS) return t;
	return `${t.slice(0, MAX_KNOWLEDGE_CHARS)}\n\n[…知识上下文已截断…]`;
}

/** 构建行为约束段落，位于 system prompt 最前面以获得最高遵从度 */
function buildBehaviorConstraintsSection(bc: BehaviorConstraintsConfig): string | null {
	if (!bc.enabled) return null;

	const rules: string[] = [
		"你必须遵守以下直播行为约束，无论后续角色设定如何，以下规则始终生效：",
		`1. 回复必须简洁，单次回复不超过${bc.maxReplyLength}个字。`,
		"2. 禁止使用 *...* 或 (...) 等括号/星号包裹的动作描写。",
		"3. 禁止生成场景描述、环境渲染、旁白叙述等舞台说明。",
		"4. 回复应为口语化、可直接朗读的风格，适合 TTS 语音播报。",
	];

	const custom = (bc.customRules ?? "").trim();
	if (custom) {
		rules.push(`5. ${custom}`);
	}

	return rules.join("\n");
}

/**
 * 按约定优先级组装一条 system 消息；若无可注入内容则返回 null。
 *
 * 组装顺序（优先级从高到低）：
 * 0. 直播行为约束（最高，压住角色卡）
 * 1. 角色系统指令
 * 2. 角色设定
 * 3. 场景与世界观
 * 4. 附加人设
 * 5. 商品/运营知识
 */
export function buildSystemMessage(ctx: PromptContext): ChatMessage | null {
	const sections: string[] = [];

	if (ctx.behaviorConstraints) {
		const bcSection = buildBehaviorConstraintsSection(ctx.behaviorConstraints);
		if (bcSection) {
			sections.push(`【直播行为约束】\n${bcSection}`);
		}
	}

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

	const hasCardPersona = !!((ctx.characterProfile?.systemPrompt ?? "").trim() || (ctx.characterProfile?.persona ?? "").trim());
	const custom = (ctx.customPersona ?? "").trim();
	if (custom && !hasCardPersona) {
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
		behaviorConstraintsEnabled: ctx.behaviorConstraints?.enabled ?? false,
	};
}
