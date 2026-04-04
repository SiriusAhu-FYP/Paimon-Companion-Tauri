export interface ASRAudioInput {
	data: ArrayBuffer;
	mimeType: string;
	fileName: string;
}

export interface IASRService {
	transcribe(audio: ASRAudioInput): Promise<string>;
}

export interface ASRProviderDescriptor {
	kind: "mock" | "configured";
	label: string;
}
