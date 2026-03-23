export interface VoiceConfig {
	speakerId?: string;
	speed?: number;
	pitch?: number;
}

export interface ITTSService {
	synthesize(text: string, config?: VoiceConfig): Promise<ArrayBuffer>;
}
