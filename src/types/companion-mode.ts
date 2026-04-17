export type CompanionInteractionMode = "companion" | "delegated";

export type CompanionModeSource = "manual" | "system";

export interface CompanionModeState {
	mode: CompanionInteractionMode;
	preferredMode: CompanionInteractionMode;
	lastReason: string;
	lastSource: CompanionModeSource;
	updatedAt: number;
}
