export interface VoiceConfig {
	speakerId?: string;
	speed?: number;
	pitch?: number;
	/** 语言标签，由 text-splitter 中英分离产生，覆盖 provider 默认 textLang */
	lang?: string;
}

export interface ITTSService {
	synthesize(text: string, config?: VoiceConfig): Promise<ArrayBuffer>;
}
