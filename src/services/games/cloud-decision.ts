import { getConfig, proxyRequest, SECRET_KEYS } from "@/services/config";
import { normalizeCompatibleOpenAIBaseUrl } from "./game-utils";

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
}

interface OpenAICompatibleClientConfig {
	baseUrl: string;
	model: string;
	temperature: number;
	secretKey?: string;
}

function isLikelyTextOnlyModel(client: OpenAICompatibleClientConfig): boolean {
	const normalizedBaseUrl = client.baseUrl.toLowerCase();
	const normalizedModel = client.model.toLowerCase();
	if (normalizedBaseUrl.includes("api.deepseek.com")) {
		return normalizedModel === "deepseek-chat" || normalizedModel === "deepseek-reasoner";
	}
	return false;
}

export type CloudThinkingMode = "off" | "low" | "medium" | "high";

class CloudDecisionHttpError extends Error {
	status: number;
	constructor(scope: "cloud decision" | "cloud vision decision", status: number) {
		super(`${scope} request failed with HTTP ${status}`);
		this.status = status;
		this.name = "CloudDecisionHttpError";
	}
}

function extractMessageText(response: OpenAIChatCompletionResponse): string {
	const content = response.choices?.[0]?.message?.content;
	if (typeof content === "string") {
		return content.trim();
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part.text === "string" ? part.text : ""))
			.join("\n")
			.trim();
	}
	return "";
}

function resolveActiveOpenAICompatibleClient(): OpenAICompatibleClientConfig | null {
	const config = getConfig();
	const activeProfile = config.activeLlmProfileId
		? config.llmProfiles.find((profile) => profile.id === config.activeLlmProfileId)
		: null;

	const provider = activeProfile?.provider ?? config.llm.provider;
	if (provider !== "openai-compatible") {
		return null;
	}

	const baseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
	const model = activeProfile?.model ?? config.llm.model;
	const temperature = activeProfile?.temperature ?? config.llm.temperature;
	const secretKey = activeProfile ? SECRET_KEYS.LLM_API_KEY(activeProfile.id) : undefined;

	if (!baseUrl || !model) {
		return null;
	}

	return {
		baseUrl: normalizeCompatibleOpenAIBaseUrl(baseUrl),
		model,
		temperature,
		secretKey,
	};
}

function resolveActiveVisionOpenAICompatibleClient(): OpenAICompatibleClientConfig | null {
	const config = getConfig();
	const activeProfileId = config.activeVisionLlmProfileId || config.activeLlmProfileId;
	const activeProfile = activeProfileId
		? config.llmProfiles.find((profile) => profile.id === activeProfileId)
		: null;

	const provider = activeProfile?.provider ?? config.llm.provider;
	if (provider !== "openai-compatible") {
		return null;
	}

	const baseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
	const model = activeProfile?.model ?? config.llm.model;
	const temperature = activeProfile?.temperature ?? config.llm.temperature;
	const secretKey = activeProfile ? SECRET_KEYS.LLM_API_KEY(activeProfile.id) : undefined;

	if (!baseUrl || !model) {
		return null;
	}

	return {
		baseUrl: normalizeCompatibleOpenAIBaseUrl(baseUrl),
		model,
		temperature,
		secretKey,
	};
}

function resolveThinkingPayload(thinkingMode: CloudThinkingMode | undefined): Record<string, unknown> {
	if (!thinkingMode || thinkingMode === "off") {
		return {};
	}
	const effort = thinkingMode;
	return {
		reasoning: { effort },
		reasoning_effort: effort,
		enable_thinking: true,
	};
}

async function requestCompletionWithOptionalThinking(input: {
	scope: "cloud decision" | "cloud vision decision";
	client: OpenAICompatibleClientConfig;
	basePayload: Record<string, unknown>;
	timeoutMs: number;
	thinkingMode?: CloudThinkingMode;
}): Promise<OpenAIChatCompletionResponse> {
	const thinkingPayload = resolveThinkingPayload(input.thinkingMode);
	const payloadWithThinking = Object.keys(thinkingPayload).length
		? { ...input.basePayload, ...thinkingPayload }
		: input.basePayload;
	try {
		return await requestCompletion(input.scope, input.client, payloadWithThinking, input.timeoutMs);
	} catch (error) {
		if (!(error instanceof CloudDecisionHttpError) || !Object.keys(thinkingPayload).length) {
			throw error;
		}
		return requestCompletion(input.scope, input.client, input.basePayload, input.timeoutMs);
	}
}

async function requestCompletion(
	scope: "cloud decision" | "cloud vision decision",
	client: OpenAICompatibleClientConfig,
	payload: Record<string, unknown>,
	timeoutMs: number,
): Promise<OpenAIChatCompletionResponse> {
	const response = await proxyRequest({
		url: `${client.baseUrl}/chat/completions`,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		secretKey: client.secretKey,
		body: JSON.stringify(payload),
		timeoutMs,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new CloudDecisionHttpError(scope, response.status);
	}

	return JSON.parse(response.body) as OpenAIChatCompletionResponse;
}

export async function requestActiveTextDecision(input: {
	systemPrompt: string;
	userPrompt: string;
	maxTokens?: number;
	temperature?: number;
	timeoutMs?: number;
	jsonResponse?: boolean;
	thinkingMode?: CloudThinkingMode;
}): Promise<string> {
	const client = resolveActiveOpenAICompatibleClient();
	if (!client) {
		throw new Error("cloud decision requires an active openai-compatible LLM profile");
	}

	const parsed = await requestCompletionWithOptionalThinking({
		scope: "cloud decision",
		client,
		timeoutMs: input.timeoutMs ?? 30_000,
		thinkingMode: input.thinkingMode,
		basePayload: {
			model: client.model,
			temperature: input.temperature ?? client.temperature ?? 0.2,
			max_tokens: input.maxTokens ?? 320,
			response_format: input.jsonResponse ? { type: "json_object" } : undefined,
			messages: [
				{ role: "system", content: input.systemPrompt },
				{ role: "user", content: input.userPrompt },
			],
		},
	});
	const content = extractMessageText(parsed);
	if (!content) {
		throw new Error("cloud decision returned empty content");
	}
	return content;
}

export async function requestActiveVisionDecision(input: {
	systemPrompt: string;
	userPrompt: string;
	imageDataUrls: string[];
	maxTokens?: number;
	temperature?: number;
	timeoutMs?: number;
	jsonResponse?: boolean;
	thinkingMode?: CloudThinkingMode;
}): Promise<string> {
	const client = resolveActiveVisionOpenAICompatibleClient();
	if (!client) {
		throw new Error("cloud vision decision requires an active openai-compatible LLM profile");
	}

	const imageDataUrls = input.imageDataUrls.map((item) => item.trim()).filter(Boolean);
	if (!imageDataUrls.length) {
		throw new Error("cloud vision decision requires at least one image");
	}
	if (isLikelyTextOnlyModel(client)) {
		throw new Error(`cloud vision decision requires a vision-capable model; current active model is ${client.model}`);
	}

	const parsed = await requestCompletionWithOptionalThinking({
		scope: "cloud vision decision",
		client,
		timeoutMs: input.timeoutMs ?? 30_000,
		thinkingMode: input.thinkingMode,
		basePayload: {
			model: client.model,
			temperature: input.temperature ?? client.temperature ?? 0.1,
			max_tokens: input.maxTokens ?? 360,
			response_format: input.jsonResponse ? { type: "json_object" } : undefined,
			messages: [
				{ role: "system", content: input.systemPrompt },
				{
					role: "user",
					content: [
						{ type: "text", text: input.userPrompt },
						...imageDataUrls.map((url) => ({
							type: "image_url",
							image_url: { url },
						})),
					],
				},
			],
		},
	});
	const content = extractMessageText(parsed);
	if (!content) {
		throw new Error("cloud vision decision returned empty content");
	}
	return content;
}
