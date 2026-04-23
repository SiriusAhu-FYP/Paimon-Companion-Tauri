mod commands;

use tauri::Manager;
use commands::mcp::McpBridgeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.manage(McpBridgeState::default())
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_keyring::init())
		.setup(|app| {
			let _ = commands::log_lifecycle::run_startup_log_lifecycle();
			let bridge = app.state::<McpBridgeState>().inner().clone();
			commands::mcp::start_mcp_server(app.handle().clone(), bridge);
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::secret::secret_set,
			commands::secret::secret_get,
			commands::secret::secret_has,
			commands::secret::secret_delete,
			commands::debug_capture::start_debug_capture,
			commands::debug_capture::append_debug_capture_text,
			commands::debug_capture::write_debug_capture_image,
			commands::debug_capture::export_debug_capture_session,
			commands::debug_capture::list_debug_capture_sessions,
			commands::debug_capture::read_debug_capture_file,
			commands::delegation_scratchpad::start_delegation_scratchpad,
			commands::delegation_scratchpad::write_delegation_scratchpad_text,
			commands::delegation_scratchpad::read_delegation_scratchpad_text,
			commands::http_proxy::proxy_http_request,
			commands::http_proxy::proxy_binary_request,
			commands::http_proxy::proxy_multipart_request,
			commands::http_proxy::proxy_sse_request,
			commands::window::list_windows,
			commands::window::capture_window,
			commands::window::focus_window,
			commands::window::send_key,
			commands::window::send_mouse,
			commands::window::send_text,
			commands::local_asr::local_sherpa_healthcheck,
			commands::local_asr::local_sherpa_transcribe,
			commands::playbook_config::read_playbook_toml_values,
			commands::playbook_config::update_playbook_toml_values,
			commands::mcp::mcp_bridge_ready,
			commands::mcp::mcp_bridge_respond,
		])
		.on_window_event(|window, event| {
			if let tauri::WindowEvent::CloseRequested { .. } = event {
				if window.label() == "main" {
					for (label, win) in window.app_handle().webview_windows() {
						if label != "main" {
							let _ = win.close();
						}
					}
					window.app_handle().exit(0);
				}
			}
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
