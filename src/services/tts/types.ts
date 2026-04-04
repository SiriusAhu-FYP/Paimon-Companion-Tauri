export interface VoiceConfig {
	speakerId?: string;
	speed?: number;
	pitch?: number;
	/** 语言标签，由 text-splitter 中英分离产生，覆盖 provider 默认 textLang */
	lang?: string;
}

export interface DirectSpeakHooks {
	onMouthData?: (value: number) => void;
}

export type TTSDeliveryMode = "buffer" | "direct";

export interface ITTSService {
	readonly deliveryMode: TTSDeliveryMode;
	synthesize?(text: string, config?: VoiceConfig): Promise<ArrayBuffer>;
	speakDirect?(text: string, config?: VoiceConfig, hooks?: DirectSpeakHooks): Promise<void>;
	stop?(): void;
}
