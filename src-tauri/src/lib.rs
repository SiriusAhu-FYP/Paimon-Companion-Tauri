mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.plugin(tauri_plugin_keyring::init())
		.invoke_handler(tauri::generate_handler![
			commands::secret::secret_set,
			commands::secret::secret_get,
			commands::secret::secret_has,
			commands::secret::secret_delete,
			commands::http_proxy::proxy_http_request,
			commands::http_proxy::proxy_binary_request,
			commands::http_proxy::proxy_sse_request,
			commands::window::list_windows,
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
