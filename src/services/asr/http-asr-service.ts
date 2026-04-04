import { proxyMultipartRequest } from "@/services/config";
import { createLogger } from "@/services/logger";
import type { ASRAudioInput, IASRService, ASRProviderDescriptor } from "./types";

const log = createLogger("asr");

interface HttpASRServiceOptions {
	label: string;
	baseUrl: string;
	model: string;
	language: string;
	autoDetectLanguage: boolean;
	secretKey?: string | null;
	defaultPath: string;
	extraFields?: Record<string, string>;
}

function resolveEndpoint(baseUrl: string, defaultPath: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	if (!trimmed) {
		throw new Error("ASR 服务地址未配置");
	}
	if (
		trimmed.endsWith("/audio/transcriptions")
		|| trimmed.endsWith("/transcriptions")
		|| trimmed.endsWith("/transcribe")
	) {
		return trimmed;
	}
	if (trimmed.endsWith("/v1")) {
		return `${trimmed}/audio/transcriptions`;
	}
	return `${trimmed}${defaultPath}`;
}

function extractTranscript(body: string): string {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const text = parsed.text ?? parsed.result ?? parsed.transcript;
		if (typeof text === "string") {
			return text.trim();
		}
	} catch {
		// fall back to plain text
	}
	return body.trim();
}

abstract class BaseHttpASRService implements IASRService {
	readonly descriptor: ASRProviderDescriptor;
	protected readonly options: HttpASRServiceOptions;

	constructor(options: HttpASRServiceOptions) {
		this.options = options;
		this.descriptor = {
			kind: "configured",
			label: options.label,
		};
	}

	async transcribe(audio: ASRAudioInput): Promise<string> {
		const url = resolveEndpoint(this.options.baseUrl, this.options.defaultPath);
		const fields: Record<string, string> = {
			model: this.options.model || "whisper-1",
			...this.options.extraFields,
		};
		if (!this.options.autoDetectLanguage && this.options.language.trim()) {
			fields.language = this.options.language.trim();
		}

		log.info(`ASR upload -> ${this.options.label}`, {
			url,
			model: fields.model,
			language: fields.language ?? "auto",
		});

		const response = await proxyMultipartRequest({
			url,
			method: "POST",
			secretKey: this.options.secretKey ?? undefined,
			fields,
			file: {
				fieldName: "file",
				fileName: audio.fileName,
				mimeType: audio.mimeType,
				bytes: audio.data,
			},
		});

		if (response.status >= 400) {
			throw new Error(`HTTP ${response.status}: ${response.body}`);
		}

		const text = extractTranscript(response.body);
		if (!text) {
			throw new Error("ASR 返回为空");
		}
		return text;
	}
}

export class OpenAICompatibleASRService extends BaseHttpASRService {
	constructor(options: Omit<HttpASRServiceOptions, "label" | "defaultPath">) {
		super({
			...options,
			label: "OpenAI-compatible ASR",
			defaultPath: "/v1/audio/transcriptions",
		});
	}
}

export class FasterWhisperLocalASRService extends BaseHttpASRService {
	constructor(options: Omit<HttpASRServiceOptions, "label" | "defaultPath"> & {
		vadEnabled: boolean;
	}) {
		super({
			...options,
			label: "Faster-Whisper local sidecar",
			defaultPath: "/transcribe",
			extraFields: {
				...(options.extraFields ?? {}),
				vad_filter: options.vadEnabled ? "true" : "false",
			},
		});
	}
}
