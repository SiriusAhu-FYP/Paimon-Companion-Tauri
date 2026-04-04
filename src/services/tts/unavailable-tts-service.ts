import type { ITTSService, VoiceConfig } from "./types";

export class UnavailableTTSService implements ITTSService {
	readonly deliveryMode = "direct" as const;
	private label: string;

	constructor(label: string) {
		this.label = label;
	}

	async speakDirect(_text: string, _config?: VoiceConfig): Promise<void> {
		throw new Error(`${this.label} 还未接入当前 Tauri 运行时`);
	}
}
