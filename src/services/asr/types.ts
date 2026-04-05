export interface ASRAudioInput {
	data: ArrayBuffer;
	mimeType: string;
	fileName: string;
	sampleRate?: number;
	samples?: Float32Array;
}

export type ASRInputMode = "encoded" | "pcm";

export interface IASRService {
	readonly inputMode: ASRInputMode;
	transcribe(audio: ASRAudioInput): Promise<string>;
}

export interface ASRProviderDescriptor {
	kind: "mock" | "local" | "cloud" | "configured";
	label: string;
}
