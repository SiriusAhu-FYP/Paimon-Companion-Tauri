import type { CharacterExpressionMap, CompanionEmotion } from "@/types";

export const COMPANION_EMOTIONS: CompanionEmotion[] = [
	"neutral",
	"happy",
	"angry",
	"sad",
	"delighted",
	"alarmed",
	"dazed",
];

const PAIMENG_VTS_MODEL = "/Resources/Commercial_models/paimengVts/3paimeng Vts.model3.json";
const BUNNY_MODEL = "/Resources/Commercial_models/英伦兔兔/英伦兔兔.model3.json";

export const DEFAULT_PROTOCOL_EXPRESSION_MAP: CharacterExpressionMap = {
	neutral: ["表情1"],
	happy: ["表情7"],
	angry: ["表情2", "表情6"],
	sad: ["表情5"],
	delighted: ["表情7", "表情6"],
	alarmed: ["表情4", "表情8"],
	dazed: ["表情3", "表情9"],
};

export const MODEL_EXPRESSION_PROTOCOLS: Record<string, CharacterExpressionMap> = {
	[PAIMENG_VTS_MODEL]: DEFAULT_PROTOCOL_EXPRESSION_MAP,
	[BUNNY_MODEL]: {
		neutral: ["123"],
		happy: ["Cat face", "Love"],
		angry: ["angry", "Black"],
		sad: ["Sluggish"],
		delighted: ["star", "Love"],
		alarmed: ["Crazy", "perspire"],
		dazed: ["Silly", "perspire", "Sluggish"],
	},
};

export function isCompanionEmotion(value: string): value is CompanionEmotion {
	return COMPANION_EMOTIONS.includes(value as CompanionEmotion);
}

export function resolveEmotionCandidates(
	activeModel: string | null,
	profileMap: CharacterExpressionMap | null | undefined,
	emotion: string,
): string[] {
	if (!isCompanionEmotion(emotion)) {
		return [emotion];
	}

	const modelCandidates = activeModel
		? MODEL_EXPRESSION_PROTOCOLS[activeModel]?.[emotion]
		: undefined;
	if (modelCandidates && modelCandidates.length > 0) {
		return [...modelCandidates];
	}

	const profileCandidates = profileMap?.[emotion];
	if (profileCandidates && profileCandidates.length > 0) {
		return [...profileCandidates];
	}

	return [emotion];
}

export function pickExpressionCandidate(candidates: string[]): string | null {
	if (candidates.length === 0) return null;
	const index = Math.floor(Math.random() * candidates.length);
	return candidates[index] ?? null;
}
