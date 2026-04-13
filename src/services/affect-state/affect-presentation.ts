import type { AffectState } from "@/types";
import type { VoiceConfig } from "@/services/tts";

export type UserInputSource = "manual" | "voice" | "system";

export function buildAffectPromptSummary(
	state: AffectState,
	options?: {
		inputSource?: UserInputSource;
		recentInteractionContext?: string;
	},
): string {
	const replyHints = resolveReplyStyleHints(state);
	const speechHints = resolveSpeechDeliveryHints(state);
	const inputSource = options?.inputSource ?? "manual";

	const sections = [
		`当前主情感：${state.currentEmotion}（强度 ${state.intensity.toFixed(2)}）`,
		`当前表现情感：${state.presentationEmotion}`,
		`短时 carry 情感：${state.carryEmotion}（强度 ${state.carryIntensity.toFixed(2)}）`,
		`语音保持：${state.isHeldForSpeech ? "是" : "否"}`,
		`最近触发来源：${state.lastSource}`,
		`最近触发原因：${state.lastReason}`,
		`本轮输入来源：${inputSource}`,
		`回复风格提示：${replyHints.join("；")}`,
		`语音播报提示：${speechHints.join("；")}`,
	];

	const recentInteraction = options?.recentInteractionContext?.trim();
	if (recentInteraction) {
		sections.push(`最近互动摘要：\n${recentInteraction}`);
	}

	return sections.join("\n");
}

export function resolveReplyStyleHints(state: AffectState): string[] {
	switch (state.presentationEmotion) {
		case "happy":
		case "delighted":
			return ["语气更明快", "优先短句", "允许轻微兴奋感，但不要失控"];
		case "sad":
			return ["语气更轻柔", "优先安抚式表达", "避免夸张兴奋"];
		case "angry":
			return ["语气应有力度", "保持克制，不攻击用户", "优先明确态度"];
		case "alarmed":
			return ["语气更警觉", "优先说明风险或不确定性", "避免玩笑化处理"];
		case "dazed":
			return ["语气略带迟疑", "优先承认看不清或不确定", "避免装作完全确定"];
		case "neutral":
		default:
			return ["语气自然", "简洁可朗读", "保持陪伴感"];
	}
}

export function resolveSpeechDeliveryHints(state: AffectState): string[] {
	switch (state.presentationEmotion) {
		case "happy":
		case "delighted":
			return ["节奏略快", "音调略高", "保持轻快"];
		case "sad":
			return ["节奏略慢", "音调略低", "保持柔和"];
		case "angry":
			return ["节奏稳一点", "音量感更集中", "避免拖沓"];
		case "alarmed":
			return ["节奏略快", "更紧凑", "避免过长停顿"];
		case "dazed":
			return ["节奏略慢", "保留迟疑感", "句子不要太长"];
		case "neutral":
		default:
			return ["正常节奏", "正常音调", "保持清晰"];
	}
}

export function resolveSpeechVoiceConfig(state: AffectState): VoiceConfig {
	switch (state.presentationEmotion) {
		case "happy":
			return { speed: 1.06, pitch: 1.05 };
		case "delighted":
			return { speed: 1.1, pitch: 1.08 };
		case "sad":
			return { speed: 0.94, pitch: 0.96 };
		case "angry":
			return { speed: 1.02, pitch: 0.98 };
		case "alarmed":
			return { speed: 1.08, pitch: 1.02 };
		case "dazed":
			return { speed: 0.92, pitch: 0.97 };
		case "neutral":
		default:
			return {};
	}
}
