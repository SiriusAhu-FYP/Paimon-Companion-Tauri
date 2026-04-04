import type { IASRService, ASRProviderDescriptor } from "./types";

export class UnavailableASRService implements IASRService {
	readonly descriptor: ASRProviderDescriptor;

	constructor(label: string) {
		this.descriptor = {
			kind: "configured",
			label,
		};
	}

	async transcribe(_audio: ArrayBuffer): Promise<string> {
		throw new Error(`${this.descriptor.label} 已配置，但真实麦克风/上传链路尚未接通`);
	}
}
