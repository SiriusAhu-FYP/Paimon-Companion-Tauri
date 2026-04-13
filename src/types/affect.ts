import type { CompanionEmotion } from "./character";

export type AffectEventSource = "mcp" | "unified-runtime" | "manual" | "system";

export interface AffectState {
	currentEmotion: CompanionEmotion;
	intensity: number;
	carryEmotion: CompanionEmotion;
	carryIntensity: number;
	presentationEmotion: CompanionEmotion;
	isHeldForSpeech: boolean;
	lastReason: string;
	lastSource: AffectEventSource;
	updatedAt: number;
}

export interface ApplyEmotionInput {
	emotion: CompanionEmotion;
	source: AffectEventSource;
	reason: string;
	holdForSpeech?: boolean;
}

export interface ResetAffectInput {
	source: AffectEventSource;
	reason: string;
}
