import { proxyRequest } from "@/services/config/http-proxy";
import type { EventBus } from "@/services/event-bus";

const LOCAL_MCP_URL = "http://127.0.0.1:31430/mcp";
let eventBus: EventBus | null = null;
const TOOLS_LIST_CACHE_TTL_MS = 15_000;
let toolsListCache: {
	expiresAt: number;
	tools: RuntimeMcpToolDescriptor[];
} | null = null;

interface McpJsonRpcResponse<T> {
	result?: T;
	error?: {
		message?: string;
	};
}

interface McpToolCallResult {
	content?: Array<{ type?: string; text?: string }>;
	isError?: boolean;
}

interface McpToolsListResult {
	tools?: Array<{
		name?: unknown;
		description?: unknown;
		inputSchema?: unknown;
	}>;
}

export interface RuntimeMcpToolDescriptor {
	name: string;
	description: string;
	inputSchema: Record<string, unknown> | null;
}

interface McpRpcRequestOptions {
	timeoutMs: number;
}

async function requestLocalMcpRpc<T>(
	method: string,
	params: Record<string, unknown>,
	options: McpRpcRequestOptions,
): Promise<T> {
	const response = await proxyRequest({
		url: LOCAL_MCP_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method,
			params,
		}),
		timeoutMs: options.timeoutMs,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`MCP HTTP ${response.status}: ${response.body}`);
	}

	let payload: McpJsonRpcResponse<T>;
	try {
		payload = JSON.parse(response.body) as McpJsonRpcResponse<T>;
	} catch {
		throw new Error(`invalid MCP response: ${response.body}`);
	}

	if (payload.error?.message) {
		throw new Error(payload.error.message);
	}
	if (payload.result === undefined) {
		throw new Error(`empty MCP result for ${method}`);
	}
	return payload.result;
}

function sanitizeInputSchema(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

export async function listLocalMcpTools(options?: {
	timeoutMs?: number;
	forceRefresh?: boolean;
}): Promise<RuntimeMcpToolDescriptor[]> {
	if (!options?.forceRefresh && toolsListCache && Date.now() < toolsListCache.expiresAt) {
		return toolsListCache.tools.map((tool) => ({ ...tool }));
	}
	const result = await requestLocalMcpRpc<McpToolsListResult>(
		"tools/list",
		{},
		{ timeoutMs: options?.timeoutMs ?? 10_000 },
	);
	const tools = Array.isArray(result.tools)
		? result.tools
			.map((entry): RuntimeMcpToolDescriptor | null => {
				const name = typeof entry.name === "string" ? entry.name.trim() : "";
				if (!name) {
					return null;
				}
				return {
					name,
					description: typeof entry.description === "string" ? entry.description : "",
					inputSchema: sanitizeInputSchema(entry.inputSchema),
				};
			})
			.filter((entry): entry is RuntimeMcpToolDescriptor => entry !== null)
		: [];
	toolsListCache = {
		expiresAt: Date.now() + TOOLS_LIST_CACHE_TTL_MS,
		tools,
	};
	return tools.map((tool) => ({ ...tool }));
}

export function clearLocalMcpToolsCache() {
	toolsListCache = null;
}

export function setLocalMcpEventBus(bus: EventBus) {
	eventBus = bus;
}

export async function callLocalMcpTool(
	name: string,
	args: Record<string, unknown>,
	options?: {
		traceId?: string;
		timeoutMs?: number;
	},
) {
	eventBus?.emit("mcp:tool-start", { name, args, traceId: options?.traceId });
	let payload: McpToolCallResult;
	try {
		payload = await requestLocalMcpRpc<McpToolCallResult>(
			"tools/call",
			{
				name,
				arguments: args,
			},
			{ timeoutMs: options?.timeoutMs ?? 30_000 },
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		eventBus?.emit("mcp:tool-complete", {
			name,
			ok: false,
			resultPreview: "",
			error: message,
			traceId: options?.traceId,
		});
		throw error;
	}

	const text = payload.content?.map((item) => item.text ?? "").join("\n").trim() ?? "";
	const isError = payload.isError ?? false;
	if (isError) {
		eventBus?.emit("mcp:tool-complete", {
			name,
			ok: false,
			resultPreview: text.slice(0, 200),
			error: text || `MCP tool failed: ${name}`,
			traceId: options?.traceId,
		});
		throw new Error(text || `MCP tool failed: ${name}`);
	}

	eventBus?.emit("mcp:tool-complete", {
		name,
		ok: true,
		resultPreview: text.slice(0, 200),
		error: null,
		traceId: options?.traceId,
	});
	return text;
}

export async function callLocalMcpToolJson<T>(
	name: string,
	args: Record<string, unknown>,
	options?: {
		traceId?: string;
		timeoutMs?: number;
	},
): Promise<T> {
	const text = await callLocalMcpTool(name, args, options);
	if (!text) {
		throw new Error(`empty MCP tool response for ${name}`);
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`invalid JSON MCP tool response for ${name}: ${text}`);
	}
}
