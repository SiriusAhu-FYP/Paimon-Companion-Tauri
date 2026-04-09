import { invoke } from "@tauri-apps/api/core";
import type { ASRAudioInput, IASRService, ASRProviderDescriptor } from "./types";

interface LocalSherpaTranscribeRequest {
	sampleRate: number;
	samples: number[];
}

interface LocalSherpaHealthResponse {
	label: string;
	modelName: string;
	modelDir: string;
}

export class LocalSherpaASRService implements IASRService {
	readonly inputMode = "pcm" as const;
	readonly descriptor: ASRProviderDescriptor = {
		kind: "local",
		label: "Local sherpa-onnx ASR",
	};

	async transcribe(audio: ASRAudioInput): Promise<string> {
		if (!audio.samples || !audio.sampleRate) {
			throw new Error("local sherpa ASR requires PCM samples and sample rate");
		}

		const request: LocalSherpaTranscribeRequest = {
			sampleRate: audio.sampleRate,
			samples: Array.from(audio.samples),
		};

		return invoke<string>("local_sherpa_transcribe", { request });
	}
}

export async function checkLocalSherpaHealth(): Promise<LocalSherpaHealthResponse> {
	return invoke<LocalSherpaHealthResponse>("local_sherpa_healthcheck");
}
