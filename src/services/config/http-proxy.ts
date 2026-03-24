/**
 * HTTP 代理封装。
 * 云端 API（需密钥）：走 Rust invoke 代理，密钥仅在 Rust 进程内。
 * 本地/局域网（无密钥）：前端直接 fetch。
 * 非 Tauri 环境：全部走前端 fetch（开发模式 fallback）。
 */

import { isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("http-proxy");

export interface ProxyRequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** 若提供，Rust 从 keyring 读取此 key 对应的密钥并注入 Authorization: Bearer header */
	secretKey?: string;
	/** 请求超时（毫秒），默认 30000 */
	timeoutMs?: number;
}

export interface ProxyResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

/**
 * 发送代理 HTTP 请求。
 * 当提供 secretKey 时，必须走 Rust 代理（密钥不进前端）。
 * 无 secretKey 且目标为本地/局域网时，可走前端 fetch。
 */
export async function proxyRequest(options: ProxyRequestOptions): Promise<ProxyResponse> {
	// Tauri 环境下，所有 HTTP 请求都走 Rust invoke 代理。
	// 原因：WebView 在 dev 模式下仍受浏览器 CORS 约束，直接 fetch 会被拦截。
	// Rust 侧 reqwest 不受 CORS 影响，密钥也始终不进入前端 JS 运行时。
	// 非 Tauri 环境（浏览器 dev server）降级到直接 fetch。
	if (isTauriEnvironment()) {
		return invokeProxy(options);
	}

	return directFetch(options);
}

// ── Rust invoke 代理 ──

async function invokeProxy(options: ProxyRequestOptions): Promise<ProxyResponse> {
	const { invoke } = await import("@tauri-apps/api/core");

	const request = {
		url: options.url,
		method: options.method ?? "GET",
		headers: options.headers ?? {},
		body: options.body ?? null,
		secretKey: options.secretKey ?? null,
	};

	log.debug(`proxy request: ${request.method} ${request.url}`);

	const result = await invoke<ProxyResponse>("proxy_http_request", { request });
	return result;
}

// ── 前端直接 fetch ──

async function directFetch(options: ProxyRequestOptions): Promise<ProxyResponse> {
	const controller = new AbortController();
	const timeout = options.timeoutMs ?? 30000;
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		log.debug(`direct fetch: ${options.method ?? "GET"} ${options.url}`);

		const resp = await fetch(options.url, {
			method: options.method ?? "GET",
			headers: options.headers,
			body: options.body,
			signal: controller.signal,
		});

		const headers: Record<string, string> = {};
		resp.headers.forEach((v, k) => { headers[k] = v; });

		const body = await resp.text();

		return { status: resp.status, headers, body };
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			throw new Error(`request timed out after ${timeout}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * SSE 流式代理。走 Rust invoke 启动 SSE 连接，Rust 通过 Tauri event 逐 chunk 推送。
 * 返回一个 cleanup 函数用于取消监听。
 */
export async function proxySSERequest(
	options: ProxyRequestOptions,
	onChunk: (data: string) => void,
	onError: (error: string, status?: number) => void,
	onDone: () => void,
): Promise<() => void> {
	if (!isTauriEnvironment()) {
		// 非 Tauri 环境不支持 SSE 代理
		onError("SSE proxy not available outside Tauri environment");
		onDone();
		return () => {};
	}

	const { invoke } = await import("@tauri-apps/api/core");
	const { listen } = await import("@tauri-apps/api/event");

	const channelId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	const unlisten = await listen<{ type: string; data?: string; body?: string; status?: number }>(
		channelId,
		(event) => {
			const payload = event.payload;
			switch (payload.type) {
				case "chunk":
					if (payload.data) onChunk(payload.data);
					break;
				case "error":
					onError(payload.body ?? "unknown SSE error", payload.status);
					break;
				case "done":
					onDone();
					break;
			}
		},
	);

	const request = {
		url: options.url,
		method: options.method ?? "POST",
		headers: options.headers ?? {},
		body: options.body ?? null,
		secretKey: options.secretKey ?? null,
	};

	invoke("proxy_sse_request", { request, channelId }).catch((err) => {
		onError(String(err));
		onDone();
	});

	return unlisten;
}
