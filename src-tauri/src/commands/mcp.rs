use std::{
	collections::HashMap,
	net::{Ipv4Addr, SocketAddr},
	sync::{
		atomic::{AtomicBool, Ordering},
		Arc,
	},
	time::Duration,
};

use axum::{
	extract::State,
	http::StatusCode,
	response::IntoResponse,
	routing::{get, post},
	Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::{
	net::TcpListener,
	sync::{oneshot, Mutex},
	time::timeout,
};

pub const MCP_SERVER_PORT: u16 = 31430;
const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MCP_SERVER_NAME: &str = "paimon-companion-mcp";
const TOOL_REQUEST_EVENT: &str = "mcp://tool-request";
const TOOL_TIMEOUT_SECS: u64 = 20;

#[derive(Clone, Default)]
pub struct McpBridgeState {
	pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
	ready: Arc<AtomicBool>,
}

#[derive(Clone)]
struct McpServerState {
	app: AppHandle,
	bridge: McpBridgeState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeResponse {
	request_id: String,
	ok: bool,
	result: Option<Value>,
	error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolRequestPayload {
	request_id: String,
	tool_name: String,
	args: Value,
}

#[derive(Debug, Deserialize)]
struct McpJsonRpcRequest {
	jsonrpc: Option<String>,
	id: Option<Value>,
	method: String,
	params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct McpJsonRpcResponse {
	jsonrpc: &'static str,
	#[serde(skip_serializing_if = "Option::is_none")]
	id: Option<Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	result: Option<Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	error: Option<McpJsonRpcError>,
}

#[derive(Debug, Serialize)]
struct McpJsonRpcError {
	code: i32,
	message: String,
}

#[derive(Debug, Serialize)]
struct McpHealthPayload {
	ready: bool,
	port: u16,
}

#[tauri::command]
pub fn mcp_bridge_ready(state: TauriState<McpBridgeState>) {
	state.ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn mcp_bridge_respond(
	state: TauriState<'_, McpBridgeState>,
	response: McpBridgeResponse,
) -> Result<(), String> {
	let sender = {
		let mut pending = state.pending.lock().await;
		pending.remove(&response.request_id)
	};

	let Some(sender) = sender else {
		return Err(format!("unknown MCP bridge request: {}", response.request_id));
	};

	let result = if response.ok {
		Ok(response.result.unwrap_or_else(|| json!({})))
	} else {
		Err(response.error.unwrap_or_else(|| "unknown MCP bridge error".to_string()))
	};

	sender
		.send(result)
		.map_err(|_| format!("failed to resolve MCP bridge request {}", response.request_id))
}

pub fn start_mcp_server(app: AppHandle, bridge: McpBridgeState) {
	let state = McpServerState { app, bridge };
	tauri::async_runtime::spawn(async move {
		if let Err(err) = run_mcp_server(state).await {
			eprintln!("[mcp] failed to start local MCP server: {err}");
		}
	});
}

async fn run_mcp_server(state: McpServerState) -> Result<(), String> {
	let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, MCP_SERVER_PORT));
	let listener = TcpListener::bind(addr)
		.await
		.map_err(|err| format!("bind failed on {addr}: {err}"))?;

	let router = Router::new()
		.route("/health", get(handle_health))
		.route("/mcp", post(handle_mcp))
		.with_state(state);

	axum::serve(listener, router)
		.await
		.map_err(|err| format!("serve failed: {err}"))
}

async fn handle_health(State(state): State<McpServerState>) -> impl IntoResponse {
	Json(McpHealthPayload {
		ready: state.bridge.ready.load(Ordering::SeqCst),
		port: MCP_SERVER_PORT,
	})
}

async fn handle_mcp(
	State(state): State<McpServerState>,
	Json(request): Json<McpJsonRpcRequest>,
) -> impl IntoResponse {
	let response = process_mcp_request(state, request).await;
	(StatusCode::OK, Json(response))
}

async fn process_mcp_request(
	state: McpServerState,
	request: McpJsonRpcRequest,
) -> McpJsonRpcResponse {
	if request.jsonrpc.as_deref() != Some("2.0") {
		return error_response(request.id, -32600, "invalid jsonrpc version");
	}

	match request.method.as_str() {
		"initialize" => success_response(
			request.id,
			json!({
				"protocolVersion": MCP_PROTOCOL_VERSION,
				"capabilities": {
					"tools": {
						"listChanged": false
					}
				},
				"serverInfo": {
					"name": MCP_SERVER_NAME,
					"version": env!("CARGO_PKG_VERSION")
				}
			}),
		),
		"notifications/initialized" => success_response(request.id, json!({})),
		"ping" => success_response(request.id, json!({})),
		"tools/list" => success_response(request.id, json!({ "tools": build_tool_descriptors() })),
		"tools/call" => match call_tool_from_request(&state, request.params).await {
			Ok(result) => success_response(
				request.id,
				json!({
					"content": [
						{
							"type": "text",
							"text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
						}
					],
					"isError": false
				}),
			),
			Err(err) => success_response(
				request.id,
				json!({
					"content": [
						{
							"type": "text",
							"text": err
						}
					],
					"isError": true
				}),
			),
		},
		_ => error_response(request.id, -32601, "method not found"),
	}
}

async fn call_tool_from_request(
	state: &McpServerState,
	params: Option<Value>,
) -> Result<Value, String> {
	let params = params.unwrap_or_else(|| json!({}));
	let tool_name = params
		.get("name")
		.and_then(Value::as_str)
		.ok_or_else(|| "tools/call requires params.name".to_string())?;
	let args = params
		.get("arguments")
		.cloned()
		.unwrap_or_else(|| json!({}));

	request_frontend_tool(state, tool_name, args).await
}

async fn request_frontend_tool(
	state: &McpServerState,
	tool_name: &str,
	args: Value,
) -> Result<Value, String> {
	if !state.bridge.ready.load(Ordering::SeqCst) {
		return Err("frontend MCP bridge not ready".to_string());
	}

	let request_id = format!(
		"mcp-{}-{}",
		tool_name.replace('.', "-"),
		std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.map(|duration| duration.as_millis())
			.unwrap_or_default(),
	);

	let (sender, receiver) = oneshot::channel();
	{
		let mut pending = state.bridge.pending.lock().await;
		pending.insert(request_id.clone(), sender);
	}

	let payload = McpToolRequestPayload {
		request_id: request_id.clone(),
		tool_name: tool_name.to_string(),
		args,
	};

	let window = state
		.app
		.get_webview_window("main")
		.ok_or_else(|| "main window is not available".to_string())?;
	window
		.emit(TOOL_REQUEST_EVENT, payload)
		.map_err(|err| format!("failed to emit MCP tool request: {err}"))?;

	match timeout(Duration::from_secs(TOOL_TIMEOUT_SECS), receiver).await {
		Ok(Ok(result)) => result,
		Ok(Err(_)) => Err(format!("MCP tool request cancelled: {request_id}")),
		Err(_) => {
			let mut pending = state.bridge.pending.lock().await;
			pending.remove(&request_id);
			Err(format!(
				"MCP tool request timed out after {}s: {}",
				TOOL_TIMEOUT_SECS, tool_name
			))
		}
	}
}

fn build_tool_descriptors() -> Vec<Value> {
	vec![
		json!({
			"name": "companion.set_emotion",
			"description": "Update the companion emotion so the Live2D model can switch expression to match the current response.",
			"inputSchema": {
				"type": "object",
				"properties": {
					"emotion": {
						"type": "string",
						"enum": ["neutral", "happy", "angry", "sad", "delighted", "alarmed", "dazed"]
					}
				},
				"required": ["emotion"],
				"additionalProperties": false
			}
		}),
		json!({
			"name": "companion.reset_emotion",
			"description": "Reset the companion back to neutral emotion.",
			"inputSchema": {
				"type": "object",
				"properties": {},
				"additionalProperties": false
			}
		}),
		json!({
			"name": "companion.get_state",
			"description": "Return the current companion emotion, speaking state, and active model.",
			"inputSchema": {
				"type": "object",
				"properties": {},
				"additionalProperties": false
			}
		}),
		json!({
			"name": "game.list_actions",
			"description": "List semantic game actions for one game or for all registered game plugins.",
			"inputSchema": {
				"type": "object",
				"properties": {
					"gameId": { "type": "string" }
				},
				"additionalProperties": false
			}
		}),
		json!({
			"name": "game.perform_action",
			"description": "Perform a single semantic action against the currently selected target window or a supplied target handle/title.",
			"inputSchema": {
				"type": "object",
				"properties": {
					"gameId": { "type": "string" },
					"actionId": { "type": "string" },
					"targetHandle": { "type": "string" },
					"targetTitle": { "type": "string" }
				},
				"required": ["gameId", "actionId"],
				"additionalProperties": false
			}
		}),
	]
}

fn success_response(id: Option<Value>, result: Value) -> McpJsonRpcResponse {
	McpJsonRpcResponse {
		jsonrpc: "2.0",
		id,
		result: Some(result),
		error: None,
	}
}

fn error_response(id: Option<Value>, code: i32, message: &str) -> McpJsonRpcResponse {
	McpJsonRpcResponse {
		jsonrpc: "2.0",
		id,
		result: None,
		error: Some(McpJsonRpcError {
			code,
			message: message.to_string(),
		}),
	}
}
