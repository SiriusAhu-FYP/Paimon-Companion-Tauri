export interface IASRService {
	transcribe(audio: ArrayBuffer): Promise<string>;
}

export interface ASRProviderDescriptor {
	kind: "mock" | "configured";
	label: string;
}
