import type { CharacterProfile } from "@/types";

/** SillyTavern chara_card_v2 根对象（最小字段） */
export interface SillyTavernV2Card {
	spec?: string;
	spec_version?: string;
	data?: SillyTavernV2CardData;
}

export interface SillyTavernV2CardData {
	name?: string;
	description?: string;
	personality?: string;
	scenario?: string;
	first_mes?: string;
	mes_example?: string;
	system_prompt?: string;
}

function slugFromFilename(filename: string): string {
	const base = filename.replace(/\.json$/i, "");
	return base || "character";
}

function mergePersona(description: string, personality: string): string {
	const d = description.trim();
	const p = personality.trim();
	if (d && p) return `${d}\n\n${p}`;
	return d || p;
}

/**
 * 将 SillyTavern V2 JSON 映射为内部 CharacterProfile。
 * 不解析 character_book / lorebook / extensions。
 */
export function parseSillyTavernV2ToProfile(
	raw: unknown,
	options: { sourceFile: string; defaultExpressionMap: Record<string, string> },
): CharacterProfile {
	const card = raw as SillyTavernV2Card;
	if (card?.spec !== "chara_card_v2" || !card.data) {
		throw new Error(`not a chara_card_v2 JSON: ${options.sourceFile}`);
	}

	const d = card.data;
	const name = (d.name ?? "Character").trim() || "Character";
	const id = slugFromFilename(options.sourceFile);

	const persona = mergePersona(d.description ?? "", d.personality ?? "");

	return {
		id,
		name,
		persona,
		scenario: (d.scenario ?? "").trim(),
		firstMessage: (d.first_mes ?? "").trim(),
		messageExamples: (d.mes_example ?? "").trim(),
		systemPrompt: (d.system_prompt ?? "").trim(),
		defaultEmotion: "neutral",
		expressionMap: { ...options.defaultExpressionMap },
		source: "sillytavern-v2",
		sourceFile: options.sourceFile,
	};
}
