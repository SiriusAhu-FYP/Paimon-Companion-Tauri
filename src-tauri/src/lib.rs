use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            // 主窗口关闭时退出整个应用（确保所有子窗口和进程被清理）
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    // 关闭所有其他窗口
                    for (label, win) in window.app_handle().webview_windows() {
                        if label != "main" {
                            let _ = win.close();
                        }
                    }
                    // 退出应用
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
