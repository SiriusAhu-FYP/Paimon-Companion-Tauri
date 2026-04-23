import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestActiveTextDecision, requestActiveVisionDecision } from "./cloud-decision";

const { proxyRequest, getConfig } = vi.hoisted(() => ({
	proxyRequest: vi.fn(),
	getConfig: vi.fn(),
}));

vi.mock("@/services/config", () => ({
	getConfig,
	proxyRequest,
	SECRET_KEYS: {
		LLM_API_KEY: (profileId: string) => `llm-api-key:${profileId}`,
	},
}));

vi.mock("@/services/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("cloud decision thinking policy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getConfig.mockReturnValue({
			activeLlmProfileId: "text-profile",
			activeVisionLlmProfileId: "vision-profile",
			llm: {
				provider: "openai-compatible",
				baseUrl: "https://api.example.com",
				model: "fallback-model",
				temperature: 0.2,
			},
			llmProfiles: [
				{
					id: "text-profile",
					provider: "openai-compatible",
					baseUrl: "https://api.deepseek.com",
					model: "deepseek-chat",
					temperature: 0.2,
				},
				{
					id: "vision-profile",
					provider: "openai-compatible",
					baseUrl: "https://vision.example.com",
					model: "gpt-4.1",
					temperature: 0.1,
				},
			],
		});
		proxyRequest.mockResolvedValue({
			status: 200,
			headers: {},
			body: JSON.stringify({
				choices: [{ message: { content: "{\"ok\":true}" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			}),
		});
	});

	it("disables thinking payload for vision requests", async () => {
		await requestActiveVisionDecision({
			systemPrompt: "system",
			userPrompt: "user",
			imageDataUrls: ["data:image/png;base64,aaa"],
			thinkingMode: "medium",
			jsonResponse: true,
		});

		expect(proxyRequest).toHaveBeenCalledTimes(1);
		const request = proxyRequest.mock.calls[0]?.[0];
		const payload = JSON.parse(request.body);
		expect(payload.model).toBe("gpt-4.1");
		expect(payload.reasoning).toBeUndefined();
		expect(payload.reasoning_effort).toBeUndefined();
		expect(payload.enable_thinking).toBeUndefined();
	});

	it("still enables DeepSeek reasoner path for text requests", async () => {
		await requestActiveTextDecision({
			systemPrompt: "system",
			userPrompt: "user",
			thinkingMode: "medium",
			jsonResponse: true,
		});

		expect(proxyRequest).toHaveBeenCalledTimes(1);
		const request = proxyRequest.mock.calls[0]?.[0];
		const payload = JSON.parse(request.body);
		expect(payload.model).toBe("deepseek-reasoner");
		expect(payload.reasoning_effort).toBe("medium");
		expect(payload.enable_thinking).toBe(true);
	});

	it("retries empty vision responses up to three attempts", async () => {
		proxyRequest
			.mockResolvedValueOnce({
				status: 200,
				headers: {},
				body: JSON.stringify({ choices: [{ message: { content: "" } }], usage: {} }),
			})
			.mockResolvedValueOnce({
				status: 200,
				headers: {},
				body: JSON.stringify({ choices: [{ message: { content: "   " } }], usage: {} }),
			})
			.mockResolvedValueOnce({
				status: 200,
				headers: {},
				body: JSON.stringify({
					choices: [{ message: { content: "{\"ok\":true}" } }],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				}),
			});

		await requestActiveVisionDecision({
			systemPrompt: "system",
			userPrompt: "user",
			imageDataUrls: ["data:image/png;base64,aaa"],
			jsonResponse: true,
		});

		expect(proxyRequest).toHaveBeenCalledTimes(3);
	});

	it("retries text requests after transient HTTP failure", async () => {
		proxyRequest
			.mockResolvedValueOnce({
				status: 503,
				headers: {},
				body: "temporary unavailable",
			})
			.mockResolvedValueOnce({
				status: 200,
				headers: {},
				body: JSON.stringify({
					choices: [{ message: { content: "{\"ok\":true}" } }],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				}),
			});

		await requestActiveTextDecision({
			systemPrompt: "system",
			userPrompt: "user",
			jsonResponse: true,
		});

		expect(proxyRequest).toHaveBeenCalledTimes(2);
	});
});
