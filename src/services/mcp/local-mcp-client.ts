import { proxyRequest } from "@/services/config/http-proxy";
import type { EventBus } from "@/services/event-bus";

const LOCAL_MCP_URL = "http://127.0.0.1:31430/mcp";
let eventBus: EventBus | null = null;

interface McpJsonRpcResponse {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: {
		message?: string;
	};
}

export function setLocalMcpEventBus(bus: EventBus) {
	eventBus = bus;
}

export async function callLocalMcpTool(name: string, args: Record<string, unknown>) {
	eventBus?.emit("mcp:tool-start", { name, args });
	const response = await proxyRequest({
		url: LOCAL_MCP_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method: "tools/call",
			params: {
				name,
				arguments: args,
			},
		}),
		timeoutMs: 30_000,
	});

	if (response.status < 200 || response.status >= 300) {
		eventBus?.emit("mcp:tool-complete", {
			name,
			ok: false,
			resultPreview: "",
			error: `HTTP ${response.status}: ${response.body}`,
		});
		throw new Error(`MCP HTTP ${response.status}: ${response.body}`);
	}

	let payload: McpJsonRpcResponse;
	try {
		payload = JSON.parse(response.body) as McpJsonRpcResponse;
	} catch {
		throw new Error(`invalid MCP response: ${response.body}`);
	}

	if (payload.error?.message) {
		eventBus?.emit("mcp:tool-complete", {
			name,
			ok: false,
			resultPreview: "",
			error: payload.error.message,
		});
		throw new Error(payload.error.message);
	}

	const text = payload.result?.content?.map((item) => item.text ?? "").join("\n").trim() ?? "";
	const isError = payload.result?.isError ?? false;
	if (isError) {
		eventBus?.emit("mcp:tool-complete", {
			name,
			ok: false,
			resultPreview: text.slice(0, 200),
			error: text || `MCP tool failed: ${name}`,
		});
		throw new Error(text || `MCP tool failed: ${name}`);
	}

	eventBus?.emit("mcp:tool-complete", {
		name,
		ok: true,
		resultPreview: text.slice(0, 200),
		error: null,
	});
	return text;
}

export async function callLocalMcpToolJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const text = await callLocalMcpTool(name, args);
	if (!text) {
		throw new Error(`empty MCP tool response for ${name}`);
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`invalid JSON MCP tool response for ${name}: ${text}`);
	}
}
