import type { ASRAudioInput, IASRService, ASRProviderDescriptor } from "./types";

export class MockASRService implements IASRService {
	readonly inputMode = "encoded" as const;
	readonly descriptor: ASRProviderDescriptor = {
		kind: "mock",
		label: "Mock ASR",
	};

	async transcribe(_audio: ASRAudioInput): Promise<string> {
		return "这是一个模拟的 ASR 结果。";
	}
}
