import type { IASRService, ASRProviderDescriptor } from "./types";

export class MockASRService implements IASRService {
	readonly descriptor: ASRProviderDescriptor = {
		kind: "mock",
		label: "Mock ASR",
	};

	async transcribe(_audio: ArrayBuffer): Promise<string> {
		return "这是一个模拟的 ASR 结果。";
	}
}
