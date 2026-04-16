use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDebugCaptureRequest {
	pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCaptureSessionInfo {
	pub session_id: String,
	pub directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendDebugCaptureTextRequest {
	pub session_id: String,
	pub file_name: String,
	pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDebugCaptureImageRequest {
	pub session_id: String,
	pub file_name: String,
	pub data_url: String,
}

#[tauri::command]
pub async fn start_debug_capture(request: StartDebugCaptureRequest) -> Result<DebugCaptureSessionInfo, String> {
	let session_id = build_session_id(request.label.as_deref());
	let session_dir = get_session_dir(&session_id)?;
	fs::create_dir_all(&session_dir).map_err(|err| format!("failed to create debug capture directory: {err}"))?;
	fs::create_dir_all(session_dir.join("images")).map_err(|err| format!("failed to create image directory: {err}"))?;

	Ok(DebugCaptureSessionInfo {
		session_id,
		directory: session_dir.to_string_lossy().to_string(),
	})
}

#[tauri::command]
pub async fn append_debug_capture_text(request: AppendDebugCaptureTextRequest) -> Result<(), String> {
	let path = resolve_session_path(&request.session_id, &request.file_name)?;
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|err| format!("failed to create parent directory: {err}"))?;
	}

	let mut file = OpenOptions::new()
		.create(true)
		.append(true)
		.open(&path)
		.map_err(|err| format!("failed to open debug capture file: {err}"))?;
	file
		.write_all(request.text.as_bytes())
		.map_err(|err| format!("failed to append debug capture text: {err}"))?;
	Ok(())
}

#[tauri::command]
pub async fn write_debug_capture_image(request: WriteDebugCaptureImageRequest) -> Result<(), String> {
	let path = resolve_session_path(&request.session_id, &request.file_name)?;
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|err| format!("failed to create image parent directory: {err}"))?;
	}

	let bytes = decode_data_url(&request.data_url)?;
	fs::write(&path, bytes).map_err(|err| format!("failed to write debug capture image: {err}"))?;
	Ok(())
}

fn get_logs_root() -> Result<PathBuf, String> {
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	Ok(current_dir.join("logs").join("debug-captures"))
}

fn get_session_dir(session_id: &str) -> Result<PathBuf, String> {
	Ok(get_logs_root()?.join(session_id))
}

fn resolve_session_path(session_id: &str, file_name: &str) -> Result<PathBuf, String> {
	let session_dir = get_session_dir(session_id)?;
	let relative = sanitize_relative_path(file_name)?;
	Ok(session_dir.join(relative))
}

fn sanitize_relative_path(file_name: &str) -> Result<PathBuf, String> {
	let raw = Path::new(file_name);
	if raw.is_absolute() {
		return Err("absolute paths are not allowed".to_string());
	}

	let mut sanitized = PathBuf::new();
	for component in raw.components() {
		use std::path::Component;
		match component {
			Component::Normal(part) => {
				let part = part.to_string_lossy();
				if part.is_empty() || part == "." || part == ".." {
					return Err("invalid debug capture path component".to_string());
				}
				let cleaned = part
					.chars()
					.map(|ch| match ch {
						'\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
						_ => ch,
					})
					.collect::<String>();
				sanitized.push(cleaned);
			}
			_ => return Err("invalid debug capture path".to_string()),
		}
	}

	if sanitized.as_os_str().is_empty() {
		return Err("debug capture path cannot be empty".to_string());
	}

	Ok(sanitized)
}

fn build_session_id(label: Option<&str>) -> String {
	let timestamp = chrono_like_timestamp();
	let suffix = sanitize_label(label.unwrap_or("manual"));
	format!("{timestamp}-{suffix}")
}

fn sanitize_label(raw: &str) -> String {
	let cleaned = raw
		.trim()
		.to_lowercase()
		.chars()
		.map(|ch| {
			if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
				ch
			} else {
				'-'
			}
		})
		.collect::<String>();
	let cleaned = cleaned.trim_matches('-');
	if cleaned.is_empty() {
		"manual".to_string()
	} else {
		cleaned.to_string()
	}
}

fn chrono_like_timestamp() -> String {
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap_or_default();
	let secs = now.as_secs();
	let millis = now.subsec_millis();
	format!("{secs}-{millis:03}")
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
	let (_, encoded) = data_url
		.split_once(',')
		.ok_or_else(|| "invalid data url".to_string())?;
	base64::engine::general_purpose::STANDARD
		.decode(encoded)
		.map_err(|err| format!("failed to decode base64 image: {err}"))
}
