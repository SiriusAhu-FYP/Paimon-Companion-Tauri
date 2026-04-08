import { getConfig, proxyRequest, SECRET_KEYS } from "@/services/config";
import { normalizeCompatibleOpenAIBaseUrl } from "@/services/games/game-utils";

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
}

export interface OpenAICompatibleVisionClientConfig {
	baseUrl: string;
	model: string;
	secretKey?: string;
}

export interface OpenAICompatibleVisionRequest {
	client: OpenAICompatibleVisionClientConfig;
	systemPrompt?: string;
	userPrompt: string;
	imageDataUrl: string;
	maxTokens: number;
	temperature?: number;
	timeoutMs?: number;
	jsonResponse?: boolean;
}

export function resolveActiveOpenAICompatibleVisionClient(): OpenAICompatibleVisionClientConfig | null {
	const config = getConfig();
	const activeProfile = config.activeLlmProfileId
		? config.llmProfiles.find((profile) => profile.id === config.activeLlmProfileId)
		: null;

	const provider = activeProfile?.provider ?? config.llm.provider;
	const baseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
	const model = activeProfile?.model ?? config.llm.model;
	const secretKey = activeProfile?.id ? SECRET_KEYS.LLM_API_KEY(activeProfile.id) : undefined;

	if (provider !== "openai-compatible" || !baseUrl || !model) {
		return null;
	}

	return {
		baseUrl: normalizeCompatibleOpenAIBaseUrl(baseUrl),
		model,
		secretKey,
	};
}

export async function requestOpenAICompatibleVision(request: OpenAICompatibleVisionRequest): Promise<string> {
	const response = await proxyRequest({
		url: `${normalizeCompatibleOpenAIBaseUrl(request.client.baseUrl)}/chat/completions`,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: request.client.model,
			temperature: request.temperature ?? 0.1,
			max_tokens: request.maxTokens,
			...(request.jsonResponse ? { response_format: { type: "json_object" } } : {}),
			messages: [
				...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
				{
					role: "user",
					content: [
						{
							type: "text",
							text: request.userPrompt,
						},
						{
							type: "image_url",
							image_url: {
								url: request.imageDataUrl,
							},
						},
					],
				},
			],
		}),
		secretKey: request.client.secretKey,
		timeoutMs: request.timeoutMs ?? 30_000,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`vision analysis failed with HTTP ${response.status}`);
	}

	const payload = JSON.parse(response.body) as OpenAIChatCompletionResponse;
	const rawContent = payload.choices?.[0]?.message?.content;
	const textContent = Array.isArray(rawContent)
		? rawContent.map((part) => part.text ?? "").join("")
		: rawContent ?? "";
	const normalized = textContent.trim();
	if (!normalized) {
		throw new Error("vision analysis returned empty content");
	}
	return normalized;
}
