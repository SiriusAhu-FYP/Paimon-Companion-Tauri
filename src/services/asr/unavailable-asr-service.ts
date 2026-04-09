import type { ASRAudioInput, IASRService, ASRProviderDescriptor } from "./types";

export class UnavailableASRService implements IASRService {
	readonly inputMode = "encoded" as const;
	readonly descriptor: ASRProviderDescriptor;

	constructor(label: string) {
		this.descriptor = {
			kind: "configured",
			label,
		};
	}

	async transcribe(_audio: ASRAudioInput): Promise<string> {
		throw new Error(`${this.descriptor.label} 已配置，但真实麦克风/上传链路尚未接通`);
	}
}
