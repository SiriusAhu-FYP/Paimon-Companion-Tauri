use std::collections::HashMap;

use reqwest::{header, Client, Method};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_keyring::KeyringExt;

/// 前端传入的代理请求描述
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequest {
	pub url: String,
	pub method: Option<String>,
	pub headers: Option<HashMap<String, String>>,
	pub body: Option<String>,
	/// 若提供，Rust 从 keyring 读取对应密钥并以 Bearer token 注入 Authorization header
	pub secret_key: Option<String>,
}

/// 返回给前端的代理响应
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyResponse {
	pub status: u16,
	pub headers: HashMap<String, String>,
	pub body: String,
}

const SERVICE_PREFIX: &str = "com.siriusahu.paimon-live";

#[tauri::command]
pub async fn proxy_http_request(
	app: AppHandle,
	request: ProxyRequest,
) -> Result<ProxyResponse, String> {
	let client = Client::builder()
		.no_proxy()
		.build()
		.map_err(|e| format!("failed to create HTTP client: {e}"))?;

	let method = match request
		.method
		.as_deref()
		.unwrap_or("GET")
		.to_uppercase()
		.as_str()
	{
		"GET" => Method::GET,
		"POST" => Method::POST,
		"PUT" => Method::PUT,
		"DELETE" => Method::DELETE,
		"PATCH" => Method::PATCH,
		"HEAD" => Method::HEAD,
		"OPTIONS" => Method::OPTIONS,
		other => return Err(format!("unsupported HTTP method: {other}")),
	};

	let mut req_builder = client.request(method, &request.url);

	// 注入自定义 headers
	if let Some(headers) = &request.headers {
		for (k, v) in headers {
			req_builder = req_builder.header(k, v);
		}
	}

	// 从 keyring 读取密钥并注入 Authorization header
	if let Some(secret_key) = &request.secret_key {
		let service = format!("{SERVICE_PREFIX}:{secret_key}");
		match app.keyring().get_password(&service, secret_key) {
			Ok(Some(token)) => {
				req_builder =
					req_builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
			}
			// 密钥未配置时继续请求（不注入 header），由远端返回 401
			Ok(None) => {}
			Err(e) => {
				let msg = e.to_string();
				if msg.contains("No matching entry")
					|| msg.contains("not found")
					|| msg.contains("NoEntry")
				{
					// 同上：视为未配置，继续请求
				} else {
					return Err(format!("keyring read failed: {msg}"));
				}
			}
		}
	}

	// 注入 body
	if let Some(body) = request.body {
		req_builder = req_builder.body(body);
	}

	// 发送请求
	let response = req_builder
		.send()
		.await
		.map_err(|e| format!("HTTP request failed: {e}"))?;

	let status = response.status().as_u16();

	let mut resp_headers = HashMap::new();
	for (k, v) in response.headers() {
		if let Ok(val) = v.to_str() {
			resp_headers.insert(k.to_string(), val.to_string());
		}
	}

	let body = response
		.text()
		.await
		.map_err(|e| format!("failed to read response body: {e}"))?;

	Ok(ProxyResponse {
		status,
		headers: resp_headers,
		body,
	})
}

/// 二进制代理——返回原始字节（用于 TTS 等返回二进制音频的接口）
#[tauri::command]
pub async fn proxy_binary_request(
	app: AppHandle,
	request: ProxyRequest,
) -> Result<Vec<u8>, String> {
	let client = Client::builder()
		.no_proxy()
		.build()
		.map_err(|e| format!("failed to create HTTP client: {e}"))?;

	let method = match request
		.method
		.as_deref()
		.unwrap_or("GET")
		.to_uppercase()
		.as_str()
	{
		"GET" => Method::GET,
		"POST" => Method::POST,
		"PUT" => Method::PUT,
		"DELETE" => Method::DELETE,
		other => return Err(format!("unsupported HTTP method: {other}")),
	};

	let mut req_builder = client.request(method, &request.url);

	if let Some(headers) = &request.headers {
		for (k, v) in headers {
			req_builder = req_builder.header(k, v);
		}
	}

	if let Some(secret_key) = &request.secret_key {
		let service = format!("{SERVICE_PREFIX}:{secret_key}");
		if let Ok(Some(token)) = app.keyring().get_password(&service, secret_key) {
			req_builder = req_builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
		}
	}

	if let Some(body) = request.body {
		req_builder = req_builder.body(body);
	}

	let response = req_builder
		.send()
		.await
		.map_err(|e| format!("HTTP request failed: {e}"))?;

	let status = response.status().as_u16();
	if status >= 400 {
		let body = response.text().await.unwrap_or_default();
		return Err(format!("HTTP {status}: {body}"));
	}

	let bytes = response
		.bytes()
		.await
		.map_err(|e| format!("failed to read response bytes: {e}"))?;

	Ok(bytes.to_vec())
}

/// SSE 流式代理——通过 Tauri event channel 向前端推送 chunks
#[tauri::command]
pub async fn proxy_sse_request(
	app: AppHandle,
	window: tauri::Window,
	request: ProxyRequest,
	channel_id: String,
) -> Result<(), String> {
	use futures_util::StreamExt;

	let client = Client::builder()
		.no_proxy()
		.build()
		.map_err(|e| format!("failed to create HTTP client: {e}"))?;

	let method = match request
		.method
		.as_deref()
		.unwrap_or("POST")
		.to_uppercase()
		.as_str()
	{
		"POST" => Method::POST,
		"GET" => Method::GET,
		other => return Err(format!("unsupported SSE method: {other}")),
	};

	let mut req_builder = client.request(method, &request.url);

	if let Some(headers) = &request.headers {
		for (k, v) in headers {
			req_builder = req_builder.header(k, v);
		}
	}

	// 注入密钥
	if let Some(secret_key) = &request.secret_key {
		let service = format!("{SERVICE_PREFIX}:{secret_key}");
		if let Ok(Some(token)) = app.keyring().get_password(&service, secret_key) {
			req_builder = req_builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
		}
	}

	if let Some(body) = request.body {
		req_builder = req_builder.body(body);
	}

	let response = req_builder
		.send()
		.await
		.map_err(|e| format!("SSE request failed: {e}"))?;

	let status = response.status().as_u16();
	if status >= 400 {
		let body = response.text().await.unwrap_or_default();
		let _ = window.emit(
			&channel_id,
			serde_json::json!({ "type": "error", "status": status, "body": body }),
		);
		return Ok(());
	}

	let mut stream = response.bytes_stream();
	while let Some(chunk) = stream.next().await {
		match chunk {
			Ok(bytes) => {
				let text = String::from_utf8_lossy(&bytes);
				let _ = window.emit(
					&channel_id,
					serde_json::json!({ "type": "chunk", "data": text }),
				);
			}
			Err(e) => {
				let _ = window.emit(
					&channel_id,
					serde_json::json!({ "type": "error", "body": e.to_string() }),
				);
				break;
			}
		}
	}

	let _ = window.emit(&channel_id, serde_json::json!({ "type": "done" }));
	Ok(())
}
