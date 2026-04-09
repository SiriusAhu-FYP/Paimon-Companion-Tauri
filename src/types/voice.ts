export type VoiceInputStatus =
	| "idle"
	| "requesting-permission"
	| "listening"
	| "recording"
	| "transcribing"
	| "locked"
	| "error";

export interface VoiceInputState {
	enabled: boolean;
	status: VoiceInputStatus;
	permission: "unknown" | "granted" | "denied";
	providerLabel: string;
	playbackLocked: boolean;
	lastTranscript: string | null;
	lastError: string | null;
}
