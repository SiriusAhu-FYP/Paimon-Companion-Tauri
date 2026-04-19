import { getConfig, proxyRequest, SECRET_KEYS } from "@/services/config";
import { normalizeCompatibleOpenAIBaseUrl } from "./game-utils";

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
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

function resolveActiveOpenAICompatibleTextClient():
	| { baseUrl: string; model: string; temperature: number; secretKey?: string }
	| null {
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

export async function requestActiveTextDecision(input: {
	systemPrompt: string;
	userPrompt: string;
	maxTokens?: number;
	temperature?: number;
	timeoutMs?: number;
	jsonResponse?: boolean;
}): Promise<string> {
	const client = resolveActiveOpenAICompatibleTextClient();
	if (!client) {
		throw new Error("cloud decision requires an active openai-compatible LLM profile");
	}

	const response = await proxyRequest({
		url: `${client.baseUrl}/chat/completions`,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		secretKey: client.secretKey,
		body: JSON.stringify({
			model: client.model,
			temperature: input.temperature ?? client.temperature ?? 0.2,
			max_tokens: input.maxTokens ?? 320,
			response_format: input.jsonResponse ? { type: "json_object" } : undefined,
			messages: [
				{ role: "system", content: input.systemPrompt },
				{ role: "user", content: input.userPrompt },
			],
		}),
		timeoutMs: input.timeoutMs ?? 30_000,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`cloud decision request failed with HTTP ${response.status}`);
	}

	const parsed = JSON.parse(response.body) as OpenAIChatCompletionResponse;
	const content = extractMessageText(parsed);
	if (!content) {
		throw new Error("cloud decision returned empty content");
	}
	return content;
}
