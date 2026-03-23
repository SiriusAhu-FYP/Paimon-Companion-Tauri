export interface IASRService {
	recognize(audio: ArrayBuffer): Promise<string>;
}
