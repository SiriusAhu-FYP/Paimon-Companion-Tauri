import { proxyRequest } from "@/services/config/http-proxy";

const LOCAL_MCP_URL = "http://127.0.0.1:31430/mcp";

interface McpJsonRpcResponse {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: {
		message?: string;
	};
}

export async function callLocalMcpTool(name: string, args: Record<string, unknown>) {
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
		throw new Error(`MCP HTTP ${response.status}: ${response.body}`);
	}

	let payload: McpJsonRpcResponse;
	try {
		payload = JSON.parse(response.body) as McpJsonRpcResponse;
	} catch {
		throw new Error(`invalid MCP response: ${response.body}`);
	}

	if (payload.error?.message) {
		throw new Error(payload.error.message);
	}

	const text = payload.result?.content?.map((item) => item.text ?? "").join("\n").trim() ?? "";
	const isError = payload.result?.isError ?? false;
	if (isError) {
		throw new Error(text || `MCP tool failed: ${name}`);
	}

	return text;
}
