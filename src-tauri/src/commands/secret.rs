use tauri::AppHandle;
use tauri_plugin_keyring::KeyringExt;

const SERVICE_PREFIX: &str = "com.siriusahu.paimon-companion-tauri";

fn make_service(key: &str) -> String {
	format!("{SERVICE_PREFIX}:{key}")
}

#[tauri::command]
pub async fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
	app.keyring()
		.set_password(&make_service(&key), &key, &value)
		.map_err(|e| format!("keyring set failed: {e}"))
}

#[tauri::command]
pub async fn secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
	match app.keyring().get_password(&make_service(&key), &key) {
		Ok(Some(v)) => Ok(Some(v)),
		Ok(None) => Ok(None),
		Err(e) => {
			let msg = e.to_string();
			// keyring crate 在找不到条目时可能返回 error 而非 None
			if msg.contains("No matching entry")
				|| msg.contains("not found")
				|| msg.contains("NoEntry")
			{
				Ok(None)
			} else {
				Err(format!("keyring get failed: {msg}"))
			}
		}
	}
}

#[tauri::command]
pub async fn secret_has(app: AppHandle, key: String) -> Result<bool, String> {
	let result = secret_get(app, key).await?;
	Ok(result.is_some())
}

#[tauri::command]
pub async fn secret_delete(app: AppHandle, key: String) -> Result<(), String> {
	app.keyring()
		.delete_password(&make_service(&key), &key)
		.map_err(|e| {
			let msg = e.to_string();
			if msg.contains("No matching entry")
				|| msg.contains("not found")
				|| msg.contains("NoEntry")
			{
				// 删除不存在的条目视为成功
				return String::new();
			}
			format!("keyring delete failed: {msg}")
		})
		.or_else(|e| if e.is_empty() { Ok(()) } else { Err(e) })
}
