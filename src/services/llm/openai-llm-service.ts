/**
 * OpenAI 兼容 LLM 服务实现。
 * 通过 Rust SSE 代理（Tauri）或前端直接 fetch（浏览器 dev）调用 /v1/chat/completions。
 * 支持流式响应 + function/tool calling。
 */

import type { ChatMessage, ToolDef, LLMChunk, ILLMService } from "./types";
import type { LLMProviderConfig } from "@/services/config/types";
import { SECRET_KEYS } from "@/services/config/types";
import { proxySSERequest } from "@/services/config/http-proxy";
import { isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("openai-llm");

interface OpenAIDelta {
	role?: string;
	content?: string | null;
	tool_calls?: Array<{
		index: number;
		id?: string;
		type?: string;
		function?: { name?: string; arguments?: string };
	}>;
}

interface OpenAISSEPayload {
	choices?: Array<{
		index: number;
		delta: OpenAIDelta;
		finish_reason: string | null;
	}>;
	error?: { message: string };
}

export class OpenAILLMService implements ILLMService {
	private config: LLMProviderConfig;

	constructor(config: LLMProviderConfig) {
		this.config = config;
		log.info("initialized", { baseUrl: config.baseUrl, model: config.model });
	}

	async *chat(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<LLMChunk> {
		const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

		const openaiTools = tools?.length
			? tools.map((t) => ({
				type: "function" as const,
				function: { name: t.name, description: t.description, parameters: t.parameters },
			}))
			: undefined;

		const requestBody = JSON.stringify({
			model: this.config.model,
			messages,
			temperature: this.config.temperature,
			max_tokens: this.config.maxTokens,
			stream: true,
			...(openaiTools ? { tools: openaiTools } : {}),
		});

		log.info(`request: ${this.config.model}, ${messages.length} messages`);

		// 将 callback 驱动的 SSE 流转换为 AsyncGenerator
		const chunks: LLMChunk[] = [];
		let done = false;
		let error: string | null = null;
		let resolve: (() => void) | null = null;

		const wake = () => {
			if (resolve) {
				resolve();
				resolve = null;
			}
		};
		const waitForData = () => new Promise<void>((r) => { resolve = r; });

		const sseOptions = {
			url,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: requestBody,
			secretKey: SECRET_KEYS.LLM_API_KEY,
		};

		let fullText = "";
		let sseBuffer = "";
		// 跟踪累积的 tool call 参数片段
		const pendingToolCalls: Map<number, { name: string; argsBuffer: string }> = new Map();

		const processSSELine = (line: string) => {
			if (!line.startsWith("data: ")) return;
			const dataStr = line.slice(6).trim();
			if (dataStr === "[DONE]") return;

			try {
				const payload = JSON.parse(dataStr) as OpenAISSEPayload;

				if (payload.error) {
					error = payload.error.message;
					wake();
					return;
				}

				const choice = payload.choices?.[0];
				if (!choice) return;

				const delta = choice.delta;

				if (delta.content) {
					fullText += delta.content;
					chunks.push({ type: "delta", text: delta.content });
					wake();
				}

				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						let pending = pendingToolCalls.get(tc.index);
						if (!pending) {
							pending = { name: "", argsBuffer: "" };
							pendingToolCalls.set(tc.index, pending);
						}
						if (tc.function?.name) {
							pending.name = tc.function.name;
						}
						if (tc.function?.arguments) {
							pending.argsBuffer += tc.function.arguments;
						}
					}
				}

				if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
					// 在 finish 时发射完整的 tool calls
					for (const [, tc] of pendingToolCalls) {
						if (tc.name) {
							let args: Record<string, unknown> = {};
							try { args = JSON.parse(tc.argsBuffer); } catch { /* malformed args */ }
							chunks.push({ type: "tool-call", name: tc.name, args });
							wake();
						}
					}
					pendingToolCalls.clear();
				}
			} catch {
				log.warn("failed to parse SSE frame", dataStr.slice(0, 80));
			}
		};

		const onChunk = (rawChunk: string) => {
			sseBuffer += rawChunk;
			// SSE 帧以 \n\n 分隔，但 Rust 按字节流推送，需自行切分
			let idx: number;
			while ((idx = sseBuffer.indexOf("\n")) !== -1) {
				const line = sseBuffer.slice(0, idx).trim();
				sseBuffer = sseBuffer.slice(idx + 1);
				if (line) processSSELine(line);
			}
		};

		const onError = (msg: string, status?: number) => {
			error = status ? `HTTP ${status}: ${msg}` : msg;
			log.error("SSE error", error);
			wake();
		};

		const onDone = () => {
			// 处理 buffer 中可能残留的最后一行
			const remaining = sseBuffer.trim();
			if (remaining) processSSELine(remaining);

			if (!chunks.some((c) => c.type === "done")) {
				chunks.push({ type: "done", fullText });
			}
			done = true;
			wake();
		};

		// 根据环境选择 SSE 传输路径
		let cleanup: (() => void) | null = null;

		if (isTauriEnvironment()) {
			cleanup = await proxySSERequest(sseOptions, onChunk, onError, onDone);
		} else {
			this.directSSEFetch(sseOptions, onChunk, onError, onDone);
		}

		try {
			while (!done) {
				if (error) {
					throw new Error(error);
				}
				while (chunks.length > 0) {
					const chunk = chunks.shift()!;
					yield chunk;
					if (chunk.type === "done") {
						done = true;
						return;
					}
				}
				if (!done && !error) {
					await waitForData();
				}
			}
			// drain remaining
			while (chunks.length > 0) {
				yield chunks.shift()!;
			}
		} finally {
			cleanup?.();
		}
	}

	/**
	 * 非 Tauri 环境降级：通过 fetch + ReadableStream 直接读取 SSE。
	 * 此路径不从 keyring 注入密钥——浏览器 dev 模式下密钥需通过其他方式提供。
	 */
	private directSSEFetch(
		options: { url: string; headers: Record<string, string>; body: string },
		onChunk: (data: string) => void,
		onError: (msg: string, status?: number) => void,
		onDone: () => void,
	): void {
		(async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30000);
			try {
				const resp = await fetch(options.url, {
					method: "POST",
					headers: options.headers,
					body: options.body,
					signal: controller.signal,
				});

				if (!resp.ok) {
					const body = await resp.text();
					onError(body, resp.status);
					onDone();
					return;
				}

				const reader = resp.body?.getReader();
				if (!reader) {
					onError("response body not readable");
					onDone();
					return;
				}

				const decoder = new TextDecoder();
				while (true) {
					const { done: readerDone, value } = await reader.read();
					if (readerDone) break;
					onChunk(decoder.decode(value, { stream: true }));
				}
				onDone();
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") {
					onError("request timed out after 30s");
				} else {
					onError(err instanceof Error ? err.message : String(err));
				}
				onDone();
			} finally {
				clearTimeout(timeout);
			}
		})();
	}
}
